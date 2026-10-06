/**
 * GET /api/expert/clients at real scale: every read is paginated (PostgREST
 * caps a response at 1000 rows), id filters are chunked (a few hundred UUIDs
 * in one in.(…) overflow the URL), and a failed dependent read is a 500 —
 * never every client shown with «no company / no score / 0 comments».
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/expert-auth', () => ({
  resolveExpert: async () => ({ ok: true, viewer: { id: 'expert-1', role: 'expert', email: null } }),
  expertBlockResponse: () => new Response(null, { status: 403 }),
}))

const { GET } = await import('@/app/api/expert/clients/route')

const N = 1203
const clientId = (i: number) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`
const clients = Array.from({ length: N }, (_, i) => ({ id: clientId(i), full_name: `C${i}`, email: null, avatar_url: null, status: 'approved', created_at: '2026-10-01T00:00:00Z' }))
const MAX_URL = 4000
let urls: string[] = []
let failTable: string | null = null

function page<T>(rows: T[], url: URL): T[] {
  const limit = Math.min(Number(url.searchParams.get('limit') ?? 1000), 1000)
  const offset = Number(url.searchParams.get('offset') ?? 0)
  return rows.slice(offset, offset + limit)
}
function idsOf(url: URL, col: string): string[] {
  const m = /in\.\((.*)\)/.exec(url.searchParams.get(col) ?? '')
  return m ? m[1].split(',').map((s) => s.replace(/"/g, '')) : []
}

beforeEach(() => {
  urls = []
  failTable = null
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://sb.local'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key'
  vi.stubGlobal('fetch', vi.fn(async (input: string) => {
    urls.push(input)
    if (input.length > MAX_URL) return new Response('URI Too Long', { status: 414 })
    const url = new URL(input)
    const table = url.pathname.split('/').pop() as string
    if (table === failTable) return new Response('boom', { status: 500 })
    const json = (v: unknown) => new Response(JSON.stringify(v), { status: 200 })
    if (table === 'profiles' && url.searchParams.get('id')) return json([{ id: 'expert-1', role: 'expert' }])
    if (table === 'profiles') return json(page(clients, url))
    if (table === 'diagnostics') return json(page(idsOf(url, 'user_id').map((id) => ({ user_id: id, overall_score: 50, health_index: 40, stage: 'early', calculated_at: '2026-10-01' })), url))
    if (table === 'companies') return json(page(idsOf(url, 'user_id').map((id) => ({ user_id: id, name: `Co ${id.slice(-4)}`, industry: null, stage: null })), url))
    if (table === 'expert_comments') {
      // Client 0 has 1500 comments — more than one page on its own.
      const rows = idsOf(url, 'client_id').flatMap((id) => (id === clientId(0) ? Array.from({ length: 1500 }, () => ({ client_id: id })) : [{ client_id: id }]))
      return json(page(rows, url))
    }
    return json([])
  }))
})
afterEach(() => vi.unstubAllGlobals())

describe('GET /api/expert/clients', () => {
  it('returns every client with its company, score and full comment count', async () => {
    const res = await GET()
    expect(res.status).toBe(200)
    const { data } = await res.json()
    expect(data).toHaveLength(N)
    expect(data.every((c: { companyName: string | null; overallScore: number | null }) => c.companyName !== null && c.overallScore === 50)).toBe(true)
    expect(data.find((c: { id: string }) => c.id === clientId(0)).commentsCount).toBe(1500)
    expect(data.find((c: { id: string }) => c.id === clientId(N - 1)).commentsCount).toBe(1)
    expect(urls.every((u) => u.length <= MAX_URL)).toBe(true)
  })

  it.each(['diagnostics', 'companies', 'expert_comments'])('a failed %s read is a 500', async (table) => {
    failTable = table
    expect((await GET()).status).toBe(500)
  })
})
