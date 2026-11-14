/**
 * R-040 (I1): GET /api/v1/metrics/[id]/forecast answers with the status of the forecast.
 *   • `status` / `reason` / `n` from forecastSeries, `confidence` from the fit (never the old constant 0.7);
 *   • edits of a value (no business periods) → no forecast, the reason says why;
 *   • the business periods come from metric_facts (migration 110, rebuilt on every materialisation) when the
 *     value history has fewer of them: the materialiser keeps ONE current row per metric, so the history rarely
 *     carries periods — without the facts the forecast would vanish for everyone;
 *   • invalid facts and non-calendar period keys ('2026-YTD', 'unknown') are not periods.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { factsToPoints } from '@/lib/metrics/timeseries-fetch'

type Result = { data: unknown; error: { code?: string; message: string } | null }
const h = vi.hoisted(() => ({ tables: {} as Record<string, Result>, tenant: null as unknown }))

function fakeSupabase() {
  return {
    auth: { getUser: async () => ({ data: { user: { id: 'owner-1' } }, error: null }) },
    from(table: string) {
      const result = h.tables[table] ?? { data: [], error: null }
      const b: Record<string, unknown> = {}
      for (const m of ['select', 'order', 'limit', 'gte', 'in', 'eq']) b[m] = () => b
      b.then = (res: (r: Result) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(result).then(res, rej)
      return b
    },
  }
}

vi.mock('@/lib/supabase/server', () => ({ createClient: async () => fakeSupabase() }))
vi.mock('@/lib/tenancy', () => ({
  resolveTenantWith: async () => h.tenant,
  tenantErrorMessage: () => 'Нет доступа к компании',
}))

const { GET } = await import('@/app/api/v1/metrics/[id]/forecast/route')

const call = async (metric = 'biz.finansy.vyruchka_god') => {
  const res = await GET(new NextRequest(`http://localhost/api/v1/metrics/${metric}/forecast?period=3M`), { params: { id: metric } })
  return { status: res.status, body: await res.json() }
}
const edit = (value: number, at: string) => ({ value, source: 'survey', period_year: null, period_quarter: null, period_month: null, recorded_at: at })
const fact = (period_key: string, value: number, extra: Record<string, unknown> = {}) => {
  const [y, m] = period_key.split('-')
  return { period_key, period_year: Number(y), period_quarter: null, period_month: m && /^\d+$/.test(m) ? Number(m) : null, value, source_kind: 'document', flags: [], confidence: 0.8, ...extra }
}
const months = (n: number, start = 100) => Array.from({ length: n }, (_, i) => fact(`2026-${String(i + 1).padStart(2, '0')}`, start + i * 10))

beforeEach(() => {
  h.tenant = { ok: true, tenant: { userId: 'owner-1', companyId: 'co-1', role: 'owner', canManage: true, legacy: false } }
  h.tables = {
    metric_value_history: { data: [edit(100, '2026-10-01T00:00:00Z'), edit(120, '2026-10-05T00:00:00Z')], error: null },
    metric_facts: { data: [], error: null },
  }
})

describe('R-040 forecast route — status and reason', () => {
  it('edits only → no forecast, status not_business_periods, a reason, confidence null (not 0.7)', async () => {
    const { status, body } = await call()
    expect(status).toBe(200)
    expect(body.data).toEqual([])
    expect(body.status).toBe('not_business_periods')
    expect(typeof body.reason).toBe('string')
    expect(body.confidence).toBeNull()
  })

  it('fewer than 6 periods in the facts → insufficient_data with «Мало данных»', async () => {
    h.tables.metric_facts = { data: months(4), error: null }
    const { body } = await call()
    expect(body.status).toBe('insufficient_data')
    expect(body.reason).toMatch(/Мало данных/)
    expect(body.n).toBe(4)
  })

  it('6+ monthly facts → a forecast with a computed confidence', async () => {
    h.tables.metric_facts = { data: months(8), error: null }
    const { body } = await call()
    expect(body.status).toBe('ok')
    expect(body.reason).toBeNull()
    expect(body.data.length).toBeGreaterThan(0)
    expect(body.n).toBe(8)
    expect(typeof body.confidence).toBe('number')
    expect(body.confidence).not.toBe(0.7)
  })

  it('a missing facts table is «no facts», not a 500', async () => {
    h.tables.metric_facts = { data: null, error: { code: '42P01', message: 'relation does not exist' } }
    const { status, body } = await call()
    expect(status).toBe(200)
    expect(body.status).toBe('not_business_periods')
  })
})

describe('factsToPoints', () => {
  it('skips invalid facts and non-calendar keys; one point per period, the best source wins', () => {
    const pts = factsToPoints([
      fact('2026-01', 100),
      fact('2026-01', 999, { source_kind: 'integration' }), // lower priority than document
      fact('2026-02', 110, { flags: ['invalid'] }),
      fact('2026-YTD', 500),
      { ...fact('unknown', 1), period_year: null },
      fact('2025', 1200),
      { ...fact('2025-Q4', 300), period_quarter: 4, period_month: null },
    ])
    expect(pts.map((p) => [p.period, p.value])).toHaveLength(3)
    expect(pts.map((p) => [p.period, p.value])).toEqual(expect.arrayContaining([['2025-Q4', 300], ['2025', 1200], ['2026-01', 100]]))
    expect(pts[pts.length - 1].period).toBe('2026-01')
    expect(pts.every((p) => p.basis === 'period')).toBe(true)
  })
})

describe('forecastUnavailableNote (the metric window)', async () => {
  const { forecastUnavailableNote } = await import('@/hooks/useTimeseries')
  it('«Мало данных для прогноза (нужно 6 периодов)» below 6 periods, the reason for edits, nothing when ok', () => {
    expect(forecastUnavailableNote({ status: 'insufficient_data', reason: 'x' })).toBe('Мало данных для прогноза (нужно 6 периодов)')
    expect(forecastUnavailableNote({ status: 'not_business_periods', reason: 'Только правки' })).toBe('Только правки')
    expect(forecastUnavailableNote({ status: 'ok', reason: null })).toBeNull()
    expect(forecastUnavailableNote(undefined)).toBeNull()
  })
})
