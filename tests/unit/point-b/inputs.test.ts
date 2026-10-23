import { describe, it, expect, vi } from 'vitest'
import { commDb, type Row } from '../comm/_db'
import { loadPointBInputs } from '@/lib/point-b/inputs'
import { diagToPointA } from '@/lib/point-b/adapters'

const NOW = new Date('2026-10-18T09:00:00Z')
const REVENUE = 'biz.finansy.vyruchka_god'

const block = (score: number) => ({ score, status: 'average', top_issues: [], recommendations: [] })
function diagnostic(over: Row = {}): Row {
  return {
    id: 'd1', user_id: 'u1', company_id: 'c1', is_current: true, calculated_at: '2026-10-01T00:00:00Z',
    overall_score: 55, health_index: 50, stage: 'growth',
    finance_score: block(60), sales_score: block(50), operations_score: block(55), marketing_score: block(45), strategy_score: block(40),
    ...over,
  }
}
function snapshot(over: Row = {}): Row {
  return {
    id: 's1', company_id: 'c1', engine: 'v4', confidence: '0.620', coverage: '0.700', created_at: '2026-10-10T00:00:00Z',
    blocks: [
      { key: 'finance', score: 60, status: 'ok' },
      { key: 'sales', score: null, status: 'insufficient_data' },
    ],
    inputs: { metrics: { [REVENUE]: { value: 60_000_000, source: 'survey', period: '2024' } }, answers: {}, conflicts: [], config: '' },
    ...over,
  }
}
function revenueRow(over: Row = {}): Row {
  return { company_id: 'c1', metric_key: REVENUE, metric_value: 60_000_000, source: 'survey', period_year: 2024, computed_at: '2026-10-01T00:00:00Z', ...over }
}
function seed(extra: Record<string, Row[]> = {}) {
  return commDb({
    diagnostics: [diagnostic()],
    companies: [{ id: 'c1', user_id: 'u1', target_revenue_12m_kzt: null, target_revenue_3y_kzt: null }],
    point_a_snapshots: [],
    metric_targets: [],
    metrics: [],
    survey_answers: [],
    gri_assessments: [],
    ...extra,
  })
}

