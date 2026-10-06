import { describe, it, expect } from 'vitest'
import {
  benchmarkForMetric,
  describeMetric,
  enrichMetric,
  periodLabelFor,
  previousValueFor,
  provenanceForSource,
  statusForValue,
  targetForMetric,
  trendFor,
  type MetricHistoryRow,
} from '@/lib/metrics/catalog-helpers'
import { getMetricById, getMetricRegistry } from '@/lib/metrics/registry'
import { BIZ_METRIC_DESCRIPTIONS, GRI_BLOCK_DESCRIPTIONS, KPI_DESCRIPTIONS } from '@/lib/metrics/descriptions'

const entry = (id: string) => {
  const e = getMetricById(id)
  if (!e) throw new Error(`no metric ${id}`)
  return e
}

describe('describeMetric', () => {
  const demoTexts = [
    ...Object.values(BIZ_METRIC_DESCRIPTIONS).flatMap((d) => Object.values(d).map((m) => m.current_state)),
    ...Object.values(KPI_DESCRIPTIONS).map((m) => m.current_state),
    ...Object.values(GRI_BLOCK_DESCRIPTIONS).map((m) => m.current_state),
  ].filter((t): t is string => Boolean(t))

  it('returns the «what» and «how» texts and never a demo current_state', () => {
    expect(demoTexts.length).toBeGreaterThan(50)
    for (const e of getMetricRegistry()) {
      const d = describeMetric(e)
      expect(d.description, e.id).toBeTruthy()
      expect(d.calculationMethod, e.id).toBeTruthy()
      expect(demoTexts).not.toContain(d.description)
      expect(demoTexts).not.toContain(d.calculationMethod)
    }
    expect(describeMetric(entry('biz.finansy.vyruchka_god')).description).toMatch(/^Сколько денег компания получила/)
  })
})

describe('benchmarkForMetric — labelled, unambiguous only', () => {
  it('parses single thresholds of the growth-goal methodology', () => {
    expect(benchmarkForMetric(entry('goal.02.repeat_purchase_rate'))).toEqual({
      value: 40,
      unit: '%',
      label: 'Ориентир методики AIStart360 (экспертная оценка): ≥40%',
      kind: 'expert_estimate',
      direction: 'higher_is_better',
    })
    expect(benchmarkForMetric(entry('goal.02.churn_rate'))).toMatchObject({ value: 5, unit: '%', direction: 'lower_is_better' })
    expect(benchmarkForMetric(entry('goal.09.ltv_cac'))).toMatchObject({ value: 3, unit: '' })
    expect(benchmarkForMetric(entry('goal.10.time_to_response'))).toMatchObject({ value: 15, unit: 'мин', direction: 'lower_is_better' })
  })

  it('returns null for growth rates, ranges, lists, cross-metric rules and non-goal metrics', () => {
    expect(benchmarkForMetric(entry('goal.01.kolichestvo_novykh_klientov'))).toBeNull() // «MoM ≥15%»
    expect(benchmarkForMetric(entry('goal.02.povtornaya_vyruchka'))).toBeNull() // «40–60%»
    expect(benchmarkForMetric(entry('goal.02.retention_30_60_90'))).toBeNull() // «60% / 40% / 25%»
    expect(benchmarkForMetric(entry('goal.01.stoimost_privlecheniya_cac'))).toBeNull() // «LTV/CAC ≥ 3» on CAC
    expect(benchmarkForMetric(entry('goal.09.cac_payback'))).toBeNull() // «≤30–45 дней»
    expect(benchmarkForMetric(entry('biz.finansy.vyruchka_god'))).toBeNull()
  })

  it('every parsed benchmark is labelled as an expert estimate', () => {
    const parsed = getMetricRegistry().map(benchmarkForMetric).filter(Boolean)
    expect(parsed.length).toBeGreaterThanOrEqual(10)
    for (const b of parsed) {
      expect(b!.kind).toBe('expert_estimate')
      expect(b!.label).toMatch(/экспертная оценка/)
    }
  })
})

