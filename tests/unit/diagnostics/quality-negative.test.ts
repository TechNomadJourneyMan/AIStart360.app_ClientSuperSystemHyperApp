/**
 * Data quality: a negative value is «impossible» only for metrics that cannot
 * be negative (revenue, costs, CAC, average check, counts). A loss-making
 * month's cash flow is a real fact and must not be reported to the client as
 * a high-severity «невозможное значение».
 */
import { describe, expect, it } from 'vitest'
import { cannotBeNegative, impossibleValueFindings, type QualityMetricRow } from '@/lib/diagnostics/quality'

const row = (metric_key: string, metric_value: number, metric_unit: string | null = null): QualityMetricRow => ({
  metric_key, metric_value, metric_unit, source: 'document', period_year: 2026, period_quarter: null, period_month: 3, scenario: null, computed_at: null,
})

describe('impossibleValueFindings', () => {
  it('negative cash flow is not an anomaly', () => {
    expect(impossibleValueFindings([row('biz.finansy.cash_flow_mes', -2_000_000)])).toEqual([])
    expect(impossibleValueFindings([row('biz.finansy.cash_flow_mes', -2_000_000, '₸')])).toEqual([])
  })

  it('negative revenue, CAC and a negative count still are', () => {
    const out = impossibleValueFindings([
      row('biz.finansy.vyruchka_god', -5),
      row('biz.marketing.cac', -500),
      row('biz.hr.kol_vo_sotrudnikov', -3),
    ])
    expect(out.map((f) => f.evidence[0].ref)).toEqual(['biz.finansy.vyruchka_god', 'biz.marketing.cac', 'biz.hr.kol_vo_sotrudnikov'])
    expect(out.every((f) => f.kind === 'anomaly' && f.severity === 'high')).toBe(true)
  })

  it('profit-like labels may be negative; unknown money metrics may not', () => {
    expect(cannotBeNegative('biz.finansy.cash_flow_mes', '₸')).toBe(false)
    expect(cannotBeNegative('Чистая прибыль', '₸')).toBe(false)
    expect(cannotBeNegative('biz.finansy.operatsionnye_raskhody', '₸')).toBe(true)
    expect(cannotBeNegative('biz.finansy.cash_flow_mes', '%')).toBe(false)
  })
})
