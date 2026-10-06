// Survey answer → number rules (MetricSource.coerce) used by the maturity
// metrics (automation / digital / management) and the step-8 metrics table.

import { describe, it, expect } from 'vitest'
import { resolveSurveySource } from '@/lib/metrics/source-adapters'
import { resolveMetric } from '@/lib/metrics/resolver'
import { getMetricById } from '@/lib/metrics/registry'
import { readMetricsTable, metricsTableCell } from '@/lib/survey/metrics-table'
import type { MetricSource } from '@/lib/metrics/descriptions'
import type { ResolverContext } from '@/lib/metrics/types'

function ctx(surveyAnswers: Record<string, unknown>): ResolverContext {
  return { companyId: 'co', userId: 'u', surveyAnswers, documents: [], now: new Date('2026-10-06T00:00:00Z') }
}

const TABLE = [
  { metric_name: 'Сумма продаж', y2023: 80_000_000, y2024: 100_000_000, y2025: 120_000_000, plan_2026: 150_000_000, fact_2026: 90_000_000, completion_pct: 0 },
  { metric_name: 'Средний чек', y2023: 0, y2024: 45_000, y2025: 50_000, plan_2026: 0, fact_2026: 0, completion_pct: 0 },
  { metric_name: 'CAC', y2023: 0, y2024: 0, y2025: 18_000, plan_2026: 0, fact_2026: 15_000, completion_pct: 0 },
  { metric_name: 'LTV', y2023: 0, y2024: 0, y2025: 90_000, plan_2026: 0, fact_2026: 0, completion_pct: 0 },
  { metric_name: 'LTV:CAC', y2023: 0, y2024: 0, y2025: 0, plan_2026: 0, fact_2026: 0, completion_pct: 0 },
  { metric_name: 'Кол-во новых продаж', y2023: 0, y2024: 700, y2025: 800, plan_2026: 0, fact_2026: 500, completion_pct: 0 },
]

describe('step-8 metrics table reader', () => {
  it('matches rows by name and reads the newest filled cell', () => {
    const t = readMetricsTable(TABLE)
    expect(metricsTableCell(t, 'cac', 'latest')).toEqual({ value: 15_000, column: 'fact_2026' })
    expect(metricsTableCell(t, 'sales_amount', 'latest_full_year')).toEqual({ value: 120_000_000, column: 'y2025' })
    expect(metricsTableCell(t, 'avg_check', 'y2024')).toEqual({ value: 45_000, column: 'y2024' })
    // All-zero row = not filled (the form writes 0 for empty cells).
    expect(metricsTableCell(t, 'ltv_cac')).toBeNull()
    expect(metricsTableCell(t, 'cpl')).toBeNull()
  })

  it('accepts the {value} envelope and renamed rows', () => {
    const t = readMetricsTable({ value: [{ metric_name: '  выручка ', y2025: '1 200,5' }] })
    expect(metricsTableCell(t, 'sales_amount')).toEqual({ value: 1200.5, column: 'y2025' })
    expect(readMetricsTable('not a table')).toEqual({})
  })
})

describe('survey coercion rules', () => {
  const flag: MetricSource = { type: 'survey', key: 'k', coerce: { kind: 'flag', falseValues: ['excel'] } }

  it('flag: yes/no answers and «none» choices become 1/0', () => {
    expect(resolveSurveySource(flag, ctx({ k: true })).numeric).toBe(1)
    expect(resolveSurveySource(flag, ctx({ k: false })).numeric).toBe(0)
    expect(resolveSurveySource(flag, ctx({ k: 'bitrix24' })).numeric).toBe(1)
    expect(resolveSurveySource(flag, ctx({ k: 'none' })).numeric).toBe(0)
    expect(resolveSurveySource(flag, ctx({ k: 'Нет' })).numeric).toBe(0)
    expect(resolveSurveySource(flag, ctx({ k: 'excel' })).numeric).toBe(0)
    // Not answered is a miss, never a fabricated 0.
    expect(resolveSurveySource(flag, ctx({})).status).toBe('miss')
    expect(resolveSurveySource(flag, ctx({ k: '' })).status).toBe('miss')
  })

  it('choice: only mapped options produce a number', () => {
    const src: MetricSource = { type: 'survey', key: 'f', coerce: { kind: 'choice', map: { monthly: 12, quarterly: 4, never: 0 } } }
    expect(resolveSurveySource(src, ctx({ f: 'monthly' }))).toMatchObject({ status: 'hit', numeric: 12, value: 'monthly' })
    expect(resolveSurveySource(src, ctx({ f: 'never' })).numeric).toBe(0)
    expect(resolveSurveySource(src, ctx({ f: 'sometimes' })).status).toBe('miss')
  })

  it('count_selected: multi-select length without excluded options', () => {
    const src: MetricSource = { type: 'survey', key: 'ch', coerce: { kind: 'count_selected', exclude: ['Офлайн-реклама'] } }
    expect(resolveSurveySource(src, ctx({ ch: ['SEO', 'SMM (соцсети)', 'Офлайн-реклама'] })).numeric).toBe(2)
    expect(resolveSurveySource(src, ctx({ ch: 'SEO, Email' })).numeric).toBe(2)
    expect(resolveSurveySource(src, ctx({ ch: [] })).status).toBe('miss')
  })

  it('composite keys: counts answered keys holding a real tool', () => {
    const src: MetricSource = {
      type: 'survey', keys: ['a', 'b', 'c', 'd'], coerce: { kind: 'count_selected', exclude: ['excel'] },
    }
    const r = resolveSurveySource(src, ctx({ a: 'amocrm', b: 'none', c: 'excel' }))
    expect(r).toMatchObject({ status: 'hit', numeric: 1 })
    expect(resolveSurveySource(src, ctx({})).status).toBe('miss')
    // A composite source without count_selected is a wiring error, not a guess.
    expect(resolveSurveySource({ type: 'survey', keys: ['a'] }, ctx({ a: 'x' })).status).toBe('error')
  })

  it('table_cell: reads one cell of s8n_metrics_table', () => {
    const src: MetricSource = { type: 'survey', key: 's8n_metrics_table', coerce: { kind: 'table_cell', row: 'cac' } }
    const r = resolveSurveySource(src, ctx({ s8n_metrics_table: TABLE }))
    expect(r).toMatchObject({ status: 'hit', numeric: 15_000, value: 15_000 })
    expect(r.reason).toContain('факт 2026')
    const empty = resolveSurveySource({ ...src, coerce: { kind: 'table_cell', row: 'cpl' } }, ctx({ s8n_metrics_table: TABLE }))
    expect(empty.status).toBe('miss')
  })

  it('without coerce the original numeric coercion is unchanged', () => {
    const r = resolveSurveySource({ type: 'survey', key: 'rev' }, ctx({ rev: '84 200 000 ₸' }))
    expect(r).toMatchObject({ status: 'hit', numeric: 84_200_000, value: '84 200 000 ₸' })
  })
})

