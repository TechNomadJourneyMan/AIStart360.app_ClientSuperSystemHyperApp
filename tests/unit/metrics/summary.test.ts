import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  TOP_KPI_METRIC_IDS,
  buildMetricSummaries,
  formatSummaryValue,
  requestedMetricIds,
  type SummaryValueRow,
} from '@/lib/metrics/summary'
import { getMetricById } from '@/lib/metrics/registry'
import type { MetricHistoryRow } from '@/lib/metrics/catalog-helpers'

const row = (metric_key: string, metric_value: number | null, extra: Partial<SummaryValueRow> = {}): SummaryValueRow => ({
  metric_key, metric_value, metric_unit: null, source: 'survey', confidence: 0.9, provenance: null,
  computed_at: '2026-10-05T10:00:00Z', recorded_at: '2026-10-05T10:00:00Z',
  period_year: null, period_quarter: null, period_month: null, ...extra,
})
const hist = (metric_key: string, value: number, recorded_at: string): MetricHistoryRow => ({
  metric_key, value, source: 'survey', period_year: null, period_quarter: null, period_month: null, recorded_at,
})

describe('requestedMetricIds', () => {
  it('top KPIs by default — every one exists in the registry', () => {
    expect(requestedMetricIds(null, null)).toEqual(TOP_KPI_METRIC_IDS)
    for (const id of TOP_KPI_METRIC_IDS) expect(getMetricById(id), id).toBeDefined()
  })

  it('keys / ids lists, aliases, unknown ids dropped, no duplicates', () => {
    expect(requestedMetricIds('biz.finansy.vyruchka_god,kpi.obschaya_vyruchka_god', null))
      .toEqual(['biz.finansy.vyruchka_god', 'kpi.obschaya_vyruchka_god'])
    expect(requestedMetricIds('revenue, cac ,nope', 'biz.marketing.cac')).toEqual(['biz.finansy.vyruchka_god', 'biz.marketing.cac'])
    expect(requestedMetricIds('nope', null)).toEqual([])
  })
})

describe('formatSummaryValue', () => {
  it('formats money, percent, counts and custom units', () => {
    expect(formatSummaryValue(88_000_000, '₸')).toBe('₸88,0 млн')
    expect(formatSummaryValue(1_250_000_000, '₸')).toBe('₸1,25 млрд')
    expect(formatSummaryValue(50_000, '₸')).toBe('₸50 000')
    expect(formatSummaryValue(34, '%')).toBe('34%')
    expect(formatSummaryValue(12.5, '%')).toBe('12,5%')
    expect(formatSummaryValue(1240, 'count')).toBe('1 240')
    expect(formatSummaryValue(4.33, '')).toBe('4,3')
    expect(formatSummaryValue(6, 'ч/день')).toBe('6 ч/день')
  })
})

describe('buildMetricSummaries', () => {
  it('only metrics with a value, in the requested order, with history trend', () => {
    const out = buildMetricSummaries(
      ['biz.finansy.vyruchka_god', 'biz.marketing.cac', 'goal.04.ltv'],
      [
        row('biz.marketing.cac', 15_000),
        row('biz.finansy.vyruchka_god', 88_000_000, { metric_unit: '₸', source: 'document' }),
        row('goal.04.ltv', null),
      ],
      [hist('biz.marketing.cac', 15_000, '2026-10-05T10:00:00Z'), hist('biz.marketing.cac', 20_000, '2026-09-01T00:00:00Z')],
    )
    expect(out.map((s) => s.id)).toEqual(['biz.finansy.vyruchka_god', 'biz.marketing.cac'])
    expect(out[0]).toMatchObject({
      label: 'Выручка (год)', displayValue: '₸88,0 млн', rawValue: 88_000_000, unit: '₸', unitPosition: 'before',
      trend: 0, trendAbs: 0, trendDirection: 'flat', trendLabel: 'нет истории', isDefault: true, isRemovable: false,
      metricKey: 'biz.finansy.vyruchka_god', source: 'document', confidence: 0.9,
    })
    expect(out[1]).toMatchObject({ trend: -25, trendAbs: -5000, trendDirection: 'down', trendLabel: 'к прошлому значению', isDefault: false })
  })

  it('picks the most recent row per metric (the single «current value» rule)', () => {
    const out = buildMetricSummaries(['biz.finansy.valovaya_marzha'], [
      row('biz.finansy.valovaya_marzha', 30, { computed_at: '2026-09-01T00:00:00Z', source: 'document' }),
      row('biz.finansy.valovaya_marzha', 18, { source: 'calculated', provenance: { picked: { type: 'formula', formula: 'gross_margin' } } }),
    ], [])
    // Gross margin is never the step-9 net margin any more (W4) — the label is the metric's own.
    expect(out[0]).toMatchObject({ rawValue: 18, label: 'Валовая маржа', displayValue: '18%' })
  })

  it('on equal computation time the stronger source wins', () => {
    const out = buildMetricSummaries(['biz.finansy.vyruchka_god'], [
      row('biz.finansy.vyruchka_god', 40_000_000, { source: 'survey' }),
      row('biz.finansy.vyruchka_god', 52_000_000, { source: 'document' }),
    ], [])
    expect(out[0].rawValue).toBe(52_000_000)
  })
})

