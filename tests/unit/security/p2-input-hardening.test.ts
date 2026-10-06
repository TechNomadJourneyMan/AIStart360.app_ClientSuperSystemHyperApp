/**
 * Security P2-1 / P2-15 — small endpoint hardenings:
 *  - (POST /api/notifications/send — retired, then removed with NextAuth);
 *  - POST /api/medical/audit/run refuses a non-UUID documentId before it is
 *    interpolated into a PostgREST filter;
 *  - GET /api/v1/point-a/benchmarks ignores ?user_id= (always the caller's own
 *    diagnostic) and reports a DB error instead of hiding it;
 *  - the market proxy refuses dot / slash / query segments that would leave
 *    the allowlisted upstream prefix while carrying the user's bearer token.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const s = vi.hoisted(() => ({
  user: { id: 'me' } as null | { id: string },
  diagFilters: [] as Array<[string, unknown]>,
  diagError: null as null | { code: string; message: string },
}))

vi.mock('@/lib/supabase-server', () => ({
  createServerClient: () => ({
    auth: { getUser: async () => ({ data: { user: s.user } }) },
    from: () => {
      const q = {
        select: () => q,
        eq: (c: string, v: unknown) => { s.diagFilters.push([c, v]); return q },
        maybeSingle: async () => ({ data: s.diagError ? null : null, error: s.diagError }),
      }
      return q
    },
  }),
}))
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({ data: { user: s.user } }),
      getSession: async () => ({ data: { session: { access_token: 'user-jwt' } } }),
    },
  }),
}))
vi.mock('@/lib/supabase-service', () => ({ requireServiceRoleKey: () => 'service-key' }))

const fetchMock = vi.fn(async () => new Response('[]', { status: 200 }))

beforeEach(() => {
  s.user = { id: 'me' }
  s.diagFilters = []
  s.diagError = null
  fetchMock.mockClear()
  vi.stubGlobal('fetch', fetchMock)
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://sb.example'
  process.env.MARKET_API_URL = 'https://market.example/api/v1'
})
afterEach(() => vi.unstubAllGlobals())

describe('POST /api/medical/audit/run — documentId', () => {
  const run = async (documentId: unknown) => {
    const { POST } = await import('@/app/api/medical/audit/run/route')
    return POST(new NextRequest('http://localhost/api/medical/audit/run', { method: 'POST', body: JSON.stringify({ documentId }) }))
  }

  it.each(['x&user_id=eq.someone', '1,2', 'not-a-uuid', 42])('refuses %s with 400 before querying', async (id) => {
    const res = await run(id)
    expect(res.status).toBe(400)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('a UUID is queried (URL-encoded)', async () => {
    const id = '11111111-2222-3333-4444-555555555555'
    const res = await run(id)
    expect(res.status).toBe(404) // fetch mock returns no rows
    expect(String((fetchMock.mock.calls[0] as unknown[])[0])).toContain(`documents?id=eq.${id}&select=`)
  })
})

describe('GET /api/v1/point-a/benchmarks', () => {
  const get = async (qs: string) => {
    const { GET } = await import('@/app/api/v1/point-a/benchmarks/route')
    const { BENCHMARKS } = await import('@/lib/point-a/benchmarks')
    const row = BENCHMARKS[0]
    return GET(new NextRequest(`http://localhost/api/v1/point-a/benchmarks?industry=${encodeURIComponent(row.industry)}&stage=${row.stage}${qs}`))
  }

  it('ignores ?user_id= and reads the caller’s own diagnostic', async () => {
    const res = await get('&user_id=victim')
    expect(res.status).toBe(200)
    expect(s.diagFilters).toContainEqual(['user_id', 'me'])
    expect(s.diagFilters).not.toContainEqual(['user_id', 'victim'])
  })

  it('an anonymous caller gets the benchmark without any diagnostic read, user_id or not', async () => {
    s.user = null
    const res = await get('&user_id=victim')
    expect(res.status).toBe(200)
    expect((await res.json()).data.comparison).toBeNull()
    expect(s.diagFilters).toEqual([])
  })

  it('a DB error is reported, not hidden as "no diagnostic"', async () => {
    s.diagError = { code: '57014', message: 'timeout' }
    expect((await get('')).status).toBe(500)
  })
})

describe('market proxy /api/market/[...path]', () => {
  const call = async (path: string[]) => {
    const { GET } = await import('@/app/api/market/[...path]/route')
    return GET(new Request('http://localhost/api/market/x?limit=10'), { params: { path } })
  }

  it.each([
    [['companies', '..', 'admin']],
    [['companies', '.']],
    [['companies', 'a/b']],
    [['companies', 'a?b']],
    [['companies', 'a#b']],
    [['companies', 'a\\b']],
    [['companies', '']],
    [['companies', 'a\nb']],
  ])('refuses %j without contacting the upstream', async (path) => {
    expect((await call(path)).status).toBe(404)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('forwards an allowlisted path under the base URL with the user token', async () => {
    const res = await call(['companies', '123', 'timeline'])
    expect(res.status).toBe(200)
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://market.example/api/v1/companies/123/timeline?limit=10')
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer user-jwt')
  })

  it('a literal percent sequence stays one encoded segment (no second decode)', async () => {
    await call(['companies', '..%2F..', 'x'])
    expect((fetchMock.mock.calls[0] as unknown as [string])[0]).toBe('https://market.example/api/v1/companies/..%252F../x?limit=10')
  })

  it('still refuses paths outside the allowlist', async () => {
    expect((await call(['admin', 'users'])).status).toBe(404)
  })
})
