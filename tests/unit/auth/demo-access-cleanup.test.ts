/**
 * R-224 — anonymous POST /api/auth/demo-access/cleanup must not be a UUID-existence oracle:
 * not found / not a demo user / deleted / delete failed all answer the same 200, and the
 * route is rate-limited by the trusted client IP.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const s = vi.hoisted(() => ({
  users: new Map<string, { id: string; email: string; app_metadata: Record<string, unknown>; user_metadata: Record<string, unknown> }>(),
  deleted: [] as string[],
  deleteError: null as null | { message: string },
  limited: false,
  rlCalls: [] as Array<{ bucket: string; ip: string }>,
}))

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    auth: {
      admin: {
        getUserById: async (id: string) => {
          const u = s.users.get(id)
          return u ? { data: { user: u }, error: null } : { data: { user: null }, error: { message: 'User not found' } }
        },
        deleteUser: async (id: string) => { if (!s.deleteError) s.deleted.push(id); return { error: s.deleteError } },
      },
    },
  }),
}))

vi.mock('@/lib/rate-limit', async () => {
  const { clientIpOrUnknown } = await import('@/lib/net/client-ip')
  return {
    checkRateLimitForRequest: async (req: Request, bucket: string) => {
      s.rlCalls.push({ bucket, ip: clientIpOrUnknown(req) })
      return { limited: s.limited, reason: s.limited ? 'limit' : 'ok', limit: 10, remaining: 0, retryAfterSeconds: 60, backend: 'memory' }
    },
    rateLimitResponse: (r: { retryAfterSeconds: number }) =>
      new Response(JSON.stringify({ ok: false, code: 'RATE_LIMITED' }), { status: 429, headers: { 'Retry-After': String(r.retryAfterSeconds) } }),
  }
})

const { POST } = await import('@/app/api/auth/demo-access/cleanup/route')

const DEMO = '11111111-1111-4111-8111-111111111111'
const REAL = '22222222-2222-4222-8222-222222222222'
const NONE = '33333333-3333-4333-8333-333333333333'

const call = (userId: unknown, headers: Record<string, string> = {}) =>
  POST(new Request('http://x/api/auth/demo-access/cleanup', {
    method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify({ userId }),
  }))

beforeEach(() => {
  s.users.clear()
  s.users.set(DEMO, { id: DEMO, email: 'demo-abc123@aistart360.app', app_metadata: { demo: true }, user_metadata: {} })
  s.users.set(REAL, { id: REAL, email: 'owner@example.com', app_metadata: {}, user_metadata: { demo: true } })
  s.deleted = []
  s.deleteError = null
  s.limited = false
  s.rlCalls = []
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:1'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service'
})

describe('R-224 demo-access/cleanup', () => {
  it('R-224: demo, real, missing and failed-delete UUIDs get byte-identical 200 answers', async () => {
    const bodies: string[] = []
    for (const id of [DEMO, REAL, NONE]) {
      const res = await call(id)
      expect(res.status).toBe(200)
      bodies.push(await res.text())
    }
    s.users.set(DEMO, { id: DEMO, email: 'demo-abc123@aistart360.app', app_metadata: { demo: true }, user_metadata: {} })
    s.deleteError = { message: 'db down' }
    const failed = await call(DEMO)
    expect(failed.status).toBe(200)
    bodies.push(await failed.text())
    expect(new Set(bodies).size).toBe(1)
    expect(bodies[0]).not.toContain(DEMO)
  })

  it('R-224: only the demo account is actually deleted', async () => {
    await call(DEMO)
    await call(REAL)
    expect(s.deleted).toEqual([DEMO])
  })

  it('R-224: rate-limited by the trusted client IP, not the spoofable XFF prefix', async () => {
    await call(DEMO, { 'x-forwarded-for': '6.6.6.6, 203.0.113.7' })
    expect(s.rlCalls).toEqual([{ bucket: 'demo-access-cleanup', ip: '203.0.113.7' }])
    s.limited = true
    const res = await call(NONE)
    expect(res.status).toBe(429)
    expect(s.deleted).toEqual([DEMO])
  })

  it('R-224: malformed ids are still rejected with 400', async () => {
    expect((await call('nope')).status).toBe(400)
    expect((await call(42)).status).toBe(400)
  })
})
