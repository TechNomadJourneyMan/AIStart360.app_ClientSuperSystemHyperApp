/**
 * Survey Ф5: the expert's client list carries the questionnaire status of
 * every client (mode, express, full submitted); a failed status read leaves
 * `survey: null` and never breaks the list.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const s = vi.hoisted(() => ({ broken: false }))

vi.mock('@/lib/expert-auth', () => ({
  resolveExpert: async () => ({ ok: true, viewer: { id: 'expert-1', role: 'expert', email: null } }),
  expertBlockResponse: () => new Response(null, { status: 403 }),
}))

const A = 'a0000000-0000-4000-8000-000000000001'
const B = 'b0000000-0000-4000-8000-000000000002'

vi.mock('@/lib/supabase-service', () => ({
  createServiceClient: () => {
    const tables: Record<string, Array<Record<string, unknown>>> = {
      profiles: [{ id: A, preferences: { survey: { mode: 'express', chosen_at: '2026-10-23T09:00:00Z' } } }, { id: B, preferences: null }],
      user_events: [{ user_id: A, event_name: 'SURVEY_EXPRESS_COMPLETED', created_at: '2026-10-23T09:10:00Z', metadata: { answered: 26, unknown: 0, skipped: 0 }, source: 'server' }],
    }
    return {
      rpc: async () => ({ data: [{ user_id: B, completed_at: '2026-10-20T09:00:00Z' }], error: null }),
      from(table: string) {
        if (s.broken) throw new Error('down')
        const filters: Array<(r: Record<string, unknown>) => boolean> = []
        const b = {
          select: () => b,
          in: (c: string, vs: unknown[]) => { filters.push((r) => vs.includes(r[c])); return b },
          order: () => b,
          limit: () => b,
          then: (res: (v: unknown) => unknown) => Promise.resolve({ data: (tables[table] ?? []).filter((r) => filters.every((f) => f(r))), error: null }).then(res),
        }
        return b
      },
    }
  },
}))

const { GET } = await import('@/app/api/expert/clients/route')

beforeEach(() => {
  s.broken = false
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://sb.local'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key'
  vi.stubGlobal('fetch', vi.fn(async (input: string) => {
    const table = new URL(input).pathname.split('/').pop()
    const json = (v: unknown) => new Response(JSON.stringify(v), { status: 200 })
    if (table === 'profiles') return json([A, B].map((id) => ({ id, full_name: id.slice(0, 1), email: null, avatar_url: null, status: 'approved', created_at: '2026-10-01T00:00:00Z' })))
    return json([])
  }))
})
afterEach(() => vi.unstubAllGlobals())

describe('GET /api/expert/clients — questionnaire status', () => {
  it('every client carries its status', async () => {
    const { data } = await (await GET()).json()
    const a = data.find((c: { id: string }) => c.id === A)
    const b = data.find((c: { id: string }) => c.id === B)
    expect(a.survey).toMatchObject({ mode: 'express', stuckOnExpress: true, fullPending: true, express: { answered: 26, total: 26 } })
    expect(b.survey).toMatchObject({ mode: null, fullSubmittedAt: '2026-10-20T09:00:00Z', fullPending: false })
  })

  it('a failed status read → survey null, the list still answers 200', async () => {
    s.broken = true
    const res = await GET()
    expect(res.status).toBe(200)
    const { data } = await res.json()
    expect(data).toHaveLength(2)
    expect(data.every((c: { survey: unknown }) => c.survey === null)).toBe(true)
  })
})
