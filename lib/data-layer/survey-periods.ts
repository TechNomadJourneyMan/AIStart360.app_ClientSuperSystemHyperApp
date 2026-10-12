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

function answeredYear(answeredAt: string | null | undefined, now: Date): number {
  const t = answeredAt ? Date.parse(answeredAt) : NaN
  return Number.isFinite(t) ? new Date(t).getUTCFullYear() : now.getUTCFullYear()
}

export function surveyKeyPeriod(key: string, answeredAt: string | null | undefined, now: Date): SurveyPeriod {
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
