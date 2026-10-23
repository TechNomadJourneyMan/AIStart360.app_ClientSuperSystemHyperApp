/**
 * lib/survey/calcs — «Расчёты под полями» (spec 2026-10-23 §9).
 *
 * One entry point for every surface: the 12 step forms, express screens and
 * blocks (Ф2), «Мои ответы» (Ф1), the chat card (Ф4):
 *
 *   calcsForKey('s7_leads_per_month', answers)  → the results to show under that field
 *   computeCalcs(['goal_pace'], answers)         → by id
 *
 * Deterministic and pure: only the owner's own answers, no industry
 * comparison, no AI, no network, no database, nothing is written.
 */
import { checkXSales, funnel, FUNNEL_KEYS, refusalsShare, repeatRate } from './sales'
import { goalPace, leadsToGoal, revenuePerEmployee, revenueYears } from './goals'
import { expenseStructure, marginCheck, marketingMoney, receivables } from './finance'
import { ownerHours, staffCount } from './team'
import { CALC_IDS, type CalcContext, type CalcFn, type CalcId, type CalcResult } from './types'

export { CALC_IDS }
export type { CalcChart, CalcContext, CalcId, CalcResult, CalcUnit } from './types'
export { chartRows, formatChartValue } from './chart'

export const CALCS: Readonly<Record<CalcId, CalcFn>> = {
  goal_pace: goalPace,
  revenue_years: revenueYears,
  check_x_sales: checkXSales,
  margin_check: marginCheck,
  expense_structure: expenseStructure,
  receivables,
  funnel,
  leads_to_goal: leadsToGoal,
  refusals_share: refusalsShare,
  revenue_per_employee: revenuePerEmployee,
  owner_hours: ownerHours,
  marketing_money: marketingMoney,
  staff_count: staffCount,
  repeat_rate: repeatRate,
}

const STEP9_EXPENSES = ['s9n_expense_cogs', 's9n_expense_marketing', 's9n_expense_rent', 's9n_expense_other']
const REFUSAL_KEYS = [2023, 2024, 2025].flatMap((y) => [`s3_deals_${y}`, `s3_rejections_${y}`])

/** Question key → the calculations shown under it (order = display order). */
export const CALCS_BY_KEY: Readonly<Record<string, readonly CalcId[]>> = (() => {
  const m: Record<string, CalcId[]> = {}
  const add = (keys: readonly string[], ids: readonly CalcId[]) => {
    for (const k of keys) m[k] = [...(m[k] ?? []), ...ids.filter((id) => !(m[k] ?? []).includes(id))]
  }
  add(['s1_current_revenue_month', 's1_goal_12m_revenue_month', 's1_goal_3y_revenue_month'], ['goal_pace'])
  add(['s1_employee_count'], ['revenue_per_employee'])
  add(['s8n_metrics_table'], ['revenue_years', 'check_x_sales'])
  add(['s9n_revenue_2024'], ['revenue_years'])
  add(['s9n_net_profit', 's9n_net_margin'], ['margin_check'])
  add(STEP9_EXPENSES, ['expense_structure'])
  add(['s9n_expense_marketing', 's5_marketing_budget_pct'], ['marketing_money'])
  add(['s9n_debtor_days'], ['receivables'])
  add(FUNNEL_KEYS.filter((k) => k !== 's7_leads_per_month'), ['funnel'])
  add(['s7_leads_per_month'], ['funnel', 'leads_to_goal'])
  add(REFUSAL_KEYS, ['refusals_share'])
  add(['s4m_hours_on_ops', 's10_hours_on_ops'], ['owner_hours'])
  add(['s4n_staffing_table'], ['staff_count'])
  add(['s7_repeat_freq_days'], ['repeat_rate'])
  return m
})()

/** The calculations of these ids that have something to say (null ones dropped). */
export function computeCalcs(ids: readonly CalcId[], answers: Readonly<Record<string, unknown>>, ctx: CalcContext = {}): CalcResult[] {
  const out: CalcResult[] = []
  for (const id of ids) {
    const r = CALCS[id](answers, ctx)
    if (r) out.push(r)
  }
  return out
}

/** The calculations to show under the field `key` (empty when the field has none). */
export function calcsForKey(key: string, answers: Readonly<Record<string, unknown>>, ctx: CalcContext = {}): CalcResult[] {
  const ids = CALCS_BY_KEY[key]
  return ids ? computeCalcs(ids, answers, { ...ctx, key }) : []
}

/** A calculation is ready to show (otherwise only «укажите …»). */
export const isCalcReady = (r: CalcResult): boolean => r.lines.length > 0
