/**
 * R2-A: a request for PAID access (paywall / the old «Pro» window) is shown to
 * staff in GIGA («Заявки» → «Доступы»); a decision on it never changes
 * profiles.status (it must not admit a client who is still waiting for
 * approval) and sends no «client approved» notices. Registrations keep their
 * old path.
 * R2-C (M-5): it is approved only by assigning the plan («Назначить Pro» /
 * Биллинг — tests/unit/access/assign-pro.test.ts); a bare «approve» is refused,
 * reject / archive stay.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const h = vi.hoisted(() => ({
  apply: vi.fn(),
  audit: vi.fn(),
  listRows: [] as Array<Record<string, unknown>>,
  tariffRows: [] as Array<Record<string, unknown>>,
}))

vi.mock('@/lib/users/approval', () => ({ applyApprovalDecision: h.apply }))
vi.mock('@/lib/audit', () => ({ logAudit: h.audit }))

const { decideAccessRequest } = await import('@/lib/users/access-requests')

const ACTOR = '00000000-0000-4000-8000-0000000000aa'
const CLIENT = '00000000-0000-4000-8000-0000000000bb'

function stub(adminRow: Record<string, unknown> | null, clientStatus: string) {
  const updates: Array<Record<string, unknown>> = []
  const sb = {
    updates,
    from(table: string) {
      if (table === 'admin_requests') {
        return {
          select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: adminRow, error: null }) }) }),
          // R2-C (review L-4): the paid branch updates only an OPEN request (… .in('status', open).select('id')).
          update: (p: Record<string, unknown>) => {
            const st = { open: true }
            const q = {
              eq: () => q,
              in: (_c: string, statuses: string[]) => { st.open = statuses.includes(String(adminRow?.status ?? 'new')); return q },
              select: async () => {
                if (!st.open) return { data: [], error: null }
                updates.push(p)
                return { data: [{ id: 'req' }], error: null }
              },
              then: (ok: (v: unknown) => unknown) => { updates.push(p); return Promise.resolve({ data: null, error: null }).then(ok) },
            }
            return q
          },
        }
      }
      if (table === 'profiles') {
        return { select: () => ({ eq: (_c: string, id: string) => ({ maybeSingle: async () => ({ data: id === ACTOR ? { role: 'client', status: 'approved' } : { role: 'client', status: clientStatus }, error: null }) }) }) }
      }
      if (table === 'staff_roles') {
        return { select: () => ({ eq: (_c: string, id: string) => ({ maybeSingle: async () => ({ data: id === ACTOR ? { role: 'admin' } : null, error: null }) }) }) }
      }
      throw new Error('unexpected table ' + table)
    },
  }
  return sb
}

const paidRow = { userId: null, type: 'access', source: 'paywall', payload: { userId: CLIENT, features: ['point_a'] } }

beforeEach(() => {
  h.apply.mockReset().mockResolvedValue({ affected: 1, profile: null, emailSent: false })
  h.audit.mockReset().mockResolvedValue(undefined)
})

describe('decision on a paid-access request', () => {
  it('R2-C: a bare approve is refused (nothing opened, nothing closed) and does NOT touch profiles.status', async () => {
    for (const source of ['paywall', 'upgrade_modal']) {
      const sb = stub({ ...paidRow, source }, 'pending_approval')
      const r = await decideAccessRequest(sb as never, { requestId: 'req-1', action: 'approve', actor: { id: ACTOR, kind: 'session' } })
      expect(r).toEqual({ ok: false, reason: 'assign_plan_required', userId: CLIENT })
      expect(h.apply).not.toHaveBeenCalled()
      expect(sb.updates).toHaveLength(0)
    }
  })

  it('archive still closes the request (no profiles.status change), audited as paid access', async () => {
    const sb = stub(paidRow, 'pending_approval')
    const r = await decideAccessRequest(sb as never, { requestId: 'req-1', action: 'archive', actor: { id: ACTOR, kind: 'session' } })
    expect(r).toEqual({ ok: true, status: 'archived', userId: CLIENT })
    expect(h.apply).not.toHaveBeenCalled()
    expect(sb.updates[0]).toMatchObject({ status: 'archived' })
    expect(h.audit).toHaveBeenCalledWith(expect.objectContaining({ action: 'request.status_changed', diff: expect.objectContaining({ kind: 'paid_access' }) }))
  })

  it('reject of an approved client\'s paid request is allowed (no registration transition rules) and stores the reason', async () => {
    const sb = stub({ ...paidRow, source: 'upgrade_modal' }, 'approved')
    const r = await decideAccessRequest(sb as never, { requestId: 'req-1', action: 'reject', reason: 'не целевой', actor: { id: ACTOR, kind: 'session' } })
    expect(r).toMatchObject({ ok: true, status: 'rejected' })
    expect(sb.updates[0]).toMatchObject({ status: 'rejected', rejectionReason: 'не целевой' })
    expect(h.apply).not.toHaveBeenCalled()
  })

  it('a registration request keeps the old path (profiles.status through applyApprovalDecision)', async () => {
    const sb = stub({ userId: null, type: 'registration', source: 'register', payload: { userId: CLIENT } }, 'pending_approval')
    const r = await decideAccessRequest(sb as never, { requestId: 'req-2', action: 'approve', actor: { id: ACTOR, kind: 'session' } })
    expect(r).toMatchObject({ ok: true, status: 'approved' })
    expect(h.apply).toHaveBeenCalledWith(expect.objectContaining({ userId: CLIENT, status: 'approved' }))
  })

  it('R2-C (review L-4): «Отклонить» / «Архив» from a stale list do not overwrite a request decided meanwhile → already_decided (409)', async () => {
    for (const status of ['approved', 'rejected', 'archived']) {
      const sb = stub({ ...paidRow, status }, 'approved')
      const r = await decideAccessRequest(sb as never, { requestId: 'req-1', action: 'reject', reason: 'не целевой', actor: { id: ACTOR, kind: 'session' } })
      expect(r).toEqual({ ok: false, reason: 'already_decided', userId: CLIENT })
      expect(sb.updates).toHaveLength(0)
    }
  })

  it('who may decide is still checked (nobody on their own request)', async () => {
    const sb = stub({ ...paidRow, payload: { userId: ACTOR } }, 'approved')
    const r = await decideAccessRequest(sb as never, { requestId: 'req-3', action: 'approve', actor: { id: ACTOR, kind: 'session' } })
    expect(r).toMatchObject({ ok: false, reason: 'forbidden' })
    expect(sb.updates).toHaveLength(0)
  })
})

describe('GIGA «Заявки» lists paid-access requests', () => {
  function query(table: string) {
    const rowsFor = (): Array<Record<string, unknown>> => {
      if (table === 'profiles') return [{ id: CLIENT, email: 'ivan@corp.kz', full_name: 'Иван', organization: null, status: 'approved', role: 'client', created_at: '2026-11-01T00:00:00Z' }]
      return []
    }
    let tariff = false
    const q: Record<string, unknown> = {
      select: (cols: string) => { tariff = table === 'admin_requests' && cols.includes('createdAt'); return q },
      eq: () => q, in: () => q, order: () => q, limit: () => q, range: () => q,
      maybeSingle: async () => ({ data: null, error: null }),
      // The broad read of the old code orders by a column the table does not have → an error (as on production).
      then: (resolve: (v: unknown) => unknown) => resolve(
        table === 'admin_requests'
          ? (tariff ? { data: h.tariffRows, error: null } : { data: null, error: { message: 'column admin_requests.created_at does not exist' } })
          : { data: rowsFor(), error: null },
      ),
    }
    return q
  }

  it('a paywall request appears in the «Доступы» category with the client, the sections and «Pro» source; the registration row stays', async () => {
    vi.resetModules()
    vi.doMock('@/lib/supabase-service', () => ({ createServiceClient: () => ({ from: (t: string) => query(t) }) }))
    vi.doMock('@/lib/admin/giga-actor', async (importOriginal) => {
      const actual = await importOriginal<typeof import('@/lib/admin/giga-actor')>()
      return { ...actual, requireGiga: async () => ({ actor: { id: ACTOR, kind: 'session', role: 'admin', clientScope: 'all' } }) }
    })
    vi.doMock('@/lib/admin/client-scope', async (importOriginal) => {
      const actual = await importOriginal<typeof import('@/lib/admin/client-scope')>()
      return { ...actual, scopedClientIds: async () => null }
    })
    h.tariffRows = [{
      id: 'req-9', type: 'access', status: 'new', priority: 'medium', source: 'paywall', rejectionReason: null, createdAt: '2026-11-14T09:00:00',
      payload: { userId: CLIENT, name: 'Иван', email: 'ivan@corp.kz', company: 'ТОО Ромашка', subject: 'Платный доступ: Точка А, Рынок', description: 'Клиент …', features: ['point_a', 'market'] },
    }]
    const { GET } = await import('@/app/api/giga-admin/requests/route')
    const body = await (await GET(new NextRequest('http://localhost/api/giga-admin/requests'))).json()
    const paid = body.requests.find((r: { id: string }) => r.id === 'req-9')
    expect(paid).toMatchObject({ category: 'access', status: 'pending', source: 'paywall', subject: 'Платный доступ: Точка А, Рынок', company: 'ТОО Ромашка', userEmail: 'ivan@corp.kz' })
    // the client's own registration entry is not hidden by the paid request
    expect(body.requests.some((r: { id: string; category: string }) => r.id === CLIENT && r.category === 'registration')).toBe(true)
  })
})
