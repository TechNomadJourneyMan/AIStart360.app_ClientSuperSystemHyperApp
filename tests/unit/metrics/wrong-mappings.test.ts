/**
 * Regression tests for every wrong mapping found by the W4 audit. Each case
 * feeds the answer that used to be read as the metric and checks that the
 * metric is no longer that number (and, where a real path exists, that the
 * real value comes out). All of them fail on the registry before W4.
 */
import { describe, expect, it } from 'vitest'
import { resolveMetric } from '@/lib/metrics/resolver'
import { getMetricById } from '@/lib/metrics/registry'
import type { MetricValue, ResolverContext } from '@/lib/metrics/types'

function ctx(surveyAnswers: Record<string, unknown>, extra: Partial<ResolverContext> = {}): ResolverContext {
  return { companyId: 'co', userId: 'u', surveyAnswers, documents: [], now: new Date('2026-10-06T00:00:00Z'), ...extra }
}
function v(id: string, answers: Record<string, unknown>, extra: Partial<ResolverContext> = {}): MetricValue {
  const entry = getMetricById(id)
  if (!entry) throw new Error(`unknown metric ${id}`)
  return resolveMetric(id, ctx(answers, extra), { entry })
}
const unit = (id: string) => getMetricById(id)?.unit

describe('money metrics are not fed by the whole budget / a percentage / one expense line', () => {
  it('CPL and the cost of a qualified lead are not the whole marketing budget', () => {
    for (const id of ['goal.01.stoimost_lida_cpl', 'biz.marketing.cpl_stoimost_lida', 'goal.01.stoimost_tselevogo_lida']) {
      expect(v(id, { s9n_expense_marketing: '3 000 000' }).numeric, id).toBeNull()
    }
    // With leads the formula gives the real cost per lead: 3 000 000 / 12 / 250 = 1 000.
    expect(v('goal.01.stoimost_lida_cpl', { s9n_expense_marketing: '3 000 000', s7_leads_per_month: 250 }).numeric).toBe(1000)
  })

  it('«Расходы на рекламу» is never the budget percentage as tenge', () => {
    expect(v('goal.01.raskhody_na_reklamu', { s5_marketing_budget_pct: 8 }).numeric).toBeNull()
    const r = v('goal.01.raskhody_na_reklamu', { s5_marketing_budget_pct: 8, s1_current_revenue_year: 50_000_000 })
    expect(r.numeric).toBe(4_000_000)
    expect(r.picked?.type).toBe('formula')
  })

  it('operating expenses need all expense lines, not the marketing line alone', () => {
    expect(v('biz.finansy.operatsionnye_raskhody', { s9n_expense_marketing: '2 000 000' }).numeric).toBeNull()
    expect(v('biz.finansy.operatsionnye_raskhody', { s9n_expense_marketing: '2 000 000', s9n_expense_rent: '1 000 000', s9n_expense_other: '500 000' }).numeric).toBe(3_500_000)
  })

  it('revenue per seller and productivity are not the employee count', () => {
    expect(v('biz.prodazhi.vyruchka_s_prodazhnika', { s1_employee_count: 25 }).numeric).toBeNull()
    expect(v('biz.operatsii.proizvoditelnost', { s1_employee_count: 25 }).numeric).toBeNull()
    expect(v('biz.operatsii.proizvoditelnost', { s1_employee_count: 25, s1_current_revenue_year: 50_000_000 }).numeric).toBe(2_000_000)
    const seller = v('biz.prodazhi.vyruchka_s_prodazhnika', {
      s1_current_revenue_year: 60_000_000,
      s4n_staffing_table: [{ department: 'Отдел продаж', manager_count: 4 }, { department: 'Склад', manager_count: 9 }],
    })
    expect(seller.numeric).toBe(15_000_000)
  })

  it('income per client is not the total revenue', () => {
    expect(v('goal.03.dokhod_na_1_klienta', { s9n_revenue_2024: 84_000_000 }).numeric).toBeNull()
  })
})

