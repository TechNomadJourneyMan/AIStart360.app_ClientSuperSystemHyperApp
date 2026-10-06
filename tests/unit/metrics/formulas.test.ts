/**
 * Formula engine (lib/metrics/formulas.ts + resolver): computed metrics over
 * resolved base metrics, in dependency order, with provenance 'calculated'
 * listing every input and its source, and an honest «нужно: …» when an input
 * is missing.
 */
import { describe, expect, it } from 'vitest'
import { resolveAllMetrics, resolveMetric } from '@/lib/metrics/resolver'
import { getMetricById } from '@/lib/metrics/registry'
import { toMaterializedRow } from '@/lib/metrics/materialize'
import type { ResolverContext } from '@/lib/metrics/types'

const ctx = (surveyAnswers: Record<string, unknown>): ResolverContext => ({
  companyId: 'co', userId: 'u', surveyAnswers, documents: [], now: new Date('2026-10-06T00:00:00Z'),
})
const v = (id: string, answers: Record<string, unknown>) => resolveMetric(id, ctx(answers), { entry: getMetricById(id)! })

describe('formula engine', () => {
  it('chains formulas in dependency order: budget % × revenue → ad spend → CAC → LTV/CAC', () => {
    const answers = {
      s1_current_revenue_year: 60_000_000,
      s5_marketing_budget_pct: 10,
      s8n_metrics_table: [{ metric_name: 'Кол-во новых продаж', y2025: 400 }, { metric_name: 'LTV', y2025: 300_000 }],
    }
    const cac = v('biz.marketing.cac', answers)
    expect(cac.numeric).toBe(15_000) // 6 000 000 / 400
    expect(cac.picked).toMatchObject({ type: 'formula', formula: 'cac' })
    const hit = cac.considered.find((a) => a.status === 'hit')!
    expect(hit.inputs).toEqual([
      expect.objectContaining({ metricId: 'goal.01.raskhody_na_reklamu', value: 6_000_000, unit: '₸', source: 'formula', sourceKey: 'ad_spend_from_budget_pct' }),
      expect.objectContaining({ metricId: 'goal.01.kolichestvo_novykh_klientov', value: 400, unit: 'count', source: 'survey', sourceKey: 's8n_metrics_table' }),
    ])
    expect(v('biz.marketing.ltv_cac', answers).numeric).toBe(20)

    const row = toMaterializedRow(cac, 'co')
    expect(row.source).toBe('calculated')
    expect(row.provenance).toMatchObject({ picked: { type: 'formula' }, inputs: expect.any(Array) })
  })

  it('a stated value beats the calculation; the calculation fills the gap', () => {
    const stated = v('biz.marketing.cac', { s8n_metrics_table: [{ metric_name: 'CAC', y2025: 21_000 }], s9n_expense_marketing: '6 000 000' })
    expect(stated).toMatchObject({ numeric: 21_000, picked: { type: 'survey' } })
  })

  it('no formula without its inputs — the metric says what is needed', () => {
    const r = v('biz.marketing.cac', { s9n_expense_marketing: '6 000 000' })
    expect(r.numeric).toBeNull()
    const f = r.considered.find((a) => a.source.type === 'formula')!
    expect(f.status).toBe('miss')
    expect(f.reason).toMatch(/^нужно: /)
    expect(f.reason).toMatch(/Количество новых клиентов/)
    expect(r.needs?.some((n) => n.includes('расчёт — нужно'))).toBe(true)
  })

  it('confidence of a calculated value is the weakest input, slightly discounted', () => {
    const r = v('biz.finansy.operatsionnye_raskhody', { s9n_expense_marketing: '1 000 000', s9n_expense_rent: '1 000 000', s9n_expense_other: '1 000 000' })
    expect(r.numeric).toBe(3_000_000)
    expect(r.confidence).toBeCloseTo(0.86, 2)
  })

  it('year-aligned variants: win rate and average check use one year, the latest complete', () => {
    const answers = { s3_deals_2024: 300, s3_rejections_2024: 100, s3_deals_2025: 400, s9n_revenue_2024: 30_000_000 }
    expect(v('biz.prodazhi.win_rate', answers).numeric).toBe(75) // 2025 has no refusals → 2024
    const check = v('biz.prodazhi.sredniy_chek', answers)
    expect(check.numeric).toBe(100_000) // 2024: 30 000 000 / 300 (2025 has no revenue)
    expect(check.considered.find((a) => a.status === 'hit')?.reason).toMatch(/2024/)
  })

  it('every formula result respects the metric range (a share never above 100%)', () => {
    // 1 200 new clients a year = 100 a month from 50 leads a month → 200 %: refused, not shown.
    const r = v('biz.marketing.konversiya_lid_klient', { s7_leads_per_month: 50, s8n_metrics_table: [{ metric_name: 'Кол-во новых продаж', y2025: 1200 }] })
    expect(r.numeric).toBeNull()
  })

  it('a batch resolution computes each metric once and agrees with single resolution', () => {
    const answers = { s1_current_revenue_year: 48_000_000, s1_employee_count: 12, s5_marketing_budget_pct: 5, s7_leads_per_month: 200 }
    const all = resolveAllMetrics(ctx(answers))
    for (const id of ['biz.operatsii.proizvoditelnost', 'goal.01.raskhody_na_reklamu', 'biz.marketing.cpl_stoimost_lida']) {
      expect(all.find((x) => x.metricId === id)?.numeric, id).toBe(v(id, answers).numeric)
    }
    expect(all.find((x) => x.metricId === 'biz.marketing.cpl_stoimost_lida')?.numeric).toBe(1000) // 2.4 M / 12 / 200
  })
})
