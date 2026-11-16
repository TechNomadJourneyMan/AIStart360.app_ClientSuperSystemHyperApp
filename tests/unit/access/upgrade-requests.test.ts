/**
 * R2-A: «Оставить заявку на доступ» — the request staff see in GIGA
 * (admin_requests, type 'access'), one OPEN request per client (no duplicates),
 * the route (session user only, rate limit, impersonation) and the decision on
 * such a request (never changes profiles.status).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { fakeService, newRequestsDb, type FakeRequestsDb } from './fake-admin-requests'

const s = vi.hoisted(() => ({
  user: { id: '44444444-4444-4444-8444-444444444444' } as { id: string } | null,
  limited: false,
  impersonating: false,
  rlKeys: [] as Array<{ id: string; bucket: string }>,
  db: null as unknown as FakeRequestsDb,
}))

vi.mock('@/lib/supabase-server', () => ({
  createServerClient: () => ({ auth: { getUser: async () => ({ data: { user: s.user } }) } }),
}))
vi.mock('@/lib/supabase-service', async () => {
  const { fakeService: make } = await import('./fake-admin-requests')
  return { createServiceClient: () => make(s.db), requireServiceRoleKey: () => 'service' }
})
vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: async (id: string, bucket: string) => {
    s.rlKeys.push({ id, bucket })
    return { limited: s.limited, reason: s.limited ? 'limit' : 'ok', limit: 5, remaining: 0, retryAfterSeconds: 60, backend: 'memory' }
  },
  rateLimitResponse: () => new Response('{"ok":false}', { status: 429 }),
}))
vi.mock('@/lib/impersonation/server', () => ({ activeImpersonation: async () => (s.impersonating ? { uid: 'x' } : null) }))
// R4 (N4B-1): the staff notice after a stored request — covered in tests/unit/access/request-notices.test.ts.
vi.mock('@/lib/access/request-notices', () => ({ notifyStaffAccessRequested: async () => 'sent' }))

const lib = await import('@/lib/access/upgrade-requests')
const route = await import('@/app/api/v1/upgrade-request/route')

const ME = '44444444-4444-4444-8444-444444444444'
const post = (body: unknown) => route.POST(new NextRequest('http://x/api/v1/upgrade-request', {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
}))

beforeEach(() => {
  s.user = { id: ME }
  s.limited = false
  s.impersonating = false
  s.rlKeys = []
  s.db = newRequestsDb()
  s.db.profiles.push({ id: ME, full_name: 'Иван Петров', email: 'ivan@corp.kz', role: 'client' })
  s.db.companies.push({ user_id: ME, name: 'ТОО Ромашка' })
})

describe('submitAccessRequest — one open request per client', () => {
  it('creates a request staff see in GIGA: type access, source paywall, status new, the user in payload', async () => {
    const r = await lib.submitAccessRequest(fakeService(s.db) as never, { userId: ME, featureKey: 'point_a' })
    expect(r.created).toBe(true)
    expect(s.db.rows).toHaveLength(1)
    const row = s.db.rows[0]
    expect(row).toMatchObject({ type: 'access', status: 'new', source: 'paywall', priority: 'medium' })
    expect(typeof row.id).toBe('string')
    expect(row.createdAt).toBeTruthy()
    expect(row.updatedAt).toBeTruthy()
    expect(row.payload).toMatchObject({ userId: ME, featureKey: 'point_a', features: ['point_a'], name: 'Иван Петров', email: 'ivan@corp.kz', company: 'ТОО Ромашка' })
    expect(String((row.payload as Record<string, unknown>).subject)).toBe('Платный доступ: Точка А')
    // honest: the request buys nothing; the description says how staff grant it
    expect(String((row.payload as Record<string, unknown>).description)).toContain('Онлайн-оплата не подключена')
  })

  it('a repeat for the same section creates NO second row', async () => {
    const svc = fakeService(s.db) as never
    await lib.submitAccessRequest(svc, { userId: ME, featureKey: 'point_a' })
    const again = await lib.submitAccessRequest(svc, { userId: ME, featureKey: 'point_a' })
    expect(again.created).toBe(false)
    expect(s.db.rows).toHaveLength(1)
  })

  it('another section is added to the open request (still one row); hrefs of the old menus are understood', async () => {
    const svc = fakeService(s.db) as never
    await lib.submitAccessRequest(svc, { userId: ME, featureKey: 'point_a' })
    const r = await lib.submitAccessRequest(svc, { userId: ME, featureKey: '/market' })
    expect(r).toMatchObject({ created: false, features: ['point_a', 'market'] })
    expect(s.db.rows).toHaveLength(1)
    expect(String((s.db.rows[0].payload as Record<string, unknown>).subject)).toBe('Платный доступ: Точка А, Рынок')
  })

  it('an old open request of the «Pro» window (source upgrade_modal) counts as open too', async () => {
    s.db.rows.push({ id: 'old-1', type: 'access', status: 'new', source: 'upgrade_modal', payload: { userId: ME, featureKey: '/point-b' }, createdAt: '2026-10-01T00:00:00' })
    const r = await lib.submitAccessRequest(fakeService(s.db) as never, { userId: ME, featureKey: 'point_b' })
    expect(r).toMatchObject({ id: 'old-1', created: false, features: ['point_b'] })
    expect(s.db.rows).toHaveLength(1)
  })

  it('a closed request (approved / rejected / archived) does not block a new one', async () => {
    for (const status of ['approved', 'rejected', 'archived']) s.db.rows.push({ id: `c-${status}`, type: 'access', status, source: 'paywall', payload: { userId: ME, features: ['point_a'] }, createdAt: '2026-10-01T00:00:00' })
    const r = await lib.submitAccessRequest(fakeService(s.db) as never, { userId: ME, featureKey: 'point_a' })
    expect(r.created).toBe(true)
    expect(s.db.rows).toHaveLength(4)
  })

  it('requests of other users and registrations are not touched', async () => {
    s.db.rows.push({ id: 'other', type: 'access', status: 'new', source: 'paywall', payload: { userId: 'someone-else', features: ['point_a'] }, createdAt: '2026-10-01T00:00:00' })
    s.db.rows.push({ id: 'reg', type: 'registration', status: 'new', source: 'register', payload: { userId: ME }, createdAt: '2026-10-01T00:00:00' })
    const r = await lib.submitAccessRequest(fakeService(s.db) as never, { userId: ME, featureKey: 'gri_full' })
    expect(r.created).toBe(true)
    expect(s.db.rows.find((x) => x.id === 'other')?.payload).toEqual({ userId: 'someone-else', features: ['point_a'] })
  })

  it('race: two clicks in the same instant — the unique index (144) refuses the second insert, it merges into the first', async () => {
    const svc = fakeService(s.db) as never
    await lib.submitAccessRequest(svc, { userId: ME, featureKey: 'point_a' })
    s.db.hideOpenOnce = 1 // the second caller did not see the first row yet
    const r = await lib.submitAccessRequest(svc, { userId: ME, featureKey: 'market' })
    expect(r.created).toBe(false)
    expect(s.db.rows).toHaveLength(1)
    expect((s.db.rows[0].payload as Record<string, unknown>).features).toEqual(['point_a', 'market'])
  })

  it('L-4: two clicks on DIFFERENT sections at the same time — no section is lost (compare-and-swap + retry)', async () => {
    const svc = fakeService(s.db) as never
    await lib.submitAccessRequest(svc, { userId: ME, featureKey: 'point_a' })
    // A concurrent writer adds «market» between our read and our write.
    s.db.beforeUpdateOnce = (rows) => {
      const r = rows[0]
      r.payload = { ...(r.payload as Record<string, unknown>), features: ['point_a', 'market'] }
      r.updatedAt = '2099-01-01T00:00:00.000'
    }
    const res = await lib.submitAccessRequest(svc, { userId: ME, featureKey: 'gri_full' })
    expect(res.created).toBe(false)
    expect(s.db.rows).toHaveLength(1)
    expect((s.db.rows[0].payload as Record<string, unknown>).features).toEqual(['point_a', 'market', 'gri_full'])
  })

  it('L-4: the request was closed between the read and the write → the section goes into a NEW open request, never into the closed one', async () => {
    const svc = fakeService(s.db) as never
    await lib.submitAccessRequest(svc, { userId: ME, featureKey: 'point_a' })
    s.db.beforeUpdateOnce = (rows) => { rows[0].status = 'approved' }
    const res = await lib.submitAccessRequest(svc, { userId: ME, featureKey: 'market' })
    expect(res.created).toBe(true)
    expect(s.db.rows).toHaveLength(2)
    expect((s.db.rows[0].payload as Record<string, unknown>).features).toEqual(['point_a'])
    expect(s.db.rows[1]).toMatchObject({ status: 'new', payload: expect.objectContaining({ features: ['market'] }) })
  })

  it('L-5: only known sections are accepted by the API (no free text in the staff card)', async () => {
    expect(lib.isKnownRequestFeature('point_a')).toBe(true)
    expect(lib.isKnownRequestFeature('/market')).toBe(true)
    expect(lib.isKnownRequestFeature('pilot')).toBe(true)
    expect(lib.isKnownRequestFeature('Позвоните мне срочно, я директор')).toBe(false)
    expect(lib.isKnownRequestFeature(42)).toBe(false)
    const res = await post({ featureKey: 'Позвоните мне срочно, я директор' })
    expect(res.status).toBe(400)
    expect(s.db.rows).toHaveLength(0)
  })

  it('a failed insert is an error, never a silent «sent»', async () => {
    s.db.failInsert = true
    await expect(lib.submitAccessRequest(fakeService(s.db) as never, { userId: ME, featureKey: 'point_a' })).rejects.toThrow()
  })

  it('isTariffAccessRequest: only access requests from the paywall / the «Pro» window', () => {
    expect(lib.isTariffAccessRequest({ type: 'access', source: 'paywall' })).toBe(true)
    expect(lib.isTariffAccessRequest({ type: 'access', source: 'upgrade_modal' })).toBe(true)
    expect(lib.isTariffAccessRequest({ type: 'registration', source: 'paywall' })).toBe(false)
    expect(lib.isTariffAccessRequest({ type: 'access', source: 'manual' })).toBe(false)
    expect(lib.isTariffAccessRequest(null)).toBe(false)
  })
})

describe('POST / GET /api/v1/upgrade-request (R-225 checks: tests/unit/api/upgrade-request-hardening.test.ts)', () => {
  it('creates once, answers duplicate on a repeat; the user comes from the session (a body userId is ignored)', async () => {
    const first = await post({ featureKey: 'point_a' })
    expect(first.status).toBe(200)
    expect(await first.json()).toMatchObject({ ok: true, requested: true, duplicate: false })
    const second = await post({ featureKey: 'point_a', userId: 'someone-else' })
    expect(await second.json()).toMatchObject({ ok: true, requested: true, duplicate: true })
    expect(s.db.rows).toHaveLength(1)
    expect(JSON.stringify(s.db.rows[0])).toContain(ME)
    expect(JSON.stringify(s.db.rows[0])).not.toContain('someone-else')
  })

  it('«от имени» staff do not leave a request for the client (403, nothing written)', async () => {
    s.impersonating = true
    expect((await post({ featureKey: 'point_a' })).status).toBe(403)
    expect(s.db.rows).toHaveLength(0)
  })

  it('a storage failure is a 500, not «sent»', async () => {
    s.db.failInsert = true
    const res = await post({ featureKey: 'point_a' })
    expect(res.status).toBe(500)
    expect((await res.json()).ok).toBe(false)
  })

  it('GET tells whether an open request exists (the paywall shows «Заявка отправлена» after a reload)', async () => {
    expect(await (await route.GET()).json()).toMatchObject({ ok: true, requested: false, features: [] })
    await post({ featureKey: 'market' })
    expect(await (await route.GET()).json()).toMatchObject({ ok: true, requested: true, features: ['market'] })
    s.user = null
    expect((await route.GET()).status).toBe(401)
  })
})

describe('R4 (verify NV2-1): isClientAccount — both client profile roles, never staff', () => {
  function service(role: string | null, staffRole: string | null) {
    const table = (name: string) => {
      const row = name === 'profiles' ? (role === null ? null : { role }) : (staffRole === null ? null : { role: staffRole })
      const q = { select: () => q, eq: () => q, maybeSingle: async () => ({ data: row, error: null }) }
      return q
    }
    return { from: table } as never
  }
  it('client and the legacy owner role are clients; expert, admin, a client profile with a staff row are not', async () => {
    const { isClientAccount } = await import('@/lib/access/upgrade-requests')
    expect(await isClientAccount(service('client', null), 'u')).toBe(true)
    expect(await isClientAccount(service('owner', null), 'u')).toBe(true)
    expect(await isClientAccount(service('expert', null), 'u')).toBe(false)
    expect(await isClientAccount(service('admin', null), 'u')).toBe(false)
    expect(await isClientAccount(service('client', 'super_admin'), 'u')).toBe(false)
    expect(await isClientAccount(service(null, null), 'u')).toBe(false)
  })
})