describe('counts and rates are not each other', () => {
  it('purchase frequency is not the yearly number of deals', () => {
    expect(v('goal.04.frequency', { s3_deals_2024: 380 }).numeric).toBeNull()
    expect(v('goal.04.frequency', { s7_repeat_freq_days: 73 }).numeric).toBe(5)
  })

  it('leads per month are not yearly deals', () => {
    expect(v('biz.marketing.lidov_v_mes', { s3_deals_2025: 420 }).numeric).toBeNull()
    expect(v('biz.marketing.lidov_v_mes', { s7_leads_per_month: 300 }).numeric).toBe(300)
  })

  it('win / loss rate are shares of deals + refusals, not the deal / refusal counts', () => {
    const answers = { s3_deals_2025: 420, s3_rejections_2025: 180 }
    for (const id of ['goal.06.win_rate', 'biz.prodazhi.win_rate', 'goal.11.win_rate']) expect(v(id, answers).numeric, id).toBe(70)
    for (const id of ['goal.06.loss_rate', 'goal.11.loss_rate']) expect(v(id, answers).numeric, id).toBe(30)
    expect(v('goal.06.loss_rate', { s3_rejections_2024: 180 }).numeric).toBeNull()
  })

  it('new / qualified leads are not a funnel conversion percent', () => {
    expect(v('goal.01.kolichestvo_novykh_lidov', { s5n_funnel_lead_to_sale: 12 }).numeric).toBeNull()
    expect(v('goal.01.kolichestvo_tselevykh_lidov', { s5n_funnel_lead_to_call: 55 }).numeric).toBeNull()
    expect(v('goal.01.kolichestvo_tselevykh_lidov', { s5n_funnel_lead_to_call: 55, s7_leads_per_month: 200 }).numeric).toBe(110)
  })

  it('«days» metrics are not funnel percents or the sales cycle', () => {
    for (const [id, answers] of [
      ['goal.08.lid_dialog_dni', { s5n_funnel_lead_to_call: 60 }],
      ['goal.08.dialog_vstrecha_dni', { s5n_funnel_call_to_meeting: 40 }],
      ['goal.08.vstrecha_kp_dni', { s5n_funnel_meeting_to_kp: 70 }],
      ['goal.08.kp_sdelka_dni', { s5n_funnel_kp_to_sale: 30 }],
      ['kpi.vremya_dostavki_kpi', { s5n_funnel_lead_to_sale: 8 }],
      ['biz.operatsii.vremya_dostavki', { s3_deal_cycle_days: 21, s3_deals_2024: 300 }],
    ] as const) {
      expect(v(id, answers).numeric, id).toBeNull()
      expect(unit(id), id).toBe('days')
    }
  })

  it('hiring speed is not the «open vacancies» yes/no toggle', () => {
    expect(v('biz.hr.skorost_nayma', { s4n_open_vacancies: true }).numeric).toBeNull()
  })
})

describe('finance meaning and units', () => {
  it('receivables are not the company\'s own debts', () => {
    expect(v('biz.finansy.debitorskaya_zadolzhennost', { s9n_debts_amount: 15_000_000 }).numeric).toBeNull()
    expect(unit('biz.finansy.debitorskaya_zadolzhennost')).toBe('₸')
    // Estimated from the payment term: 36 500 000 / 365 × 30 = 3 000 000.
    expect(v('biz.finansy.debitorskaya_zadolzhennost', { s1_current_revenue_year: 36_500_000, s9n_debtor_days: 30 }).numeric).toBe(3_000_000)
  })

  it('gross margin is not the net margin', () => {
    expect(v('biz.finansy.valovaya_marzha', { s9n_net_margin: 11 }).numeric).toBeNull()
    expect(v('biz.finansy.valovaya_marzha', { s9n_revenue_2024: 50_000_000, s9n_expense_cogs: '30 млн' }).numeric).toBe(40)
  })

  it('EBITDA / ROA are not the net profit, and ROA is a percent', () => {
    for (const id of ['biz.finansy.ebitda', 'biz.finansy.roa', 'kpi.roa_kpi']) expect(v(id, { s9n_net_profit: 6_000_000 }).numeric, id).toBeNull()
    expect(unit('biz.finansy.ebitda')).toBe('₸')
    expect(unit('biz.finansy.roa')).toBe('%')
    expect(unit('kpi.roa_kpi')).toBe('%')
  })

  it('the COGS index is not the absolute COGS; the COGS KPI is money, not the margin', () => {
    expect(v('biz.finansy.sebestoimost_indeks', { s9n_expense_cogs: '30 млн' }).numeric).toBeNull()
    expect(v('kpi.sebestoimost_kpi', { s2_gross_margin: 40 }).numeric).toBeNull()
    expect(v('kpi.sebestoimost_kpi', { s9n_expense_cogs: '30 млн' })).toMatchObject({ numeric: 30_000_000, unit: '₸' })
  })

  it('monthly cash flow is not the break-even point', () => {
    expect(v('biz.finansy.cash_flow_mes', { s9n_breakeven_point: '2 000 000' }).numeric).toBeNull()
  })

  it('CAC payback is in months', () => {
    expect(unit('goal.09.cac_payback')).toBe('мес')
  })
})

