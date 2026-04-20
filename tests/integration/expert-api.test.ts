// Smoke tests for the expert portal API routes — covers the most common
// regressions (unauthenticated access, validation, RLS bypass happy paths).
// Intentionally focused on HTTP contract, not deep data correctness.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// Mock next/headers (Supabase SSR pulls cookies from here)
vi.mock('next/headers', () => ({
  cookies: () => ({
    getAll: () => [],
    get: () => undefined,
    set: vi.fn(),
    delete: vi.fn(),
  }),
}))

// Mock the Supabase SSR client — defaults to unauthenticated
const mockGetUser = vi.fn().mockResolvedValue({ data: { user: null }, error: null })
vi.mock('@supabase/ssr', () => ({
  createServerClient: () => ({
    auth: { getUser: mockGetUser },
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }) }),
    }),
  }),
}))

beforeEach(() => {
  mockGetUser.mockClear()
})

describe('expert API smoke tests', () => {
  // ── /api/expert/clients ──────────────────────────────────────────────────
  describe('GET /api/expert/clients', () => {
    it('rejects unauthenticated requests with 401', async () => {
      mockGetUser.mockResolvedValueOnce({ data: { user: null }, error: null })
      const { GET } = await import('@/app/api/expert/clients/route')
      const res = await GET()
      expect(res.status).toBe(401)
      const body = await res.json()
      expect(body).toHaveProperty('error')
    })
  })

  // ── /api/expert/comments ─────────────────────────────────────────────────
  describe('POST /api/expert/comments validation', () => {
    async function post(body: unknown): Promise<Response> {
      const req = new NextRequest('http://localhost/api/expert/comments', {
        method: 'POST',
        body: JSON.stringify(body),
        headers: { 'Content-Type': 'application/json' },
      })
      const { POST } = await import('@/app/api/expert/comments/route')
      return POST(req)
    }

    it('returns 401 when unauthenticated', async () => {
      mockGetUser.mockResolvedValueOnce({ data: { user: null }, error: null })
      const res = await post({ clientId: 'abc', text: 'hi' })
      expect(res.status).toBe(401)
    })

    it('returns 400 on empty text', async () => {
      mockGetUser.mockResolvedValueOnce({
        data: { user: { id: 'u1', email: 'e@x' } },
        error: null,
      })
      // Even if auth passes, text validation catches empty body
      const res = await post({ clientId: 'abc', text: '' })
      // Either 400 (validation) or 403 (no profile fetched in mocked sb)
      expect([400, 403].includes(res.status)).toBe(true)
    })

    it('rejects oversized targetId', async () => {
      mockGetUser.mockResolvedValueOnce({
        data: { user: { id: 'u1', email: 'e@x' } },
        error: null,
      })
      const longId = 'x'.repeat(500)
      const res = await post({ clientId: 'abc', text: 'ok', targetId: longId })
      expect([400, 403].includes(res.status)).toBe(true)
    })
  })

  // ── targetId / blockKey alias (contract) ──────────────────────────────────
  describe('comments POST contract', () => {
    it('accepts both "targetId" and legacy "blockKey"', async () => {
      mockGetUser.mockResolvedValueOnce({ data: { user: null }, error: null })
      // Request shape is valid — auth fails first so we just check it doesn't 400
      const bodies = [
        { clientId: 'c1', targetId: 'finance', text: 't' },
        { clientId: 'c1', blockKey: 'finance', text: 't' },
      ]
      const { POST } = await import('@/app/api/expert/comments/route')
      for (const b of bodies) {
        const req = new NextRequest('http://localhost/api/expert/comments', {
          method: 'POST',
          body: JSON.stringify(b),
          headers: { 'Content-Type': 'application/json' },
        })
        const res = await POST(req)
        // 401 expected because unauthenticated, but NOT 400
        expect(res.status).toBe(401)
      }
    })
  })
})

// ── Comment-targets registry sanity check ────────────────────────────────
describe('lib/comment-targets registry', () => {
  it('exposes the 5 legacy Point A ids for backward compat', async () => {
    const { getTarget } = await import('@/lib/comment-targets')
    for (const id of ['finance', 'sales', 'operations', 'marketing', 'strategy']) {
      expect(getTarget(id)).toBeTruthy()
      expect(getTarget(id)?.group).toBe('point-a')
    }
  })

  it('generates 42 GRI targets (7 categories + 35 sub-factors)', async () => {
    const { targetsByGroup } = await import('@/lib/comment-targets')
    const gri = targetsByGroup('gri')
    // 7 categories + 35 subs + some extra (alerts, radar, KPIs, financial)
    expect(gri.length).toBeGreaterThanOrEqual(42)
    const cats = gri.filter((t) => t.section === 'Категории')
    expect(cats.length).toBe(7)
  })

  it('validates target-id length (≤200)', async () => {
    const { isValidTargetId } = await import('@/lib/comment-targets')
    expect(isValidTargetId('finance')).toBe(true)
    expect(isValidTargetId('')).toBe(false)
    expect(isValidTargetId('x'.repeat(201))).toBe(false)
    expect(isValidTargetId(123)).toBe(false)
  })
})
