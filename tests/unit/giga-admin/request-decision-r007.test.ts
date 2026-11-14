/**
 * R-007: a decision on an access request (PATCH /api/giga-admin/requests/:id,
 * the bulk route and the admin Telegram bot — all through
 * lib/users/access-requests.ts decideAccessRequest) always checks the target:
 *  - a staff / expert / legacy-staff target only by a super_admin;
 *  - canManageTarget for everyone else;
 *  - only valid status transitions (no «approve» of a blocked / archived
 *    account, no «reject» of an approved one);
 *  - nobody decides on their own account.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  apply: vi.fn(),
  audit: vi.fn(),
}))

vi.mock('@/lib/users/approval', () => ({ applyApprovalDecision: h.apply }))
vi.mock('@/lib/audit', () => ({ logAudit: h.audit }))

import { decideAccessRequest } from '@/lib/users/access-requests'

const ACTOR = '00000000-0000-4000-8000-0000000000aa'
const TARGET = '00000000-0000-4000-8000-0000000000bb'

interface Person { role: string; status: string; staff?: string | null }

function stub(people: Record<string, Person>, adminRow: { userId: string } | null = null) {
  const writes: string[] = []
  const sb = {
    writes,
    from(table: string) {
      if (table === 'admin_requests') {
        return {
          select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: adminRow, error: null }) }) }),
          update: () => ({ eq: async () => { writes.push('admin_requests'); return { data: null, error: null } } }),
        }
      }
      if (table === 'profiles') {
        return {
          select: () => ({ eq: (_c: string, id: string) => ({ maybeSingle: async () => ({ data: people[id] ? { id, role: people[id].role, status: people[id].status } : null, error: null }) }) }),
        }
      }
      if (table === 'staff_roles') {
        return {
          select: () => ({ eq: (_c: string, id: string) => ({ maybeSingle: async () => ({ data: people[id]?.staff ? { role: people[id].staff } : null, error: null }) }) }),
        }
      }
      throw new Error('unexpected table ' + table)
    },
  }
  return sb
}

const decide = (sb: ReturnType<typeof stub>, action: 'approve' | 'reject' | 'archive', actor: { id?: string; kind?: string; role?: string } = {}) =>
  decideAccessRequest(sb as never, {
    requestId: TARGET,
    action,
    actor: { id: actor.id ?? ACTOR, kind: actor.kind ?? 'session', ...(actor.role ? { role: actor.role as never } : {}) },
  })

describe('R-007: access-request decisions check the target', () => {
  beforeEach(() => {
    h.apply.mockReset().mockResolvedValue({ affected: 1, profile: null, emailSent: false })
    h.audit.mockReset().mockResolvedValue(undefined)
  })

  it('R-007: crm_manager cannot reject a super_admin (profile id fallback)', async () => {
    const sb = stub({ [ACTOR]: { role: 'client', status: 'approved', staff: 'crm_manager' }, [TARGET]: { role: 'super_admin', status: 'approved' } })
    const r = await decide(sb, 'reject')
    expect(r).toMatchObject({ ok: false, reason: 'forbidden' })
    expect(h.apply).not.toHaveBeenCalled()
    expect(sb.writes).toEqual([])
  })

  it('R-007: super_expert cannot decide on staff, experts or legacy admin profiles', async () => {
    for (const target of [
      { role: 'client', status: 'pending_approval', staff: 'support' },
      { role: 'expert', status: 'pending_approval' },
      { role: 'admin', status: 'pending_approval' },
    ]) {
      const sb = stub({ [ACTOR]: { role: 'client', status: 'approved', staff: 'super_expert' }, [TARGET]: target })
      expect(await decide(sb, 'approve'), JSON.stringify(target)).toMatchObject({ ok: false, reason: 'forbidden' })
    }
    expect(h.apply).not.toHaveBeenCalled()
  })

  it('R-007: approve does not unblock a blocked / archived account; reject does not cut an approved one', async () => {
    for (const status of ['blocked', 'archived']) {
      const sb = stub({ [ACTOR]: { role: 'client', status: 'approved', staff: 'crm_manager' }, [TARGET]: { role: 'client', status } })
      expect(await decide(sb, 'approve'), status).toMatchObject({ ok: false, reason: 'invalid_transition' })
    }
    const sb = stub({ [ACTOR]: { role: 'client', status: 'approved', staff: 'crm_manager' }, [TARGET]: { role: 'client', status: 'approved' } })
    expect(await decide(sb, 'reject')).toMatchObject({ ok: false, reason: 'invalid_transition' })
    expect(h.apply).not.toHaveBeenCalled()
  })

  it('R-007: also when the id IS an admin_requests row (target from userId)', async () => {
    const sb = stub(
      { [ACTOR]: { role: 'client', status: 'approved', staff: 'crm_manager' }, [TARGET]: { role: 'client', status: 'blocked' } },
      { userId: TARGET },
    )
    const r = await decideAccessRequest(sb as never, { requestId: 'req-1', action: 'approve', actor: { id: ACTOR, kind: 'session' } })
    expect(r).toMatchObject({ ok: false, reason: 'invalid_transition' })
    expect(sb.writes).toEqual([])
  })

  it('R-007: nobody decides on their own account', async () => {
    const sb = stub({ [TARGET]: { role: 'super_admin', status: 'approved', staff: 'super_admin' } })
    expect(await decide(sb, 'reject', { id: TARGET })).toMatchObject({ ok: false, reason: 'forbidden' })
  })

  it('R-007: an unknown actor (no staff role) is refused — fail closed for the Telegram path', async () => {
    const sb = stub({ [ACTOR]: { role: 'client', status: 'approved' }, [TARGET]: { role: 'client', status: 'pending_approval' } })
    expect(await decide(sb, 'approve', { kind: 'telegram' })).toMatchObject({ ok: false, reason: 'forbidden' })
  })

  it('R-007: legitimate decisions still work (pending → approved / rejected, rejected → approved, super_admin on staff)', async () => {
    const cases: Array<[string, 'approve' | 'reject', Person, Person]> = [
      ['pending approve', 'approve', { role: 'client', status: 'approved', staff: 'crm_manager' }, { role: 'client', status: 'pending_approval' }],
      ['clarification reject', 'reject', { role: 'client', status: 'approved', staff: 'super_expert' }, { role: 'client', status: 'requires_clarification' }],
      ['rejected approve', 'approve', { role: 'client', status: 'approved', staff: 'admin' }, { role: 'client', status: 'rejected' }],
      ['super_admin on expert', 'approve', { role: 'super_admin', status: 'approved' }, { role: 'expert', status: 'pending_approval' }],
    ]
    for (const [name, action, actor, target] of cases) {
      h.apply.mockClear()
      const sb = stub({ [ACTOR]: actor, [TARGET]: target })
      expect(await decide(sb, action), name).toMatchObject({ ok: true })
      expect(h.apply, name).toHaveBeenCalledTimes(1)
    }
  })

  it('R-007: a repeated decision is a no-op success (no second e-mail)', async () => {
    const sb = stub({ [ACTOR]: { role: 'client', status: 'approved', staff: 'crm_manager' }, [TARGET]: { role: 'client', status: 'approved' } })
    expect(await decide(sb, 'approve')).toMatchObject({ ok: true, status: 'approved' })
    expect(h.apply).not.toHaveBeenCalled()
  })

  it('R-007: the actor role passed by the GIGA route is used as is', async () => {
    const sb = stub({ [TARGET]: { role: 'client', status: 'pending_approval' } })
    expect(await decide(sb, 'approve', { role: 'crm_manager' })).toMatchObject({ ok: true })
  })
})
