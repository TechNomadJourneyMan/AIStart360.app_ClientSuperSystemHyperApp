import { describe, it, expect } from 'vitest'
import { collectFacts } from '@/lib/data-layer/facts'
import { getMetricById } from '@/lib/metrics/registry'
import type { ResolverContext, ResolverDocument } from '@/lib/metrics/types'

const NOW = new Date('2026-10-12T00:00:00Z')
const REVENUE = 'biz.finansy.vyruchka_god'
const ONLY_REVENUE = new Set([REVENUE])

function ctx(over: Partial<ResolverContext> = {}): ResolverContext {
  return { companyId: 'co', userId: 'u', surveyAnswers: {}, documents: [], now: NOW, ...over }
}

function pl(id: string, year: number, revenue: number): ResolverDocument {
  return {
    id, docType: 'pl_report', periodYear: year, periodQuarter: null, uploadedAt: '2026-10-01T00:00:00Z',
    parsedData: { fields: [{ key: 'revenue', label: 'Выручка', value: revenue, confidence: 0.9 }] },
  }
}

describe('collectFacts', () => {
  it('no inputs → no facts', () => {
    expect(collectFacts(ctx())).toEqual([])
  })

  it('keeps every observation with its own period', () => {
    const facts = collectFacts(
      ctx({
        surveyAnswers: { s9n_revenue_2024: 10_000_000, s1_current_revenue_year: 12_000_000 },
        surveyAnsweredAt: { s1_current_revenue_year: '2026-09-01T00:00:00Z' },
        documents: [pl('d24', 2024, 14_000_000), pl('d25', 2025, 13_000_000)],
      }),
      ONLY_REVENUE,
    )
    const view = facts.map((f) => [f.periodKey, f.sourceKind, f.value]).sort()
    expect(view).toEqual([
      ['2024', 'document', 14_000_000],
      ['2024', 'survey', 10_000_000],
      ['2025', 'document', 13_000_000],
      ['2026', 'survey', 12_000_000],
    ])
    const current = facts.find((f) => f.sourceRef === 'survey:s1_current_revenue_year')!
    expect(current.current).toBe(true)
    expect(current.observedAt).toBe('2026-09-01T00:00:00Z')
    expect(facts.find((f) => f.sourceRef === 'survey:s9n_revenue_2024')!.current).toBeUndefined()
  })

  it('expands the step-8 metrics table into one fact per year column (plan is not a fact)', () => {
    const facts = collectFacts(
      ctx({ surveyAnswers: { s8n_metrics_table: [{ metric_name: 'Сумма продаж', y2023: 80, y2024: 100, y2025: 120, plan_2026: 150, fact_2026: 90 }] } }),
      ONLY_REVENUE,
    )
    expect(facts.map((f) => f.periodKey).sort()).toEqual(['2023', '2024', '2025', '2026-YTD'])
    expect(facts.find((f) => f.periodKey === '2024')!.sourceRef).toBe('survey:s8n_metrics_table#sales_amount/y2024')
  })

  it('a monthly answer rescaled to the year is flagged', () => {
    const [f] = collectFacts(ctx({ surveyAnswers: { s1_current_revenue_month: 1_000_000 } }), ONLY_REVENUE)
    expect(f.value).toBe(12_000_000)
    expect(f.flags).toContain('rescaled')
  })

  it('an implausible value is kept as an invalid fact', () => {
    const facts = collectFacts(ctx({ surveyAnswers: { s7_nps_score: 810 } }))
    const margin = facts.filter((f) => f.sourceRef === 'survey:s7_nps_score')
    expect(margin.length).toBeGreaterThan(0)
    expect(margin.every((f) => f.flags.includes('invalid'))).toBe(true)
  })

  it('period overrides are manual facts of their period', () => {
    const [f] = collectFacts(ctx({ periodOverrides: [{ id: 'o1', metricId: REVENUE, periodKey: '2024', value: 11_000_000 }] }), ONLY_REVENUE)
    expect(f).toMatchObject({ sourceKind: 'manual', periodKey: '2024', value: 11_000_000, sourceRef: 'manual:o1' })
  })

  it('an older-form key without a year has no period', () => {
    const facts = collectFacts(ctx({ surveyAnswers: { s2_cac: 99_000 } }), new Set(['biz.marketing.cac']))
    expect(facts.find((f) => f.sourceRef === 'survey:s2_cac')?.periodKey).toBe('unknown')
  })
})

describe('collectFacts — empty number fields', () => {
  it('a 0 of money / a count from the survey is not an answer (no false discrepancy)', () => {
    const facts = collectFacts(ctx({ surveyAnswers: { s2_revenue_2025: 0, s8n_metrics_table: [{ metric_name: 'Сумма продаж', y2025: 120_000_000 }] } }), ONLY_REVENUE)
    expect(facts.map((f) => f.sourceRef)).toEqual(['survey:s8n_metrics_table#sales_amount/y2025'])
  })
  it('…but 0 ad spend / 0 leads is a real answer', () => {
    const entry = getMetricById('goal.01.raskhody_na_reklamu')!
    const facts = collectFacts(ctx({ surveyAnswers: { s9n_expense_marketing: 0 } }), new Set([entry.id]))
    expect(facts.map((f) => f.value)).toEqual([0])
  })
})
