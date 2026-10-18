/**
 * lib/point-b/finmodel/sources.ts — the finmodel values that already exist elsewhere on the platform
 * (questionnaire step 9, platform metrics), read WITHOUT changing the metric registry, the survey keys
 * or Point A. The merge with what the owner and the expert typed is in store.ts.
 *
 *   debt_total           s9n_debts_amount             a number (₸), 0 is an answer
 *   dso_days             s9n_debtor_days              a number (days)
 *   fixed_costs_month    s9n_expense_rent + s9n_expense_other   free text («5 млн», «300 000 в месяц»), ₸ PER YEAR
 *                        unless the text names another period; (rent + other) / 12, only when BOTH read as a number
 *
 * The metric `biz.finansy.cash_flow_mes` is NOT cash on the account (it is a monthly flow) and is never
 * used for `cash_balance`. The operating expenses and the advertising spend of the platform are facts the
 * model compares against / scales with (`FinmodelFacts`), not finmodel inputs.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { SURVEY_KEY_YEAR } from '@/lib/data-layer/survey-periods'
import { loadCompanyMetrics, metricNumber } from '@/lib/metrics/company-metrics'
import { parseNumber } from '@/lib/metrics/numbers'
import { FINMODEL_DEFS, type FinmodelKey } from './keys'

export const OPEX_METRIC = 'biz.finansy.operatsionnye_raskhody'
export const AD_SPEND_METRIC = 'goal.01.raskhody_na_reklamu'

/** Facts the model uses next to the finmodel (monthly, ₸); null when the platform has no such number. */
export interface FinmodelFacts {
  /** Operating expenses by the platform (marketing + rent + other, step 9) per month. */
  opexMonthly: number | null
  /** Advertising spend per month. */
  adSpendMonthly: number | null
}

export const NO_FACTS: FinmodelFacts = { opexMonthly: null, adSpendMonthly: null }

export interface SurveyFinmodelValue { key: FinmodelKey; value: number; period: string | null }

const MONTHS_IN: Record<string, number> = { month: 12, quarter: 4, year: 1 }

/** An amount written in the answer as a yearly figure → ₸ per year; null when it is not exactly an amount. */
function yearlyAmount(raw: unknown): number | null {
  const p = parseNumber(raw)
  if (!p || p.percent || p.duration !== null || !Number.isFinite(p.value) || p.value < 0) return null
  if (p.period === null) return p.value
  const factor = MONTHS_IN[p.period]
  return factor === undefined ? null : p.value * factor
}

/** Days from an answer («30», «30 дней», «2 недели», «1 месяц»). */
function daysOf(raw: unknown): number | null {
  const p = parseNumber(raw)
  if (!p || p.percent || p.period !== null || !Number.isFinite(p.value) || p.value < 0) return null
  switch (p.duration) {
    case null: case 'day': return p.value
    case 'week': return p.value * 7
    case 'month': return p.value * 30
    default: return null
  }
}

function plainAmount(raw: unknown): number | null {
  const p = parseNumber(raw)
  if (!p || p.percent || p.duration !== null || p.period !== null || !Number.isFinite(p.value) || p.value < 0) return null
  return p.value
}

const inRange = (key: FinmodelKey, v: number): boolean => v >= FINMODEL_DEFS[key].min && v <= FINMODEL_DEFS[key].max

/** Values the questionnaire holds, keyed by finmodel key. Only readable, in-range numbers are returned. */
export function finmodelFromSurvey(answers: Record<string, unknown>): Partial<Record<FinmodelKey, SurveyFinmodelValue>> {
  const out: Partial<Record<FinmodelKey, SurveyFinmodelValue>> = {}

  const debt = plainAmount(answers.s9n_debts_amount)
  if (debt !== null && inRange('debt_total', debt)) out.debt_total = { key: 'debt_total', value: debt, period: null }

  const dso = daysOf(answers.s9n_debtor_days)
  if (dso !== null && inRange('dso_days', dso)) out.dso_days = { key: 'dso_days', value: dso, period: null }

  const rent = yearlyAmount(answers.s9n_expense_rent)
  const other = yearlyAmount(answers.s9n_expense_other)
  if (rent !== null && other !== null) {
    const monthly = (rent + other) / 12
    if (inRange('fixed_costs_month', monthly)) {
      const year = SURVEY_KEY_YEAR.s9n_expense_rent
      out.fixed_costs_month = { key: 'fixed_costs_month', value: monthly, period: year ? String(year) : null }
    }
  }
  return out
}

const isMissingTable = (message: string): boolean => /\((42P01|PGRST205)\)/.test(message)

/** The operating-expense and advertising facts of the platform; a failed read is logged and gives no facts. */
export async function loadFinmodelFacts(sb: SupabaseClient, companyId: string | null): Promise<FinmodelFacts> {
  if (!companyId) return { ...NO_FACTS }
  try {
    const metrics = await loadCompanyMetrics(sb, companyId, [OPEX_METRIC, AD_SPEND_METRIC])
    const monthly = (id: string): number | null => {
      const v = metricNumber(metrics, id)
      return v !== null && Number.isFinite(v) && v > 0 ? v / 12 : null
    }
    return { opexMonthly: monthly(OPEX_METRIC), adSpendMonthly: monthly(AD_SPEND_METRIC) }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (!isMissingTable(message)) console.error('[point-b/finmodel] facts not read — the model runs without them', message)
    return { ...NO_FACTS }
  }
}

/** The questionnaire answers of a user as {question_key: value} (the same unwrapping as lib/point-b/inputs). */
export async function loadSurveyAnswers(sb: SupabaseClient, userId: string): Promise<Record<string, unknown>> {
  const { data, error } = await sb.from('survey_answers').select('question_key, answer').eq('user_id', userId)
  if (error) {
    if (!isMissingTable(`(${error.code ?? ''})`)) console.error('[point-b/finmodel] survey answers not read', error.code ?? 'unknown')
    return {}
  }
  const out: Record<string, unknown> = {}
  for (const row of (data ?? []) as Array<{ question_key: string; answer: unknown }>) {
    const a = row.answer
    out[row.question_key] = a && typeof a === 'object' && 'value' in a ? (a as { value?: unknown }).value : a
  }
  return out
}
