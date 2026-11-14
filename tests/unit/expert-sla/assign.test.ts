/**
 * R2-B — назначение задач эксперта (lib/expert-sla/assign.ts): наименее
 * загруженный → меньше клиентов → по очереди (давность последнего назначения);
 * кто может вести экспертную работу; ответственный клиента не перезаписывается.
 */
import { describe, expect, it } from 'vitest'
import { claimUnassignedClient, isAssignableResponsible, isSlaWorker, isSlaWorkerRow, loadExpertCandidates, pickLeastLoaded } from '@/lib/expert-sla/assign'
import { slaDb } from './_fake'

const NOW = new Date('2026-11-14T06:00:00.000Z')

describe('pickLeastLoaded', () => {
  it('fewest open tasks wins', () => {
    expect(pickLeastLoaded([
      { id: 'a', openTasks: 3, clients: 0, lastAssignedAt: null },
      { id: 'b', openTasks: 1, clients: 9, lastAssignedAt: '2026-11-14T05:00:00Z' },
    ])?.id).toBe('b')
  })

  it('a tie on tasks → fewer clients; then the one who waited longest (round robin); then id', () => {
    expect(pickLeastLoaded([
      { id: 'a', openTasks: 1, clients: 4, lastAssignedAt: null },
      { id: 'b', openTasks: 1, clients: 2, lastAssignedAt: '2026-11-14T05:00:00Z' },
    ])?.id).toBe('b')
    expect(pickLeastLoaded([
      { id: 'a', openTasks: 1, clients: 2, lastAssignedAt: '2026-11-14T05:00:00Z' },
      { id: 'b', openTasks: 1, clients: 2, lastAssignedAt: '2026-11-13T05:00:00Z' },
    ])?.id).toBe('b')
    expect(pickLeastLoaded([
      { id: 'b', openTasks: 0, clients: 0, lastAssignedAt: null },
      { id: 'a', openTasks: 0, clients: 0, lastAssignedAt: null },
    ])?.id).toBe('a')
    expect(pickLeastLoaded([])).toBeNull()
  })

  it('two experts take new work in turns when the load grows (the run bumps the winner)', () => {
    const c = [
      { id: 'e1', openTasks: 0, clients: 0, lastAssignedAt: null as string | null },
      { id: 'e2', openTasks: 0, clients: 0, lastAssignedAt: null as string | null },
    ]
    const order: string[] = []
    for (let i = 0; i < 4; i++) {
      const p = pickLeastLoaded(c)!
      order.push(p.id)
      p.openTasks++
      p.clients++
      p.lastAssignedAt = `2026-11-14T0${i}:00:00Z`
    }
    expect(order).toEqual(['e1', 'e2', 'e1', 'e2'])
  })
})

describe('who may hold expert work', () => {
  it('approved expert, or approved staff super_admin / admin / super_expert', () => {
    expect(isSlaWorkerRow({ role: 'expert', status: 'approved' }, null)).toBe(true)
    expect(isSlaWorkerRow({ role: 'expert', status: 'pending_approval' }, null)).toBe(false)
    expect(isSlaWorkerRow({ role: 'client', status: 'approved' }, 'super_expert')).toBe(true)
    expect(isSlaWorkerRow({ role: 'client', status: 'approved' }, 'admin')).toBe(true)
    expect(isSlaWorkerRow({ role: 'client', status: 'approved' }, 'crm_manager')).toBe(false)
    expect(isSlaWorkerRow({ role: 'client', status: 'approved' }, 'support')).toBe(false)
    expect(isSlaWorkerRow({ role: 'super_admin', status: 'approved' }, null)).toBe(false) // legacy profile role alone (140)
    expect(isSlaWorkerRow({ role: 'client', status: 'blocked' }, 'admin')).toBe(false)
    expect(isSlaWorkerRow(null, 'admin')).toBe(false)
  })

  it('isSlaWorker / isAssignableResponsible read the rows; an expert may now be a client\'s responsible', async () => {
    const { sb } = slaDb({
      profiles: [
        { id: 'e1', role: 'expert', status: 'approved' },
        { id: 'e2', role: 'expert', status: 'rejected' },
        { id: 's1', role: 'client', status: 'approved' },
        { id: 'c1', role: 'client', status: 'approved' },
      ],
      staff_roles: [{ user_id: 's1', role: 'crm_manager' }],
    })
    expect(await isSlaWorker(sb, 'e1')).toBe(true)
    expect(await isSlaWorker(sb, 's1')).toBe(false)
    expect(await isAssignableResponsible(sb, 'e1')).toBe(true)
    expect(await isAssignableResponsible(sb, 'e2')).toBe(false)
    expect(await isAssignableResponsible(sb, 's1')).toBe(true) // any staff_roles row, as before
    expect(await isAssignableResponsible(sb, 'c1')).toBe(false)
  })
})

describe('claimUnassignedClient', () => {
  it('fills an absent or empty responsible, never overwrites one', async () => {
    const { sb, db } = slaDb({ user_assignments: [{ user_id: 'c2', assignee_id: null }, { user_id: 'c3', assignee_id: 'boss' }] })
    expect(await claimUnassignedClient(sb, 'c1', 'e1', NOW)).toBe('e1')
    expect(await claimUnassignedClient(sb, 'c2', 'e1', NOW)).toBe('e1')
    expect(await claimUnassignedClient(sb, 'c3', 'e1', NOW)).toBe('boss')
    expect(db.user_assignments.find((r) => r.user_id === 'c3')!.assignee_id).toBe('boss')
    expect(db.user_assignments.find((r) => r.user_id === 'c1')).toMatchObject({ assignee_id: 'e1', assigned_by: 'system:expert-sla' })
  })
})

describe('loadExpertCandidates', () => {
  it('approved experts only, with open tasks, clients and the last assignment', async () => {
    const { sb } = slaDb({
      profiles: [
        { id: 'e1', role: 'expert', status: 'approved' },
        { id: 'e2', role: 'expert', status: 'approved' },
        { id: 'e3', role: 'expert', status: 'blocked' },
        { id: 'sx', role: 'client', status: 'approved' },
      ],
      expert_sla_tasks: [
        { id: 't1', assignee_id: 'e1', closed_at: null, assigned_at: '2026-11-13T00:00:00Z' },
        { id: 't2', assignee_id: 'e1', closed_at: '2026-11-13T05:00:00Z', assigned_at: '2026-11-12T00:00:00Z' },
      ],
      user_assignments: [{ user_id: 'c1', assignee_id: 'e2' }, { user_id: 'c2', assignee_id: 'e2' }],
    })
    const c = await loadExpertCandidates(sb)
    expect(c).toEqual([
      { id: 'e1', openTasks: 1, clients: 0, lastAssignedAt: '2026-11-13T00:00:00Z' },
      { id: 'e2', openTasks: 0, clients: 2, lastAssignedAt: null },
    ])
  })
})
