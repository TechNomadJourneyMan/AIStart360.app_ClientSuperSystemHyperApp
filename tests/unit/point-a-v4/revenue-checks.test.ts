import { describe, it, expect } from 'vitest'
import { pointAChecks } from '@/lib/point-a-engine'
import { parsePercentChange } from '@/lib/metrics/source-adapters'
import { resolvedInputsFromMetrics } from '@/lib/point-a/resolved-inputs'
import type { CompanyMetricValue } from '@/lib/metrics/company-metrics'

const fin = (answers: Record<string, unknown>, resolved = {}) => pointAChecks(answers, resolved).finance
const sales = (answers: Record<string, unknown>) => pointAChecks(answers).sales
const byId = <T extends { id: string }>(xs: T[], id: string) => xs.find((x) => x.id === id)!

describe('parsePercentChange keeps the sign of a decline', () => {
  it('words of a decline make the number negative', () => {
    for (const s of ['снизилась на 8%', 'Упала на 8', 'минус 8%', '-8%', '−8 %', 'уменьшилась на 8 процентов', 'сократилась на 8%'])
      expect(parsePercentChange(s), s).toBe(-8)
  })
  it('growth and bare numbers stay positive; «±» says nothing', () => {
    expect(parsePercentChange('+15%')).toBe(15)
    expect(parsePercentChange('выросла на 15%')).toBe(15)
    expect(parsePercentChange('15')).toBe(15)
    expect(parsePercentChange('±15%')).toBeNull()
    expect(parsePercentChange('без изменений')).toBeNull()
    expect(parsePercentChange(-3)).toBe(-3)
  })
})

describe('growth — the latest pair of full years', () => {
  it('a declared decline is a finding, not growth', () => {
    const g = byId(fin({ s9n_revenue_2024: 200_000_000, s9n_change_vs_2023: 'снизилась на 8%' }), 'growth')
    expect(g.earned).toBe(0)
    expect(g.issue).toBe('Выручка не растёт или падает')
  })

  it('2025 vs 2024 wins over 2024 vs 2023', () => {
    const table = [{ metric_name: 'Сумма продаж', y2023: 100, y2024: 200, y2025: 150 }]
    const g = byId(fin({ s8n_metrics_table: table }), 'growth')
    expect(g.earned).toBe(0) // 200 → 150 is a decline although 100 → 200 was growth
  })

  it('the current monthly run-rate is not a year of revenue', () => {
    const g = byId(fin({ s9n_revenue_2024: 200_000_000, s1_current_revenue_month: 30_000_000, s1_current_revenue_year: 360_000_000 }), 'growth')
    expect(g.missing).toBe('Нет данных по выручке за два последних полных года')
  })
})

describe('revenue_trend — the current pace against the latest full year', () => {
  it('a season dip within 10 % is not a decline', () => {
    const t = byId(fin({ s9n_revenue_2024: 200_000_000, s1_current_revenue_year: 186_000_000 }), 'revenue_trend')
    expect(t.earned).toBe(15)
    expect(t.issue).toBeUndefined()
  })
  it('a pace more than 10 % below is a finding that names the year', () => {
    const t = byId(fin({ s9n_revenue_2024: 200_000_000, s1_current_revenue_year: 150_000_000 }), 'revenue_trend')
    expect(t.earned).toBe(0)
    expect(t.issue).toBe('Текущий темп выручки ниже 2024 года на 25%')
  })
  it('no current pace — no verdict', () => {
    const t = byId(fin({ s9n_revenue_2024: 200_000_000 }), 'revenue_trend')
    expect(t.earned).toBe(0)
    expect(t.issue).toBeUndefined()
  })
})

describe('sales read the latest year with data', () => {
  it('deals and refusals of 2025 are read', () => {
    const s = sales({ s3_deals_2025: 80, s3_rejections_2025: 10 })
    expect(byId(s, 'pipeline').earned).toBe(10)
    expect(byId(s, 'refusals').earned).toBe(10)
  })
  it('2025 wins over 2024', () => {
    const s = sales({ s3_deals_2024: 10, s3_deals_2025: 80 })
    expect(byId(s, 'pipeline').earned).toBe(10)
  })
  it('repeat share of 2025 wins over 2024', () => {
    const table = [
      { metric_name: 'Кол-во новых продаж', y2024: 73, y2025: 65 },
      { metric_name: 'Кол-во повторных продаж', y2024: 27, y2025: 35 },
    ]
    expect(byId(sales({ s8n_metrics_table: table }), 'repeat_share').earned).toBe(15)
  })
})

describe('revenue of a document reaches the engine', () => {
  const metric = (periodYear: number | null, periodQuarter: string | null = null): CompanyMetricValue => ({
    metricId: 'biz.finansy.vyruchka_god', label: 'Выручка (год)', value: 240_000_000, unit: '₸', source: 'document',
    confidence: 0.85, computedAt: null, periodYear, periodQuarter, provenance: null,
  })
  it('an annual value of 2024 fills revenue 2024', () => {
    const r = resolvedInputsFromMetrics(new Map([['biz.finansy.vyruchka_god', metric(2024)]]))
    expect(r.revenue).toEqual({ 2024: 240_000_000 })
    expect(byId(fin({ s9n_change_vs_2023: '+25%' }, r), 'growth').earned).toBe(20)
  })
  it('a quarter or the current year is not a full year', () => {
    expect(resolvedInputsFromMetrics(new Map([['biz.finansy.vyruchka_god', metric(2024, 'Q2')]])).revenue).toBeUndefined()
    expect(resolvedInputsFromMetrics(new Map([['biz.finansy.vyruchka_god', metric(2026)]])).revenue).toBeUndefined()
  })
})