// ── Route ──────────────────────────────────────────────────────────────────

type Result = { data: unknown; error: { code?: string; message: string } | null }
const tables: Record<string, Result> = {}
const supabaseMock = {
  auth: { getUser: vi.fn() },
  from: vi.fn((table: string) => {
    const result = tables[table] ?? { data: [], error: null }
    const b: Record<string, unknown> = {}
    for (const m of ['select', 'eq', 'in', 'order', 'limit']) b[m] = () => b
    b.then = (res: (r: Result) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(result).then(res, rej)
    return b
  }),
}
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn(async () => supabaseMock) }))
const resolveTenantWithMock = vi.fn()
vi.mock('@/lib/tenancy', () => ({ resolveTenantWith: (...a: unknown[]) => resolveTenantWithMock(...a) }))

describe('GET /api/v1/metrics', () => {
  beforeEach(() => {
    for (const k of Object.keys(tables)) delete tables[k]
    supabaseMock.auth.getUser.mockResolvedValue({ data: { user: { id: 'u1' } } })
    resolveTenantWithMock.mockResolvedValue({ ok: true, tenant: { userId: 'u1', companyId: 'co-1', role: 'owner', canManage: true, legacy: false } })
  })
  const call = async (qs = '') => {
    const { GET } = await import('@/app/api/v1/metrics/route')
    const res = await GET(new Request(`http://localhost/api/v1/metrics${qs}`))
    return { status: res.status, body: await res.json() }
  }

  it('401 without a session', async () => {
    supabaseMock.auth.getUser.mockResolvedValue({ data: { user: null } })
    expect(await call()).toEqual({ status: 401, body: { source: 'empty', data: [] } })
  })

  it('db source with real values of the tenant company', async () => {
    tables.metrics = { data: [row('biz.finansy.vyruchka_god', 88_000_000, { metric_unit: '₸' })], error: null }
    const { status, body } = await call('?keys=biz.finansy.vyruchka_god,kpi.obschaya_vyruchka_god')
    expect(status).toBe(200)
    expect(body.source).toBe('db')
    expect(body.data).toHaveLength(1)
    expect(body.data[0]).toMatchObject({ id: 'biz.finansy.vyruchka_god', rawValue: 88_000_000 })
  })

  it('empty when the company has no values or no company yet; history table may be missing', async () => {
    tables.metric_value_history = { data: null, error: { code: '42P01', message: 'relation does not exist' } }
    expect((await call()).body).toEqual({ source: 'empty', data: [] })
    resolveTenantWithMock.mockResolvedValue({ ok: false, status: 404, error: 'no_company' })
    expect(await call()).toEqual({ status: 200, body: { source: 'empty', data: [] } })
    expect((await call('?companyId=other')).status).toBe(404)
  })

  it('500 on a metrics read error', async () => {
    tables.metrics = { data: null, error: { code: '57014', message: 'timeout' } }
    expect((await call()).status).toBe(500)
  })

  it('500 on a history read error (only a missing history table means «no trend»)', async () => {
    tables.metrics = { data: [row('biz.finansy.vyruchka_god', 88_000_000, { metric_unit: '₸' })], error: null }
    tables.metric_value_history = { data: null, error: { code: '57014', message: 'timeout' } }
    expect((await call('?keys=biz.finansy.vyruchka_god')).status).toBe(500)
  })
})