describe('loadPointBInputs', () => {
  it('reads the v4 snapshot and lists blocks without data', async () => {
    const { sb } = seed({ point_a_snapshots: [snapshot()] })
    const r = await loadPointBInputs(sb, 'u1', { now: NOW })
    expect(r.snapshot).toMatchObject({ id: 's1', engine: 'v4', confidence: 0.62, coverage: 0.7 })
    expect(r.blocksWithoutData).toEqual(['sales'])
  })

  it('takes the newest snapshot of the company', async () => {
    const old = snapshot({ id: 's0', created_at: '2026-09-01T00:00:00Z', blocks: [{ key: 'finance', score: null }] })
    const { sb } = seed({ point_a_snapshots: [old, snapshot()] })
    const r = await loadPointBInputs(sb, 'u1', { now: NOW })
    expect(r.snapshot?.id).toBe('s1')
    expect(r.blocksWithoutData).toEqual(['sales'])
  })

  it('a v1 snapshot or no snapshot gives no blocksWithoutData and snapshot null for none', async () => {
    const none = await loadPointBInputs(seed().sb, 'u1', { now: NOW })
    expect(none.snapshot).toBeNull()
    expect(none.blocksWithoutData).toEqual([])
    const v1 = await loadPointBInputs(seed({ point_a_snapshots: [snapshot({ engine: 'v1' })] }).sb, 'u1', { now: NOW })
    expect(v1.snapshot?.engine).toBe('v1')
    expect(v1.blocksWithoutData).toEqual([])
  })

  it('a v1 FALLBACK of a v4 company (express only: no v4 overall) reads blocks without data from the v4 blocks (survey Ф2)', async () => {
    // The diagnostics row is v1 (unanswered = 0) — those zeros must not become «weak» blocks.
    const fallback = snapshot({ engine: 'v1', config_version: 'default@1|v4', blocks: [{ key: 'finance', score: null }, { key: 'sales', score: null }, { key: 'operations', score: 80 }] })
    const r = await loadPointBInputs(seed({ point_a_snapshots: [fallback] }).sb, 'u1', { now: NOW })
    expect(r.blocksWithoutData).toEqual(['finance', 'sales'])
  })

  it('no diagnostic gives pointA null and does not throw', async () => {
    const { sb } = seed({ diagnostics: [] })
    const r = await loadPointBInputs(sb, 'u1', { now: NOW })
    expect(r.diagnostic).toBeNull()
    expect(r.pointA).toBeNull()
    expect(r.blocksWithoutData).toEqual([])
  })

  it('a diagnostic block that is missing is reported as without data, not as a silent zero', async () => {
    const { sb } = seed({ diagnostics: [diagnostic({ marketing_score: null })] })
    const r = await loadPointBInputs(sb, 'u1', { now: NOW })
    expect(r.blocksWithoutData).toEqual(['marketing'])
  })

  it('a read failure of the snapshot is logged and yields no snapshot', async () => {
    const { sb } = seed()
    const real = sb.from.bind(sb)
    ;(sb as unknown as { from: (t: string) => unknown }).from = (t: string) => {
      if (t !== 'point_a_snapshots') return real(t)
      const err = { data: null, error: { code: 'XX000', message: 'boom' } }
      const b: Record<string, unknown> = {}
      for (const m of ['select', 'eq', 'order', 'limit']) b[m] = () => b
      b.then = (res: (v: unknown) => unknown) => Promise.resolve(err).then(res)
      return b
    }
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const r = await loadPointBInputs(sb, 'u1', { now: NOW })
    spy.mockRestore()
    expect(r.snapshot).toBeNull()
    expect(r.pointA).not.toBeNull()
  })

  it('goals come from metric_targets, falling back to companies.target_revenue_*', async () => {
    const fromTargets = seed({
      metric_targets: [
        { id: 't1', company_id: 'c1', metric_key: REVENUE, target_value: 120_000_000, period_label: '12m', direction: 'higher_is_better', source: 'owner', created_at: '2026-10-01T00:00:00Z' },
      ],
      companies: [{ id: 'c1', user_id: 'u1', target_revenue_12m_kzt: 99_000_000, target_revenue_3y_kzt: 600_000_000 }],
    })
    const r = await loadPointBInputs(fromTargets.sb, 'u1', { now: NOW })
    expect(r.goal12mYear).toBe(120_000_000) // metric_targets wins over the column
    expect(r.goal3yYear).toBe(600_000_000) // no 3y target → the column
    const none = await loadPointBInputs(seed().sb, 'u1', { now: NOW })
    expect(none.goal12mYear).toBeNull()
    expect(none.goal3yYear).toBeNull()
  })

  it('base period: revenue 2024 with now 2026-10-18 is stale (ageMonths > 15)', async () => {
    const { sb } = seed({ point_a_snapshots: [snapshot()], metrics: [revenueRow()] })
    const r = await loadPointBInputs(sb, 'u1', { now: NOW })
    expect(r.metricOptions.currentRevenueYear).toBe(60_000_000)
    expect(r.base).toEqual({ revenue: 60_000_000, period: '2024', ageMonths: 22, stale: true })
  })

  it('base period falls back to the metric row period when there is no snapshot', async () => {
    const { sb } = seed({ metrics: [revenueRow({ period_year: 2024 })] })
    const r = await loadPointBInputs(sb, 'u1', { now: NOW })
    expect(r.base.period).toBe('2024')
    expect(r.base.stale).toBe(true)
  })

  it('revenue of the current year is not stale', async () => {
    const { sb } = seed({
      point_a_snapshots: [snapshot({ inputs: { metrics: { [REVENUE]: { value: 80_000_000, source: 'document', period: '2026-09' } } } })],
      metrics: [revenueRow({ metric_value: 80_000_000, period_year: 2026 })],
    })
    const r = await loadPointBInputs(sb, 'u1', { now: NOW })
    expect(r.base.stale).toBe(false)
    expect(r.base.period).toBe('2026-09')
    expect(r.base.ageMonths).toBe(1)
  })

  it('last year revenue is not stale yet; a quarter key written as YYYY-N is understood', async () => {
    const a = seed({ point_a_snapshots: [snapshot({ inputs: { metrics: { [REVENUE]: { value: 1, source: 'survey', period: '2025' } } } })], metrics: [revenueRow({ period_year: 2025 })] })
    expect((await loadPointBInputs(a.sb, 'u1', { now: NOW })).base).toMatchObject({ period: '2025', ageMonths: 10, stale: false })
    const q = seed({ point_a_snapshots: [snapshot({ inputs: { metrics: { [REVENUE]: { value: 1, source: 'survey', period: '2025-2' } } } })], metrics: [revenueRow({ period_year: 2025 })] })
    expect((await loadPointBInputs(q.sb, 'u1', { now: NOW })).base).toMatchObject({ period: '2025-Q2', ageMonths: 16, stale: true })
  })

  it('no revenue → base.revenue null, stale false', async () => {
    const r = await loadPointBInputs(seed().sb, 'u1', { now: NOW })
    expect(r.base).toEqual({ revenue: null, period: null, ageMonths: null, stale: false })
  })

  it('revenue known but its period unknown is not claimed to be stale', async () => {
    const { sb } = seed({ metrics: [revenueRow({ period_year: null })] })
    const r = await loadPointBInputs(sb, 'u1', { now: NOW })
    expect(r.base).toEqual({ revenue: 60_000_000, period: null, ageMonths: null, stale: false })
  })

  it('without a registry metric the questionnaire revenue is the base, dated by its key', async () => {
    const { sb } = seed({ survey_answers: [{ user_id: 'u1', question_key: 's2_revenue_2024', answer: { value: 55_000_000 } }] })
    const r = await loadPointBInputs(sb, 'u1', { now: NOW })
    expect(r.answers.s2_revenue_2024).toBe(55_000_000)
    expect(r.base).toEqual({ revenue: 55_000_000, period: '2024', ageMonths: 22, stale: true })
    const cur = seed({ survey_answers: [{ user_id: 'u1', question_key: 's1_current_revenue_year', answer: { value: 70_000_000 } }] })
    const c = await loadPointBInputs(cur.sb, 'u1', { now: NOW })
    expect(c.base).toMatchObject({ revenue: 70_000_000, stale: false })
  })

  it('companyId can be given by the caller (no diagnostic company link)', async () => {
    const { sb } = seed({ diagnostics: [diagnostic({ company_id: null })], metrics: [revenueRow()] })
    const r = await loadPointBInputs(sb, 'u1', { now: NOW, companyId: 'c1' })
    expect(r.companyId).toBe('c1')
    expect(r.metricOptions.currentRevenueYear).toBe(60_000_000)
  })

  it('reads GRI top-5 once from the current assessment', async () => {
    const { sb } = seed({ gri_assessments: [{ user_id: 'u1', is_current: true, top_5_limits: [{ title: 'Нет CRM', block: 'sales' }] }] })
    const r = await loadPointBInputs(sb, 'u1', { now: NOW })
    expect(r.griTop5).toEqual([{ rank: 1, title: 'Нет CRM', block: 'sales', severity: 'high' }])
  })
})

describe('diagToPointA', () => {
  it('keeps a block as null-safe: missing column gives an empty block, never throws', () => {
    const a = diagToPointA({ overall_score: 40, finance_score: null })
    expect(a.blocks.finance).toEqual({ score: 0, status: 'critical', top_issues: [], recommendations: [] })
    expect(a.blocks.sales.top_issues).toEqual([])
    expect(a.stage).toBe('seed')
  })
})
