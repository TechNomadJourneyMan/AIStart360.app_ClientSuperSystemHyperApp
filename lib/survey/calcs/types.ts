/**
 * lib/survey/calcs/types.ts — «Расчёты под полями» (spec 2026-10-23 §9).
 *
 * A calculation reads ONLY the owner's own answers (no industry comparison,
 * no benchmarks, no AI, no network, no database) and never writes anything.
 */

export const CALC_IDS = [
  'goal_pace',
  'revenue_years',
  'check_x_sales',
  'margin_check',
  'expense_structure',
  'receivables',
  'funnel',
  'leads_to_goal',
  'refusals_share',
  'revenue_per_employee',
  'owner_hours',
  'marketing_money',
  'staff_count',
  'repeat_rate',
] as const

export type CalcId = (typeof CALC_IDS)[number]

/** Unit of the chart values (for the axis, the tooltip and the text alternative). */
export type CalcUnit = '₸' | '%' | 'шт.' | 'заявок'

export type CalcChart =
  /** One series of bars; `mark` = a target / a different kind of bar (drawn in the accent colour). */
  | { kind: 'bars'; unit: CalcUnit; series: Array<{ label: string; value: number; mark?: boolean }> }
  /** Two values per label, side by side. */
  | { kind: 'pairs'; unit: CalcUnit; names: [string, string]; series: Array<{ label: string; a: number; b: number }> }
  /** Shares of one whole (values in %, summing to ~100) — one stacked strip. */
  | { kind: 'share'; unit: '%'; series: Array<{ label: string; value: number }> }

export interface CalcResult {
  id: CalcId
  /** Short name: «Темп к цели». */
  title: string
  /**
   * The result in words; the first line is the headline. Empty → the
   * calculation is hidden and `missing` says what to fill in.
   */
  lines: string[]
  chart?: CalcChart
  /** At least one input is «примерно» — the numbers carry «≈ … (диапазон …)». */
  approx: boolean
  /** Inputs that are empty or «Не знаю» (human labels). */
  missing: string[]
  /** «выручка в месяц (шаг 1)» — what the result is computed from. */
  sources: string[]
  /** The formula in words («Как посчитано»). */
  how: string
}

export interface CalcContext {
  /** Today (year captions); default `new Date()`. */
  now?: Date
  /** The field the calculation is shown under (a calc with two alternative inputs picks this one). */
  key?: string
}

export type CalcFn = (answers: Readonly<Record<string, unknown>>, ctx?: CalcContext) => CalcResult | null
