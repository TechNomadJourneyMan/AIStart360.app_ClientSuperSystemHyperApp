/**
 * R2-B — очередь SLA для ГИГА и кабинета эксперта (lib/expert-sla/store.ts):
 * видимость (как RLS 145: скоуп 'all' или свои клиенты + назначенные лично),
 * виды очереди и сводка на подменённый момент, ручное переназначение.
 */
import { describe, expect, it } from 'vitest'
import { decorate, inView, loadSlaTasks, reassignClientWork, summarize, visibleTo, type SlaTaskRow } from '@/lib/expert-sla/store'
import { slaDeadlines } from '@/lib/expert-sla/policy'
import { hoursAfter, slaDb, type Row } from './_fake'

const T0 = new Date('2026-11-14T06:00:00.000Z')

function row(id: string, over: Partial<SlaTaskRow> = {}): SlaTaskRow {
  return {
    id, source: 'case', source_id: `src-${id}`, client_id: 'c1', company_id: null, title: `Задача ${id}`, assignee_id: null,
    assigned_at: null, assigned_via: null, received_at: T0.toISOString(), ...slaDeadlines(T0), first_response_at: null,
    closed_at: null, close_reason: null, escalated_at: null, breached_at: null, created_at: T0.toISOString(), ...over,
  }
}

describe('visibility', () => {
  it('an expert sees tasks of his clients and tasks assigned to him — nothing else', () => {
    const v = { actorId: 'e1', clientIds: ['c1'] }
    expect(visibleTo(v, { client_id: 'c1', assignee_id: null })).toBe(true)
    expect(visibleTo(v, { client_id: 'c2', assignee_id: 'e1' })).toBe(true)
    expect(visibleTo(v, { client_id: 'c2', assignee_id: 'e2' })).toBe(false)
    expect(visibleTo(v, { client_id: 'c3', assignee_id: null })).toBe(false)
    expect(visibleTo({ all: true }, { client_id: 'c3', assignee_id: null })).toBe(true)
  })

  it('loadSlaTasks filters again in code (the PostgREST or() is not trusted alone)', async () => {
    const f = slaDb({ expert_sla_tasks: [row('a', { client_id: 'c1' }), row('b', { client_id: 'c2', assignee_id: 'e2' }), row('c', { client_id: 'c9', assignee_id: 'e1' })] as unknown as Row[] })
    const ids = (await loadSlaTasks(f.sb, { actorId: 'e1', clientIds: ['c1'] })).map((r) => r.id).sort()
    expect(ids).toEqual(['a', 'c'])
  })
})

describe('views and summary over a substituted clock', () => {
  const rows = [
    row('ok'),
    row('soon', { first_response_at: hoursAfter(T0, 1).toISOString(), answer_due_at: hoursAfter(T0, 33).toISOString() }),
    row('noreact', { received_at: hoursAfter(T0, -25).toISOString(), ...slaDeadlines(hoursAfter(T0, -25)), assignee_id: 'e1' }),
    row('late', { received_at: hoursAfter(T0, -50).toISOString(), ...slaDeadlines(hoursAfter(T0, -50)), source: 'report_review' }),
    row('plan', { source: 'plan_review' }),
    row('done', { closed_at: T0.toISOString() }),
  ]
  const now = hoursAfter(T0, 30)

  it('summary counts open work by stage, the expert queue and mine', () => {
    // At T0+30: ok/plan received at T0 → no reaction 24 h (escalated); soon reacted, answer due T0+33 → due soon;
    // noreact received T0-25 → answer due T0+23 → breached; late → breached.
    expect(summarize(rows, 'e1', now)).toEqual({ open: 5, dueSoon: 1, escalated: 2, breached: 2, queue: 3, mine: 1 })
  })

  it('views: attention, breached, queue (no plan approval), mine, closed', () => {
    const ids = (v: Parameters<typeof inView>[0]) => rows.filter((r) => inView(v, r, 'e1', now)).map((r) => r.id)
    expect(ids('attention')).toEqual(['ok', 'soon', 'noreact', 'late', 'plan'])
    expect(ids('breached')).toEqual(['noreact', 'late'])
    expect(ids('queue')).toEqual(['ok', 'soon', 'late'])
    expect(ids('mine')).toEqual(['noreact'])
    expect(ids('closed')).toEqual(['done'])
    expect(rows.filter((r) => inView('attention', r, 'e1', T0)).map((r) => r.id)).toEqual(['noreact', 'late'])
  })

  it('decorate: names without e-mail, the timer, the most urgent first, plan approval not reassignable', async () => {
    const f = slaDb({
      profiles: [{ id: 'c1', full_name: 'Иван', organization: null, email: 'secret@x.kz' }, { id: 'e1', full_name: 'Эксперт Пётр' }],
      companies: [{ user_id: 'c1', name: 'ООО Ромашка' }],
    })
    const out = await decorate(f.sb, rows.slice(0, 5), now)
    // Breached first (the oldest deadline on top), then no reaction, then due soon.
    expect(out.map((t) => t.id)).toEqual(['late', 'noreact', 'ok', 'plan', 'soon'])
    expect(out[0]).toMatchObject({ stage: 'breached', timer: 'просрочено на 32 ч', client: { name: 'ООО Ромашка' }, assignee: null })
    expect(out[1]).toMatchObject({ stage: 'breached', timer: 'просрочено на 7 ч', assignee: { name: 'Эксперт Пётр' } })
    expect(out[4]).toMatchObject({ stage: 'due_soon', timer: 'осталось 3 ч' })
    expect(JSON.stringify(out)).not.toContain('secret@x.kz')
    expect(out.find((t) => t.id === 'plan')!.reassignable).toBe(false)
  })
})

