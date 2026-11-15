/**
 * Ревью R3-PA — «Повторить разбор» (POST /api/v1/diagnostics/retry-ai) and a
 * direct call of POST /api/v1/diagnostics/ai-analyze:
 *   H1  a call that fails on the network marks the row failed with the reason
 *       (it used to stay «готовится» for ever); the same timeout as the
 *       automatic start;
 *   M1  never two paid analyses of one row: in progress → 409, a complete one
 *       → 409 (staff may regenerate — the cache is skipped), right after the
 *       last start → 429, five clicks at once → one call; the AI budget is
 *       checked before anything changes.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

type Row = Record<string, unknown>
const OWNER = '11111111-1111-4111-8111-111111111111'
const STAFF = '55555555-5555-4555-8555-555555555555'
const DIAG = '33333333-3333-4333-8333-333333333333'

const h = vi.hoisted(() => ({
  rows: [] as Row[],
  user: { id: '' } as { id: string } | null,
  budgetSpent: false,
  internal: false,
  analyze: vi.fn(),
}))

function fake() {
  return {
    auth: { getUser: async () => ({ data: { user: h.user }, error: null }) },
    from(table: string) {
      let op: 'select' | 'update' = 'select'
      let payload: Row = {}
      const filters: Array<(r: Row) => boolean> = []
      const src = () => (table === 'diagnostics' ? h.rows : table === 'companies' ? [{ id: 'co', user_id: OWNER, name: 'ТОО' }] : table === 'survey_answers' ? [{ user_id: OWNER, question_key: 's2_revenue_2025', answer: { value: 1 }, step: 2 }] : [])
      const run = async (single: boolean) => {
        const hit = src().filter((r) => filters.every((f) => f(r)))
        if (op === 'update') {
          for (const r of hit) Object.assign(r, payload)
          return { data: hit.map((r) => ({ id: r.id })), error: null }
        }
        return single ? { data: hit[0] ? { ...hit[0] } : null, error: null } : { data: hit, error: null }
      }
      const b: Record<string, unknown> = {
        select: () => b,
        update: (p: Row) => { op = 'update'; payload = p; return b },
        eq: (c: string, v: unknown) => { filters.push((r) => r[c] === v); return b },
        is: (c: string, v: unknown) => { filters.push((r) => (v === null ? r[c] == null : r[c] === v)); return b },
        not: () => b, like: () => b, order: () => b, limit: () => b,
        maybeSingle: () => run(true),
        single: () => run(true),
        then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => run(false).then(res, rej),
      }
      return b
    },
  }
}

vi.mock('@/lib/supabase-server', () => ({ createServerClient: () => fake() }))
vi.mock('@/lib/supabase-service', () => ({ createServiceClient: () => fake() }))
vi.mock('@/lib/rate-limit', () => ({ isRateLimitedKey: async () => false }))
vi.mock('@/lib/access/gate', () => ({ gatePaidSection: async () => null }))
vi.mock('@/lib/api-identity', async () => {
  const real = await vi.importActual<typeof import('@/lib/api-identity')>('@/lib/api-identity')
  return { ...real, getSessionUser: async () => h.user, mayActOnUser: async (_sb: unknown, caller: string, owner: string) => caller === owner || caller === STAFF }
})
vi.mock('@/lib/internal-auth', () => ({
  internalBaseUrl: () => 'https://app.test', internalFetchHeaders: () => ({}), hasValidInternalToken: () => h.internal,
}))
vi.mock('@/lib/ai/budget', async () => {
  const real = await vi.importActual<typeof import('@/lib/ai/budget')>('@/lib/ai/budget')
  return { ...real, assertAiBudget: async () => { if (h.budgetSpent) throw new real.AiBudgetExceededError('point_a_analysis', 'pro', 1, 1) } }
})
vi.mock('@/lib/ai/point-a-analyzer', () => ({ analyzePointA: (...a: unknown[]) => h.analyze(...a) }))

const retry = await import('@/app/api/v1/diagnostics/retry-ai/route')
const analyze = await import('@/app/api/v1/diagnostics/ai-analyze/route')

const post = (body: Row) => retry.POST(new NextRequest('http://localhost/api/v1/diagnostics/retry-ai', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }))
const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString()
const row = () => h.rows[0]

function diag(extra: Row = {}): Row {
  return { id: DIAG, user_id: OWNER, is_current: true, overall_score: 47, health_index: 38, stage: 'early', calculated_at: ago(60), risks: [], insights: [], quick_wins: [], data_gaps: [], ai_status: 'failed', ai_analysis: null, ai_started_at: ago(30), ...extra }
}

let fetchMock: ReturnType<typeof vi.fn>
beforeEach(() => {
  h.rows = [diag()]
  h.user = { id: OWNER }
  h.budgetSpent = false
  h.internal = false
  h.analyze.mockReset()
  fetchMock = vi.fn(async () => new Response('{"ok":true}', { status: 200 }))
  vi.stubGlobal('fetch', fetchMock)
  process.env.INTERNAL_TOKEN_SECRET = 'test-internal-secret-0123456789abcdef'
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('retry-ai (ревью R3-PA)', () => {
  it('H1: the call fails on the network → the row is failed with the reason, not «готовится» for ever', async () => {
    fetchMock.mockImplementation(async () => { throw new TypeError('fetch failed') })
    const res = await post({ diagnostic_id: DIAG })
    expect(res.status).toBe(200)
    await vi.waitFor(() => expect(row()).toMatchObject({ ai_status: 'failed', ai_error: 'fanout:TypeError' }))
    // the call carried an abort signal (the fan-out timeout)
    expect((fetchMock.mock.calls[0][1] as RequestInit).signal).toBeInstanceOf(AbortSignal)
  })

  it('M1: in progress → 409; complete → 409 for the owner; right after the last start → 429 — no call in any of them', async () => {
    h.rows = [diag({ ai_status: 'processing', ai_started_at: ago(1) })]
    expect((await post({ diagnostic_id: DIAG })).status).toBe(409)
    h.rows = [diag({ ai_status: 'completed' })]
    const done = await post({ diagnostic_id: DIAG, regenerate: true })
    expect(done.status).toBe(409)
    expect((await done.json()).error).toContain('уже готов')
    h.rows = [diag({ ai_status: 'failed', ai_started_at: ago(1) })]
    const cool = await post({ diagnostic_id: DIAG })
    expect(cool.status).toBe(429)
    expect((await cool.json()).error).toMatch(/через \d+ мин/)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('M1: five clicks at once → one paid analysis', async () => {
    const res = await Promise.all(Array.from({ length: 5 }, () => post({ diagnostic_id: DIAG })))
    expect(res.map((r) => r.status).sort()).toEqual([200, 409, 409, 409, 409])
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
  })

  it('M1: the AI budget is checked before anything changes', async () => {
    h.budgetSpent = true
    expect((await post({ diagnostic_id: DIAG })).status).toBe(429)
    expect(row().ai_status).toBe('failed')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('H1: «готовится» for 20 min (lost) → «Повторить» works', async () => {
    h.rows = [diag({ ai_status: 'processing', ai_started_at: ago(20) })]
    expect((await post({ diagnostic_id: DIAG })).status).toBe(200)
    expect(row().ai_status).toBe('processing')
    expect(Date.parse(String(row().ai_started_at))).toBeGreaterThan(Date.now() - 5_000)
  })

  it('staff may regenerate a complete analysis explicitly; the call says so', async () => {
    h.user = { id: STAFF }
    h.rows = [diag({ ai_status: 'completed', ai_started_at: ago(60) })]
    expect((await post({ diagnostic_id: DIAG })).status).toBe(409)
    expect((await post({ diagnostic_id: DIAG, regenerate: true })).status).toBe(200)
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    expect(JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body))).toMatchObject({ diagnostic_id: DIAG, regenerate: true })
  })
})

describe('ai-analyze called directly by a session (ревью R3-PA M1)', () => {
  const direct = () => analyze.POST(new NextRequest('http://localhost/api/v1/diagnostics/ai-analyze', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ diagnostic_id: DIAG, user_id: OWNER }),
  }))

  it('an analysis in progress is not started again (409, no model call)', async () => {
    h.rows = [diag({ ai_status: 'processing', ai_started_at: ago(1) })]
    const res = await direct()
    expect(res.status).toBe(409)
    expect(h.analyze).not.toHaveBeenCalled()
  })

  it('a complete one is not regenerated by the owner (409); a failed one runs', async () => {
    h.rows = [diag({ ai_status: 'completed' })]
    expect((await direct()).status).toBe(409)
    expect(h.analyze).not.toHaveBeenCalled()
    h.rows = [diag({ ai_status: 'failed', ai_started_at: ago(30) })]
    h.analyze.mockResolvedValue(null)
    expect((await direct()).status).toBe(502)
    expect(h.analyze).toHaveBeenCalledTimes(1)
  })

  it('a server-to-server call (already claimed by its caller) records when the attempt started', async () => {
    h.internal = true
    h.rows = [diag({ ai_status: 'processing', ai_started_at: ago(10) })]
    h.analyze.mockResolvedValue(null)
    await direct()
    expect(h.analyze).toHaveBeenCalledTimes(1)
  })
})
