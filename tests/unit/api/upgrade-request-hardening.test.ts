/** R-225 — POST /api/v1/upgrade-request: per-user rate limit and a bounded featureKey (Zod). */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const s = vi.hoisted(() => ({
  user: { id: '44444444-4444-4444-8444-444444444444' } as { id: string } | null,
  limited: false,
  rlKeys: [] as Array<{ id: string; bucket: string }>,
  created: [] as unknown[],
}))

vi.mock('@/lib/supabase-server', () => ({
  createServerClient: () => ({ auth: { getUser: async () => ({ data: { user: s.user } }) } }),
}))
vi.mock('@/lib/supabase-service', () => ({ requireServiceRoleKey: () => 'service' }))
vi.mock('@/lib/db', () => ({ prisma: { adminRequest: { create: async (a: unknown) => { s.created.push(a) } } } }))
vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: async (id: string, bucket: string) => {
    s.rlKeys.push({ id, bucket })
    return { limited: s.limited, reason: s.limited ? 'limit' : 'ok', limit: 5, remaining: 0, retryAfterSeconds: 60, backend: 'memory' }
  },
  rateLimitResponse: () => new Response('{"ok":false}', { status: 429 }),
}))

const fetchMock = vi.fn(async (_url: string) => new Response(JSON.stringify([{ full_name: 'A', email: 'a@x' }]), { status: 200 }))
vi.stubGlobal('fetch', fetchMock)

const { POST } = await import('@/app/api/v1/upgrade-request/route')

const call = (body: unknown) => POST(new NextRequest('http://x/api/v1/upgrade-request', {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
}))

beforeEach(() => {
  s.user = { id: '44444444-4444-4444-8444-444444444444' }
  s.limited = false
  s.rlKeys = []
  s.created = []
  fetchMock.mockClear()
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:1'
})

describe('R-225 upgrade-request', () => {
  it('R-225: accepts the keys the UI sends (extra userId from MobileNav is ignored)', async () => {
    expect((await call({ featureKey: '/point-b' })).status).toBe(200)
    expect((await call({ featureKey: '/metrics', userId: 'someone-else' })).status).toBe(200)
    expect(s.created).toHaveLength(2)
    expect(JSON.stringify(s.created[1])).toContain('44444444-4444-4444-8444-444444444444')
    expect(JSON.stringify(s.created[1])).not.toContain('someone-else')
  })

  it('R-225: rejects an over-long, empty or non-string featureKey with 400 and writes nothing', async () => {
    for (const featureKey of ['x'.repeat(5000), '', '   ', 42, null]) {
      expect((await call({ featureKey })).status).toBe(400)
    }
    expect(s.created).toHaveLength(0)
  })

  it('R-225: rate-limited per session user; a limited call writes nothing', async () => {
    s.limited = true
    expect((await call({ featureKey: '/point-b' })).status).toBe(429)
    expect(s.rlKeys).toEqual([{ id: '44444444-4444-4444-8444-444444444444', bucket: 'upgrade-request' }])
    expect(s.created).toHaveLength(0)
  })

  it('R-225: unauthenticated callers are refused before the limiter', async () => {
    s.user = null
    expect((await call({ featureKey: '/point-b' })).status).toBe(401)
    expect(s.rlKeys).toHaveLength(0)
  })

  it('R-225: the PostgREST filter value is URL-encoded', async () => {
    await call({ featureKey: '/point-b' })
    expect(String(fetchMock.mock.calls[0][0])).toContain('id=eq.44444444-4444-4444-8444-444444444444&select=')
  })
})
