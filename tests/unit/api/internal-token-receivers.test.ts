/**
 * Receivers of the internal fan-out verify tokens bound (lib/internal-auth v2)
 * to their own path and to the user / diagnostic they are about to act on:
 * the token recalculate mints for {ai-analyze, user, diagnostic} is accepted
 * there, and refused for another diagnostic, another user or another path.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const USER = '11111111-1111-4111-8111-111111111111'
const DIAG = '33333333-3333-4333-8333-333333333333'

// No session at all: only the internal token can admit these calls.
function fakeClient() {
  return {
    auth: { getUser: async () => ({ data: { user: null }, error: null }) },
    from() {
      const b: Record<string, unknown> = {}
      for (const m of ['select', 'eq', 'update', 'like', 'in', 'order', 'limit', 'not']) b[m] = () => b
      b.maybeSingle = async () => ({ data: null, error: null })
      b.then = (res: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(res)
      return b
    },
  }
}
vi.mock('@/lib/supabase-server', () => ({ createServerClient: () => fakeClient() }))
vi.mock('@/lib/supabase-service', () => ({ createServiceClient: () => fakeClient() }))
vi.mock('@/lib/rate-limit', () => ({ isRateLimitedKey: async () => false }))

const { internalFetchHeaders } = await import('@/lib/internal-auth')
const analyze = await import('@/app/api/v1/diagnostics/ai-analyze/route')
const pointB = await import('@/app/api/v1/diagnostics/point-b/ai-generate/route')

beforeAll(() => { process.env.INTERNAL_TOKEN_SECRET = 'test-internal-secret' })
afterAll(() => { delete process.env.INTERNAL_TOKEN_SECRET })

const ANALYZE = '/api/v1/diagnostics/ai-analyze'
const POINT_B = '/api/v1/diagnostics/point-b/ai-generate'
const req = (path: string, bind: { path?: string; userId?: string; diagnosticId?: string }) =>
  new NextRequest(`http://localhost${path}`, {
    method: 'POST',
    headers: internalFetchHeaders({}, bind),
    body: JSON.stringify({ diagnostic_id: DIAG, user_id: USER }),
  })

describe.each([
  ['ai-analyze', ANALYZE, analyze.POST],
  ['point-b/ai-generate', POINT_B, pointB.POST],
] as const)('%s', (_name, path, POST) => {
  it('accepts the token bound to its path, user and diagnostic', async () => {
    const res = await POST(req(path, { path, userId: USER, diagnosticId: DIAG }))
    // Past the gate: the (empty) double then has no diagnostic → 404.
    expect(res.status).toBe(404)
  })

  it.each([
    ['another diagnostic', { diagnosticId: '44444444-4444-4444-8444-444444444444' }],
    ['another user', { userId: '22222222-2222-4222-8222-222222222222' }],
    ['another path', { path: '/api/v1/other' }],
  ])('refuses a token bound to %s', async (_what, override) => {
    const res = await POST(req(path, { path, userId: USER, diagnosticId: DIAG, ...override }))
    expect(res.status).toBe(401)
  })
})