describe('targets and status', () => {
  it('revenue metrics take the owner 12-month goal; metric_targets rows win', () => {
    expect(targetForMetric('biz.finansy.vyruchka_god', [], 120_000_000)).toEqual({
      value: 120_000_000, periodLabel: '12m', source: 'survey', direction: 'higher_is_better',
    })
    expect(targetForMetric('biz.marketing.cac', [], 120_000_000)).toBeNull()
    const rows = [
      { metric_key: 'biz.finansy.vyruchka_god', target_value: '300000000', direction: 'higher_is_better', period_label: '3y', source: 'owner' },
      { metric_key: 'biz.finansy.vyruchka_god', target_value: '150000000', direction: 'higher_is_better', period_label: '12m', source: 'expert' },
    ]
    expect(targetForMetric('biz.finansy.vyruchka_god', rows, 120_000_000)).toMatchObject({ value: 150_000_000, periodLabel: '12m', source: 'expert' })
  })

  it('grades by direction', () => {
    const higher = { value: 100, periodLabel: '12m', source: 'owner' as const, direction: 'higher_is_better' as const }
    expect(statusForValue(null, higher)).toBe('no_data')
    expect(statusForValue(50, null)).toBe('no_target')
    expect(statusForValue(96, higher)).toBe('on_track')
    expect(statusForValue(85, higher)).toBe('at_risk')
    expect(statusForValue(70, higher)).toBe('off_track')
    const lower = { ...higher, direction: 'lower_is_better' as const }
    expect(statusForValue(90, lower)).toBe('on_track')
    expect(statusForValue(120, lower)).toBe('at_risk') // 100/120 = 0.83
    expect(statusForValue(200, lower)).toBe('off_track')
    const range = { ...higher, direction: 'range' as const }
    expect(statusForValue(103, range)).toBe('on_track')
    expect(statusForValue(115, range)).toBe('at_risk')
    expect(statusForValue(60, range)).toBe('off_track')
  })
})

describe('history → previous value, delta, trend', () => {
  const h = (value: number, source: string, recorded_at: string, period_year: number | null = null): MetricHistoryRow => ({
    metric_key: 'biz.marketing.cac', value, source, period_year, period_quarter: null, period_month: null, recorded_at,
  })
  const current = { metric_key: 'biz.marketing.cac', value: 15_000, source: 'survey', period_year: null, period_quarter: null, period_month: null }

  it('previous distinct value of the same source and period', () => {
    const history = [
      h(15_000, 'survey', '2026-10-05T00:00:00Z'), // the current value itself
      h(18_000, 'document', '2026-10-04T00:00:00Z'), // another source — not a change over time
      h(18_000, 'survey', '2026-09-01T00:00:00Z', 2025), // another period
      h(20_000, 'survey', '2026-08-01T00:00:00Z'),
    ]
    expect(previousValueFor(current, history)).toBe(20_000)
    expect(previousValueFor(current, [h(15_000, 'survey', '2026-10-05T00:00:00Z')])).toBeNull()
  })

  it('delta, deltaPct and trend', () => {
    expect(trendFor(15_000, 20_000)).toEqual({ delta: -5000, deltaPct: -25, trend: 'down' })
    expect(trendFor(101, 100)).toEqual({ delta: 1, deltaPct: 1, trend: 'up' })
    expect(trendFor(100.5, 100)).toMatchObject({ trend: 'flat' })
    expect(trendFor(5, 0)).toEqual({ delta: 5, deltaPct: null, trend: 'up' })
    expect(trendFor(null, 100)).toEqual({ delta: null, deltaPct: null, trend: 'unknown' })
  })
})

describe('period, provenance, full enrichment', () => {
  it('period labels', () => {
    expect(periodLabelFor({ period_year: 2025, period_quarter: null, period_month: null })).toBe('2025')
    expect(periodLabelFor({ period_year: 2026, period_quarter: 'Q3', period_month: null })).toBe('Q3 2026')
    expect(periodLabelFor({ period_year: 2026, period_quarter: null, period_month: 3 })).toBe('03.2026')
    expect(periodLabelFor({ period_year: null, period_quarter: null, period_month: null })).toBeNull()
  })

  it('provenance by source', () => {
    for (const s of ['survey', 'document', 'manual', 'external', 'prisma']) expect(provenanceForSource(s)).toBe('FACT')
    for (const s of ['calculated', 'resolver', 'gri_assessment']) expect(provenanceForSource(s)).toBe('CALCULATED')
    expect(provenanceForSource(null)).toBeNull()
  })

  it('enrichMetric for a flag metric and for a goal metric', () => {
    const ctx = { targets: [], revenueTarget12m: null, history: [] }
    const crm = enrichMetric(entry('biz.avtomatizatsiya.crm_sistema'), null, ctx)
    expect(crm).toMatchObject({
      category: 'automation', categoryLabel: 'Автоматизация', subcategory: null, valueKind: 'flag',
      status: 'no_data', trend: 'unknown', provenanceType: null, period: null, lastUpdated: null,
    })
    const goal = enrichMetric(entry('goal.09.cac'), {
      metric_key: 'goal.09.cac', value: 15_000, source: 'survey', period_year: null, period_quarter: null, period_month: null, computed_at: '2026-10-05T00:00:00Z',
    }, ctx)
    expect(goal).toMatchObject({
      category: 'growth_goals', subcategory: 'goal_09', subcategoryLabel: '9. Снизить стоимость привлечения (CAC)',
      status: 'no_target', provenanceType: 'FACT', lastUpdated: '2026-10-05T00:00:00Z', valueKind: 'number',
    })
  })
})
