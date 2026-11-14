/**
 * R2-C (M-5 + Q7, decision of the PO): «Назначить Pro» right in a request for
 * paid access, and the reverse — a Pro plan set in User 360 → Биллинг closes
 * the client's open access requests. One way out for both
 * (lib/access/paid-access-grant.ts):
 *   • the plan goes through setPlan (source 'admin', the journal) with the
 *     rights of the plan editor: users.manage, the client scope, forbidTarget;
 *   • every OPEN request of the client for paid access (paywall incl. «pilot»,
 *     the old upgrade_modal) is closed as approved, audited; other clients'
 *     requests and registrations are untouched;
 *   • the client gets ONE «Доступ открыт» in the feed (dedupe by the request).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'
import type { StaffRole } from '@/lib/admin/rbac'
import { fakeService, newRequestsDb, type FakeRequestsDb } from './fake-admin-requests'

const STAFF = '00000000-0000-4000-8000-0000000000aa'
const CLIENT = '00000000-0000-4000-8000-0000000000bb'
const OTHER = '00000000-0000-4000-8000-0000000000cc'

const s = vi.hoisted(() => ({
  role: 'super_admin' as string,
  outOfScope: false,
  targetDenied: false,
  db: null as unknown as FakeRequestsDb,
  applied: true,
  beforeTier: 'free' as 'free' | 'pro',
  setPlan: [] as Array<Record<string, unknown>>,
  notices: [] as Array<{ userId: string; input: Record<string, unknown> }>,
  journal: new Set<string>(),
  audits: [] as Array<Record<string, unknown>>,
}))

vi.mock('@/lib/admin/giga-actor', async () => {
  const { makeRequireGiga } = await import('../_giga-guard')
  return {
    requireGiga: makeRequireGiga(() => ({ id: STAFF, kind: 'session', role: s.role as StaffRole })),
    forbidTarget: async () => (s.targetDenied ? NextResponse.json({ ok: false, error: 'Недостаточно прав для действий с этим сотрудником' }, { status: 403 }) : null),
  }
})
vi.mock('@/lib/admin/client-scope', async () => {
  const { makeRequireGiga } = await import('../_giga-guard')
  const requireGiga = makeRequireGiga(() => ({ id: STAFF, kind: 'session', role: s.role as StaffRole }))
  const scoped = async () => (s.outOfScope ? NextResponse.json({ ok: false, error: 'Клиент не назначен вам' }, { status: 403 }) : null)
  return {
    guardClientAccess: scoped,
    requireGigaClient: async (req: unknown, perm: never) => {
      const g = await requireGiga(req, perm)
      if (g.response) return g
      const denied = await scoped()
      return denied ? { response: denied } : g
    },
  }
})
vi.mock('@/lib/supabase-service', () => ({ createServiceClient: () => fakeService(s.db) }))
vi.mock('@/lib/audit', () => ({ logAudit: async (e: Record<string, unknown>) => { s.audits.push(e) } }))
vi.mock('@/lib/notifications/product', () => ({
  // the journal of notifyClient: a repeated dedupe key sends nothing
  notifyPaidAccessOpened: async (userId: string, input: Record<string, unknown>) => {
    const key = input.dedupeKey as string | null
    if (key && s.journal.has(key)) return { ok: true, skipped: 'duplicate', delivered: { inApp: false, email: false, telegram: false } }
    if (key) s.journal.add(key)
    s.notices.push({ userId, input })
    return { ok: true, delivered: { inApp: true, email: false, telegram: false } }
  },
}))
vi.mock('@/lib/payments/billing', async () => {
  const actual = await vi.importActual<typeof import('@/lib/payments/billing')>('@/lib/payments/billing')
  return {
    ...actual,
    setPlan: async (input: Record<string, unknown>) => {
      s.setPlan.push(input)
      if (!s.applied) return { applied: false, reason: 'not_expired', orgId: CLIENT, userId: CLIENT, before: { accessTier: s.beforeTier }, after: null }
      const tier = input.tier as string
      const periodEnd = input.periodEnd instanceof Date ? input.periodEnd.toISOString() : null
      return {
        applied: true, orgId: CLIENT, userId: CLIENT,
        before: { tier: s.beforeTier, status: s.beforeTier === 'pro' ? 'active' : 'free', periodEnd: null, accessTier: s.beforeTier },
        after: { tier, status: tier === 'free' ? 'free' : 'active', periodEnd, accessTier: tier === 'free' ? 'free' : 'pro' },
      }
    },
    getEffectivePlan: async () => ({ tier: s.beforeTier, status: 'active', periodEnd: null, accessTier: s.beforeTier }),
  }
})

const { POST: assignPro } = await import('@/app/api/giga-admin/requests/[id]/assign-pro/route')
const { PATCH: billingPatch } = await import('@/app/api/giga-admin/users/[id]/billing/route')

const req = (url: string, method: string, body?: unknown) =>
  new NextRequest(url, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
const assign = (id: string, body: unknown = {}) => assignPro(req(`http://localhost/api/giga-admin/requests/${id}/assign-pro`, 'POST', body), { params: { id } })
const billing = (body: unknown, id = CLIENT) => billingPatch(req(`http://localhost/api/giga-admin/users/${id}/billing`, 'PATCH', body), { params: { id } })

function row(id: string, over: Record<string, unknown> = {}) {
  return { id, type: 'access', source: 'paywall', status: 'new', priority: 'medium', createdAt: '2026-11-14T09:00:00Z', updatedAt: '2026-11-14T09:00:00Z', payload: { userId: CLIENT, features: ['point_a'] }, ...over }
}
const statusOf = (id: string) => s.db.rows.find((r) => r.id === id)?.status

beforeEach(() => {
  s.role = 'super_admin'
  s.outOfScope = false
  s.targetDenied = false
  s.applied = true
  s.beforeTier = 'free'
  s.setPlan = []
  s.notices = []
  s.journal = new Set()
  s.audits = []
  s.db = newRequestsDb()
  s.db.rows.push(
    row('req-1'),
    row('req-pilot', { payload: { userId: CLIENT, features: ['pilot'] }, createdAt: '2026-11-13T09:00:00Z' }),
    row('req-old', { source: 'upgrade_modal', status: 'in_review', createdAt: '2026-11-01T09:00:00Z' }),
    row('req-other', { payload: { userId: OTHER, features: ['market'] } }),
    row('req-registration', { type: 'registration', source: 'register' }),
    row('req-done', { status: 'rejected' }),
  )
})

describe('«Назначить Pro» from a request', () => {
  it('assigns Pro through setPlan, closes every open access request of the client as approved, notifies once', async () => {
    const before = Date.now()
    const res = await assign('req-1', { months: 3, note: 'созвонились' })
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body).toMatchObject({ ok: true, userId: CLIENT, requestClosed: true, notified: true })
    expect(new Set(body.closedRequests)).toEqual(new Set(['req-1', 'req-pilot', 'req-old']))

    expect(s.setPlan).toHaveLength(1)
    const plan = s.setPlan[0]
    expect(plan).toMatchObject({ userId: CLIENT, tier: 'pro', source: 'admin', note: 'созвонились', meta: { via: 'access_request', request_id: 'req-1', months: 3 } })
    expect(plan.actor).toMatchObject({ id: STAFF })
    const end = (plan.periodEnd as Date).getTime()
    expect(end).toBeGreaterThan(before + 85 * 86_400_000)
    expect(end).toBeLessThan(before + 95 * 86_400_000)

    expect(statusOf('req-1')).toBe('approved')
    expect(statusOf('req-pilot')).toBe('approved')
    expect(statusOf('req-old')).toBe('approved')
    // untouched: another client's request, a registration, an already decided request
    expect(statusOf('req-other')).toBe('new')
    expect(statusOf('req-registration')).toBe('new')
    expect(statusOf('req-done')).toBe('rejected')

    expect(s.audits.filter((a) => a.action === 'request.approved')).toHaveLength(3)
    expect(s.audits[0]).toMatchObject({ performedBy: STAFF, diff: expect.objectContaining({ kind: 'paid_access', via: 'request', userId: CLIENT }) })
    expect(s.notices).toEqual([{ userId: CLIENT, input: { periodEnd: expect.any(String), dedupeKey: 'paid_access_opened:req-1' } }])
  })

  it('no period → Pro without an end date; the default note names the sections', async () => {
    await assign('req-1')
    expect(s.setPlan[0]).toMatchObject({ periodEnd: null, note: 'По заявке на доступ: Точка А' })
  })

  it('the rights of the plan editor: without users.manage → 403, nothing changed', async () => {
    for (const role of ['analyst', 'support', 'super_expert', 'content_manager']) {
      s.role = role
      expect((await assign('req-1', { months: 1 })).status, role).toBe(403)
    }
    expect(s.setPlan).toHaveLength(0)
    expect(statusOf('req-1')).toBe('new')
    expect(s.notices).toHaveLength(0)
    s.role = 'crm_manager'
    expect((await assign('req-1', { months: 1 })).status).toBe(200)
  })

  it('outside the actor\'s client scope / a protected target / his own request → 403, nothing changed', async () => {
    s.outOfScope = true
    expect((await assign('req-1')).status).toBe(403)
    s.outOfScope = false
    s.targetDenied = true
    expect((await assign('req-1')).status).toBe(403)
    s.targetDenied = false
    s.db.rows.push(row('req-self', { payload: { userId: STAFF } }))
    expect((await assign('req-self')).status).toBe(403)
    expect(s.setPlan).toHaveLength(0)
  })

  it('only an open request for paid access: registration / unknown → 404, decided → 409; a bad period → 422', async () => {
    expect((await assign('req-registration')).status).toBe(404)
    expect((await assign('nope')).status).toBe(404)
    expect((await assign('req-done')).status).toBe(409)
    expect((await assign('req-1', { months: 40 })).status).toBe(422)
    expect((await assign('req-1', { periodEnd: '2020-01-01' })).status).toBe(422)
    expect(s.setPlan).toHaveLength(0)
  })

  it('the plan was not applied → 409, the request stays open, no notice', async () => {
    s.applied = false
    expect((await assign('req-1')).status).toBe(409)
    expect(statusOf('req-1')).toBe('new')
    expect(s.notices).toHaveLength(0)
  })
})

describe('User 360 → Биллинг closes the open requests too', () => {
  it('Pro for a Free client: his open requests close as approved, one notice; the answer says so', async () => {
    const res = await billing({ action: 'set', tier: 'pro', months: 1 })
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(new Set(body.closedRequests)).toEqual(new Set(['req-1', 'req-pilot', 'req-old']))
    expect(body.notified).toBe(true)
    expect(statusOf('req-other')).toBe('new')
    expect(statusOf('req-registration')).toBe('new')
    expect(s.notices).toHaveLength(1)
    expect(s.audits[0]).toMatchObject({ diff: expect.objectContaining({ via: 'billing' }) })
  })

  it('no duplicates: Pro from the request, then the plan edited in Биллинг → still ONE notice', async () => {
    await assign('req-1', { months: 1 })
    s.beforeTier = 'pro' // the client is Pro now
    await billing({ action: 'set', tier: 'pro', months: 6 })
    await billing({ action: 'extend', months: 1 })
    expect(s.notices).toHaveLength(1)
  })

  it('a Free client without requests gets «Доступ открыт» when the plan opens access; setting Free closes nothing', async () => {
    s.db.rows = []
    await billing({ action: 'set', tier: 'pro' })
    expect(s.notices).toHaveLength(1)
    s.notices = []
    s.db.rows.push(row('req-1'))
    await billing({ action: 'set', tier: 'free' })
    expect(statusOf('req-1')).toBe('new')
    expect(s.notices).toHaveLength(0)
  })
})