describe('scores, NPS and free-text answers', () => {
  it('GRI blocks are the GRI assessment score, never a sum or count of answers', () => {
    expect(v('gri.stabilnost_kassy', { s9n_breakeven_point: '5 000 000', s9n_planning_frequency: 'monthly' }).numeric).toBeNull()
    expect(v('gri.komanda', { s4_dept_count: 5, s4_has_org_chart: true }).numeric).toBeNull()
    const gri = { griSections: { 'cash-stability': 6.4, team: 7.25 } }
    expect(v('gri.stabilnost_kassy', {}, gri)).toMatchObject({ numeric: 6.4, unit: 'из 10' })
    expect(v('gri.komanda', {}, gri).numeric).toBe(7.25)
  })

  it('NPS is an index −100..100, not a percent', () => {
    for (const id of ['biz.marketing.nps', 'biz.klienty.nps', 'kpi.nps_kpi', 'goal.05.nps']) {
      expect(unit(id), id).toBe('')
      expect(v(id, { s7_nps_score: -20 }).numeric, id).toBe(-20)
      expect(v(id, { s7_nps_score: 140 }).numeric, id).toBeNull()
    }
  })

  it('«8 из 10» is never 810 (churn / NPS from a free-text loyalty answer)', () => {
    expect(v('biz.klienty.churn_rate', { s5n_will_return_nps: '8 из 10' }).numeric).toBeNull()
    expect(v('biz.marketing.nps', { s5n_will_return_nps: '8 из 10' }).numeric).toBeNull()
  })

  it('a non-numeric answer does not block the next source', () => {
    const entry = {
      id: 'test.revenue', namespace: 'biz' as const, label: 'Выручка', unit: '₸',
      sources: [
        { type: 'survey' as const, key: 'a', label: 'текст' },
        { type: 'survey' as const, key: 'b', label: 'число' },
      ],
    }
    const r = resolveMetric('test.revenue', ctx({ a: 'около пяти миллионов', b: '5 000 000' }), { entry })
    expect(r.numeric).toBe(5_000_000)
    expect(r.picked?.key).toBe('b')
    expect(r.considered.find((x) => x.source.key === 'a')?.status).toBe('miss')
  })

  it('a monthly answer feeds a yearly metric ×12, with the conversion recorded', () => {
    const r = v('goal.01.raskhody_na_reklamu', { s9n_expense_marketing: '500 тыс в месяц' })
    expect(r.numeric).toBe(6_000_000)
    const hit = r.considered.find((a) => a.status === 'hit')
    expect(hit?.period).toMatchObject({ source: 'month', target: 'year', factor: 12, basis: 'answer' })
  })
})

describe('current wizard keys replace keys the wizard no longer writes', () => {
  it('Встреча → КП reads s5n_funnel_meeting_to_proposal; КП → сделка is calculated from the current stages', () => {
    expect(v('goal.10.vstrecha_kp', { s5n_funnel_meeting_to_proposal: 65 }).numeric).toBe(65)
    const kp = v('goal.10.kp_sdelka', { s5n_funnel_proposal_to_negotiation: 50, s5n_funnel_negotiation_to_contract: 60, s5n_funnel_contract_to_payment: 90 })
    expect(kp.numeric).toBe(27)
    expect(kp.picked?.type).toBe('formula')
    expect(v('biz.prodazhi.konversiya_kp_sdelka', { s5n_funnel_proposal_to_negotiation: 50, s5n_funnel_negotiation_to_contract: 60, s5n_funnel_contract_to_payment: 90 }).numeric).toBe(27)
  })

  it('an older-form answer is a fallback below a value from the current wizard', () => {
    const r = v('biz.marketing.cac', {
      s2_cac: 99_000,
      s8n_metrics_table: [{ metric_name: 'CAC', y2025: 18_000 }],
    })
    expect(r.numeric).toBe(18_000)
    expect(v('biz.marketing.cac', { s2_cac: 99_000 }).considered.find((a) => a.status === 'hit')?.legacy).toBe(true)
  })

  it('a 0 written by the form for an empty field is «not answered»', () => {
    expect(v('biz.prodazhi.tsikl_zakrytiya_sdelki', { s3_deal_cycle_days: 0 }).numeric).toBeNull()
    expect(v('biz.hr.kol_vo_sotrudnikov', { s1_employee_count: 0 }).numeric).toBeNull()
  })
})
