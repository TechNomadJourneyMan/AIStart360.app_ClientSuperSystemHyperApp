/**
 * R-225 — POST /api/v1/upgrade-request: per-user rate limit and a bounded featureKey (Zod).
 * Round 2 (R2-A): the request is stored by lib/access/upgrade-requests.ts (one open request
 * per user) — de-duplication and GET are covered in tests/unit/access/upgrade-requests.test.ts.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { newRequestsDb, type FakeRequestsDb } from '../access/fake-admin-requests'

const s = vi.hoisted(() => ({
  user: { id: '44444444-4444-4444-8444-444444444444' } as { id: string } | null,
  limited: false,
  rlKeys: [] as Array<{ id: string; bucket: string }>,
  db: null as unknown as FakeRequestsDb,
}))

vi.mock('@/lib/supabase-server', () => ({
  createServerClient: () => ({ auth: { getUser: async () => ({ data: { user: s.user } }) } }),
}))
vi.mock('@/lib/supabase-service', async () => {
  const { fakeService } = await import('../access/fake-admin-requests')
  return { createServiceClient: () => fakeService(s.db), requireServiceRoleKey: () => 'service' }
})
vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: async (id: string, bucket: string) => {
    s.rlKeys.push({ id, bucket })
    return { limited: s.limited, reason: s.limited ? 'limit' : 'ok', limit: 5, remaining: 0, retryAfterSeconds: 60, backend: 'memory' }
  },
  rateLimitResponse: () => new Response('{"ok":false}', { status: 429 }),
}))
vi.mock('@/lib/impersonation/server', () => ({ activeImpersonation: async () => null }))
// R4 (N4B-1): the staff notice after a stored request — covered in tests/unit/access/request-notices.test.ts.
vi.mock('@/lib/access/request-notices', () => ({ notifyStaffAccessRequested: async () => 'sent' }))

const { POST } = await import('@/app/api/v1/upgrade-request/route')

const call = (body: unknown) => POST(new NextRequest('http://x/api/v1/upgrade-request', {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
}))

beforeEach(() => {
  s.user = { id: '44444444-4444-4444-8444-444444444444' }
  s.limited = false
  s.rlKeys = []
  s.db = newRequestsDb()
  // R4 (review WB-6): only a client asks for paid access.
  s.db.profiles.push({ id: '44444444-4444-4444-8444-444444444444', role: 'client' })
})

describe('R-225 upgrade-request', () => {
  it('R-225: accepts the keys the UI sends (extra userId from MobileNav is ignored)', async () => {
    expect((await call({ featureKey: '/point-b' })).status).toBe(200)
    expect((await call({ featureKey: '/metrics', userId: 'someone-else' })).status).toBe(200)
    // Round 2: one open request per user — the second section is added to it.
    expect(s.db.rows).toHaveLength(1)
    expect((s.db.rows[0].payload as Record<string, unknown>).features).toEqual(['point_b', 'metrics'])
    expect(JSON.stringify(s.db.rows[0])).toContain('44444444-4444-4444-8444-444444444444')
    expect(JSON.stringify(s.db.rows[0])).not.toContain('someone-else')
  })

  it('R-225: rejects an over-long, empty or non-string featureKey with 400 and writes nothing', async () => {
    for (const featureKey of ['x'.repeat(5000), '', '   ', 42, null]) {
      expect((await call({ featureKey })).status).toBe(400)
    }
    expect(s.db.rows).toHaveLength(0)
  })

  it('R-225: rate-limited per session user; a limited call writes nothing', async () => {
    s.limited = true
    expect((await call({ featureKey: '/point-b' })).status).toBe(429)
    expect(s.rlKeys).toEqual([{ id: '44444444-4444-4444-8444-444444444444', bucket: 'upgrade-request' }])
    expect(s.db.rows).toHaveLength(0)
  })

  it('R-225: unauthenticated callers are refused before the limiter', async () => {
    s.user = null
    expect((await call({ featureKey: '/point-b' })).status).toBe(401)
    expect(s.rlKeys).toHaveLength(0)
  })
})
