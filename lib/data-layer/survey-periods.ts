/**
 * lib/data-layer/survey-periods.ts — which period a survey answer describes.
 *
 * The questionnaire mixes past periods and the current situation:
 *   s9n_revenue_2024        «Годовая выручка 2024»       → 2024
 *   s9n_change_vs_2023      «Изменение выручки vs 2023»   → 2024 (the year compared with 2023)
 *   s8n_metrics_table       columns y2023 … fact_2026     → per column (see tableColumnPeriod)
 *   s9n_net_profit, …       no year                        → the current situation: the year the
 *                                                             answer was given (answered_at)
 */
import type { PeriodRef } from './types'

export interface SurveyPeriod {
  period: PeriodRef
  /** 'key' — the year is in the question key; 'answered' — the answer describes the current situation. */
  basis: 'key' | 'answered'
}

function plausibleYear(y: number, now: Date): boolean {
  return y >= 2000 && y <= now.getUTCFullYear() + 1
}

function answeredDate(answeredAt: string | null | undefined, now: Date): Date {
  const t = answeredAt ? Date.parse(answeredAt) : NaN
  return Number.isFinite(t) ? new Date(t) : now
}

function answeredYear(answeredAt: string | null | undefined, now: Date): number {
  return answeredDate(answeredAt, now).getUTCFullYear()
}

/** Month (1..12) a current-situation answer was given — how fresh it is. */
export function answeredMonth(answeredAt: string | null | undefined, now: Date): number {
  return answeredDate(answeredAt, now).getUTCMonth() + 1
}

/**
 * Keys without a year of their own that the wizard asks for a stated year:
 * step 9 «Финансы» — «Чистая прибыль/убыток 2024» and the expense lines /
 * margin of the same reporting year (lib/metrics/formulas.ts base.revenue_fin
 * pairs them with the 2024 revenue). Keep in sync with
 * components/onboarding/steps/Step9FinanceForm.tsx.
 */
export const SURVEY_KEY_YEAR: Readonly<Record<string, number>> = {
  s9n_net_profit: 2024,
  s9n_net_margin: 2024,
  s9n_expense_cogs: 2024,
  s9n_expense_marketing: 2024,
  s9n_expense_rent: 2024,
  s9n_expense_other: 2024,
}

export function surveyKeyPeriod(key: string, answeredAt: string | null | undefined, now: Date): SurveyPeriod {
  const stated = SURVEY_KEY_YEAR[key]
  if (stated) return { period: { year: stated, quarter: null, month: null }, basis: 'key' }
  const vs = /(?:^|_)vs_(\d{4})(?:_|$)/.exec(key)
  if (vs && plausibleYear(Number(vs[1]), now)) {
    return { period: { year: Number(vs[1]) + 1, quarter: null, month: null }, basis: 'key' }
  }
  const years = [...key.matchAll(/(?:^|_)(\d{4})(?=_|$)/g)].map((m) => Number(m[1])).filter((y) => plausibleYear(y, now))
  if (years.length > 0) {
    return { period: { year: years[years.length - 1], quarter: null, month: null }, basis: 'key' }
  }
  return { period: { year: answeredYear(answeredAt, now), quarter: null, month: null }, basis: 'answered' }
}

/**
 * Period of a column of the step-8 metrics table. `plan_*` columns are targets,
 * not observations → null. `fact_YYYY` is the current, still running year
 * (year-to-date).
 */
export function tableColumnPeriod(column: string): PeriodRef | null {
  let m = /^y(\d{4})$/.exec(column)
  if (m) return { year: Number(m[1]), quarter: null, month: null }
  m = /^fact_(\d{4})$/.exec(column)
  if (m) return { year: Number(m[1]), quarter: null, month: null, ytd: true }
  return null
}
