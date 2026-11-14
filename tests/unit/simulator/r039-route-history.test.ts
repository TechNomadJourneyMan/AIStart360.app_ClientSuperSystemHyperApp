/**
 * R-039 (I1): POST /api/v1/simulator feeds the client's monthly revenue history into the engine.
 *   • the history is read for the caller's company (lib/tenancy), from metric_facts — never from the body;
 *   • ≥ 6 consecutive recent months → a forecast from history; fewer / a gap / stale → «нет данных для прогноза»;
 *   • no company or a failed read → no history (honest «нет данных»), never a 500.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { STALE_MONTHS, trailingMonthlyRevenue } from '@/lib/simulator/history'

type Result = { data: unknown; error: { code?: string; message: string } | null; count?: number }
const h = vi.hoisted(() => ({
  facts: { data: [], error: null } as Result,
  tenant: null as unknown,
  inserted: [] as unknown[],
  factEqs: [] as Array<[string, unknown]>,
}))

function fakeSupabase() {
  return {
    auth: { getUser: async () => ({ data: { user: { id: 'owner-1' } }, error: null }) },
    from(table: string) {
      const b: Record<string, unknown> = {}
      for (const m of ['select', 'order', 'limit']) b[m] = () => b
      b.eq = (c: string, v: unknown) => { if (table === 'metric_facts') h.factEqs.push([c, v]); return b }
      b.insert = (row: unknown) => { h.inserted.push(row); return b }
      b.single = () => Promise.resolve({ data: { id: 'sim-1' }, error: null })
      const result: Result = table === 'metric_facts' ? h.facts : { data: [], error: null, count: 0 }
      b.then = (res: (r: Result) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(result).then(res, rej)
      return b
    },
  }
}

vi.mock('@/lib/supabase-server', () => ({ createServerClient: () => fakeSupabase() }))
vi.mock('@/lib/rate-limit', () => ({ isRateLimitedKey: async () => false }))
vi.mock('@/lib/events/server', () => ({ trackUserAction: async () => {} }))
vi.mock('@/lib/tenancy', () => ({ resolveTenantWith: async () => h.tenant }))

const { POST } = await import('@/app/api/v1/simulator/route')

function monthKey(offsetFromNow: number): string {
  const d = new Date()
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - offsetFromNow, 1))
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}`
}
const fact = (period_key: string, value: number) => ({ period_key, value, source_kind: 'integration', flags: [], confidence: 0.9 })
/** n months ending last month, +2% a month. */
const history = (n: number) => Array.from({ length: n }, (_, i) => fact(monthKey(n - i), Math.round(10_000_000 * Math.pow(1.02, i))))

const run = async (input: Record<string, unknown> = {}) => {
  const body = { input: { simType: 'revenue_growth', currentRevenueMonthly: 10_000_000, marginPct: 30, horizonMonths: 12, targetRevenueMonthly: 100_000_000, ...input } }
  const res = await POST(new NextRequest('http://localhost/api/v1/simulator', { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }))
  return { status: res.status, body: await res.json() }
}

beforeEach(() => {
  h.facts = { data: [], error: null }
  h.tenant = { ok: true, tenant: { userId: 'owner-1', companyId: 'co-1', role: 'owner', canManage: true, legacy: false } }
  h.inserted = []
  h.factEqs = []
})

describe('R-039 simulator route — history', () => {
  it('8 months of history → a forecast from history, the goal is a separate verdict', async () => {
    h.facts = { data: history(8), error: null }
    const { status, body } = await run()
    expect(status).toBe(200)
    expect(h.factEqs).toContainEqual(['company_id', 'co-1'])
    expect(body.result.forecastAvailable).toBe(true)
    expect(body.result.base).toMatchObject({ source: 'history', points: 8 })
    expect(body.result.target.verdict).toBe('unrealistic')
  })

  it('no history → «нет данных для прогноза», no_forecast verdict', async () => {
    const { body } = await run()
    expect(body.result.forecastAvailable).toBe(false)
    expect(body.result.target.verdict).toBe('no_forecast')
  })

  it('no company → no history, not an error', async () => {
    h.tenant = { ok: false, status: 404, error: 'no_company' }
    h.facts = { data: history(8), error: null }
    const { status, body } = await run()
    expect(status).toBe(200)
    expect(body.result.forecastAvailable).toBe(false)
  })

  it('a failed facts read → no history, not a 500', async () => {
    h.facts = { data: null, error: { code: '57014', message: 'timeout' } }
    const { status, body } = await run()
    expect(status).toBe(200)
    expect(body.result.forecastAvailable).toBe(false)
  })

  it('a history in the body is ignored (unknown key stripped)', async () => {
    const { body } = await run({ revenueHistoryMonthly: [1, 2, 3, 4, 5, 6, 7, 8] })
    expect(body.result.forecastAvailable).toBe(false)
  })
})

describe('trailingMonthlyRevenue', () => {
  const now = new Date(Date.UTC(2026, 10, 14)) // 2026-11
  const h6 = (from: number) => Array.from({ length: 6 }, (_, i) => ({ period: `2026-${String(from + i).padStart(2, '0')}`, revenue: 100 + i }))

  it('consecutive months, oldest → newest', () => {
    expect(trailingMonthlyRevenue([...h6(5)].reverse(), now)).toEqual([100, 101, 102, 103, 104, 105])
  })
  it('a gap ends the run', () => {
    const rows = [{ period: '2026-01', revenue: 1 }, ...h6(4).filter((r) => r.period !== '2026-06')]
    expect(trailingMonthlyRevenue(rows, now)).toEqual([103, 104, 105])
  })
  it(`a run older than ${STALE_MONTHS} months is no base`, () => {
    expect(trailingMonthlyRevenue(h6(1), now)).toEqual([]) // ends 2026-06
  })
  it('crosses the year boundary', () => {
    const rows = ['2025-11', '2025-12', '2026-01', '2026-02', '2026-03', '2026-04'].map((period, i) => ({ period, revenue: i + 1 }))
    expect(trailingMonthlyRevenue(rows, new Date(Date.UTC(2026, 4, 1)))).toEqual([1, 2, 3, 4, 5, 6])
  })
})