describe('registry metrics resolve from the current wizard', () => {
  const answers = {
    s12_crm_tool: 'bitrix24', s12_erp: 'none', s12_edm: '1c_doc', s12_bi_tool: 'excel',
    s12_telephony: 'mango', s12_project_mgmt: 'none', s12_marketing_platforms: 'google_ads',
    s12_it_support: true,
    s4m_report_automated: 'excel', s4m_control_method: 'kpi', s4_has_org_chart: true,
    s4m_hours_on_ops: 6, s4m_delegation_readiness: 7, s9n_planning_frequency: 'quarterly',
    s5_marketing_channels: ['SEO', 'SMM (соцсети)', 'PR / СМИ'],
    s1_website: 'https://example.kz', s1_social_media: 'нет',
    s7_no_show_rate: 12, s7_nps_score: 41,
    s8n_metrics_table: TABLE,
  }
  const v = (id: string) => resolveMetric(id, ctx(answers), { entry: getMetricById(id)! })

  it('automation', () => {
    expect(v('biz.avtomatizatsiya.biznes_sistemy_v_rabote').numeric).toBe(4) // crm, edm, telephony, marketing
    expect(v('biz.avtomatizatsiya.crm_sistema').numeric).toBe(1)
    expect(v('biz.avtomatizatsiya.avtomatizirovannaya_otchetnost').numeric).toBe(0)
    expect(v('biz.avtomatizatsiya.it_podderzhka').numeric).toBe(1)
  })

  it('digital', () => {
    expect(v('biz.tsifrovizatsiya.tsifrovye_kanaly_marketinga').numeric).toBe(2)
    expect(v('biz.tsifrovizatsiya.tsifrovoe_prisutstvie').numeric).toBe(1)
    expect(v('biz.tsifrovizatsiya.bi_analitika').numeric).toBe(0)
  })

  it('management', () => {
    expect(v('biz.upravlenie.upravlenie_po_kpi').numeric).toBe(1)
    expect(v('biz.upravlenie.chasy_sobstvennika_v_operatsionke').numeric).toBe(6)
    expect(v('biz.upravlenie.finansovoe_planirovanie').numeric).toBe(4)
    expect(v('biz.upravlenie.analiz_rezultatov').picked).toBeNull()
  })

  it('KPIs from step 7 / step 8', () => {
    expect(v('biz.marketing.cac').numeric).toBe(15_000)
    expect(v('biz.prodazhi.sredniy_chek').numeric).toBe(50_000)
    expect(v('goal.04.ltv').numeric).toBe(90_000)
    expect(v('goal.02.ltv_lifetime_value')).toMatchObject({ numeric: 90_000, unit: '₸' })
    expect(v('goal.01.kolichestvo_novykh_klientov').numeric).toBe(800)
    expect(v('biz.prodazhi.dolya_neyavok_no_show').numeric).toBe(12)
    expect(v('biz.marketing.nps').numeric).toBe(41)
  })

  it('CAC is never the whole marketing budget', () => {
    const r = resolveMetric('biz.marketing.cac', ctx({ s9n_expense_marketing: '3 000 000' }), { entry: getMetricById('biz.marketing.cac')! })
    expect(r.picked).toBeNull()
  })
})