describe('reassignClientWork', () => {
  function world() {
    return slaDb({
      profiles: [
        { id: 'e1', role: 'expert', status: 'approved' },
        { id: 'e2', role: 'expert', status: 'approved' },
        { id: 'm1', role: 'client', status: 'approved' },
      ],
      staff_roles: [{ user_id: 'm1', role: 'crm_manager' }],
      expert_sla_tasks: [
        row('t1', { assignee_id: 'e1' }),
        row('t2', { source: 'rec_review', assignee_id: null }),
        row('t3', { source: 'plan_review' }),
        row('t4', { closed_at: T0.toISOString(), assignee_id: 'e1' }),
        row('other', { client_id: 'c2', assignee_id: 'e1' }),
      ] as unknown as Row[],
      expert_cases: [
        { id: 'k1', user_id: 'c1', status: 'new', assignee_id: 'e1' },
        { id: 'k2', user_id: 'c1', status: 'resolved', assignee_id: 'e1' },
      ],
    })
  }

  it('moves the client to the new worker: open expert tasks and open cases follow, the rest stays', async () => {
    const f = world()
    const assigned: Array<[string, string]> = []
    const res = await reassignClientWork(f.sb, {
      taskId: 't2', assigneeId: 'e2', now: T0,
      assignClient: async (c, a) => { assigned.push([c, a]); return { ok: true } },
    })
    expect(res).toEqual({ ok: true, moved: 2, previous: null })
    expect(assigned).toEqual([['c1', 'e2']])
    const by = (id: string) => f.db.expert_sla_tasks.find((t) => t.id === id)!
    expect(by('t1')).toMatchObject({ assignee_id: 'e2', assigned_via: 'manual' })
    expect(by('t2')).toMatchObject({ assignee_id: 'e2', assigned_via: 'manual' })
    expect(by('t3').assignee_id).toBeNull() // plan approval: Admin / Super Admin
    expect(by('t4').assignee_id).toBe('e1') // closed history unchanged
    expect(by('other').assignee_id).toBe('e1') // another client
    expect(f.db.expert_cases.map((c) => c.assignee_id)).toEqual(['e2', 'e1'])
  })

  it('refuses a non-worker, plan approval, a closed or unknown task, and stops when the assignment fails', async () => {
    const ok = async () => ({ ok: true as const })
    expect(await reassignClientWork(world().sb, { taskId: 't1', assigneeId: 'm1', assignClient: ok })).toMatchObject({ ok: false, status: 400 })
    expect(await reassignClientWork(world().sb, { taskId: 't3', assigneeId: 'e2', assignClient: ok })).toMatchObject({ ok: false, status: 400 })
    expect(await reassignClientWork(world().sb, { taskId: 't4', assigneeId: 'e2', assignClient: ok })).toMatchObject({ ok: false, status: 409 })
    expect(await reassignClientWork(world().sb, { taskId: 'nope', assigneeId: 'e2', assignClient: ok })).toMatchObject({ ok: false, status: 404 })
    const f = world()
    const res = await reassignClientWork(f.sb, { taskId: 't1', assigneeId: 'e2', assignClient: async () => ({ ok: false, status: 500, error: 'db' }) })
    expect(res).toMatchObject({ ok: false, status: 500 })
    expect(f.db.expert_sla_tasks.find((t) => t.id === 't1')!.assignee_id).toBe('e1')
  })
})
