/**
 * lib/survey/calcs/inputs.ts — reading the owner's numbers for the field
 * calculations, carrying «примерно» ranges through the arithmetic.
 *
 *   exact answer           → { v, lo: v, hi: v, approx: false }
 *   «примерно» envelope    → { v: midpoint, lo, hi, approx: true }
 *   «Не знаю» envelope     → 'unknown'   (never 0)
 *   empty / unreadable     → null
 *
 * `combine` evaluates a formula at the midpoint and at every corner of the
 * input ranges (the formulas are monotone in each input), so the result range
 * is honest without interval algebra. Pure, browser-safe.
 */
import { isApproxAnswer, isUnknownAnswer, parseApproxRange, unwrapAnswer } from '@/lib/survey/answer-value'
import { parseNumber } from '@/lib/metrics/numbers'
import { SURVEY_KEY_STEP } from '@/lib/survey/steps'
import { yearOfKey } from '@/lib/survey/year-labels'
import type { CalcId, CalcResult } from './types'

export interface Num {
  v: number
  lo: number
  hi: number
  approx: boolean
}

export type Read = Num | 'unknown' | null

export type Answers = Readonly<Record<string, unknown>>

const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n)

export const exact = (v: number): Num => ({ v, lo: v, hi: v, approx: false })

export const isNum = (r: Read | undefined): r is Num => typeof r === 'object' && r !== null

/** A raw answer is present (any value, including «Не знаю»). */
export function isAnswered(raw: unknown): boolean {
  if (raw === null || raw === undefined) return false
  if (isUnknownAnswer(raw)) return true
  const u = unwrapAnswer(raw)
  if (u === null || u === undefined) return false
  if (typeof u === 'string') return u.trim() !== ''
  if (Array.isArray(u)) return u.length > 0
  return true
}

/** Some of the keys are answered (a calc with no input at all is not shown). */
export const hasAnyInput = (answers: Answers, keys: readonly string[]): boolean => keys.some((k) => isAnswered(answers[k]))

type TextKind = 'amount' | 'percent' | 'days' | 'yearly'

/** A free-text legacy answer («около 60 %», «150 000 в месяц», «30 дней», «5–6 млн»). */
function fromText(s: string, kind: TextKind): Read {
  const p = parseNumber(s)
  if (p) {
    if (kind === 'percent') return p.duration === null && p.period === null ? exact(p.value) : null
    if (p.percent) return null
    if (kind === 'days') {
      if (p.period !== null) return null
      const per = p.duration === null || p.duration === 'day' ? 1 : p.duration === 'week' ? 7 : p.duration === 'month' ? 30 : null
      return per === null ? null : exact(p.value * per)
    }
    if (p.duration !== null) return null
    if (kind === 'yearly' && p.period !== null) {
      const f = p.period === 'month' ? 12 : p.period === 'quarter' ? 4 : p.period === 'year' ? 1 : null
      return f === null ? null : exact(p.value * f)
    }
    return p.period === null ? exact(p.value) : null
  }
  if (kind === 'amount' || kind === 'yearly') {
    const r = parseApproxRange(s)
    if (r) return { v: r.mid, lo: r.min, hi: r.max, approx: r.min !== r.max }
  }
  return null
}

function readAs(raw: unknown, kind: TextKind): Read {
  if (raw === null || raw === undefined) return null
  if (isUnknownAnswer(raw)) return 'unknown'
  if (isApproxAnswer(raw)) {
    const [lo, hi] = raw.range
    return { v: raw.value, lo, hi, approx: lo !== hi }
  }
  const u = unwrapAnswer(raw)
  if (finite(u)) return exact(u)
  if (typeof u === 'string' && u.trim()) return fromText(u.trim(), kind)
  return null
}

/** An amount or a count (₸, people, leads). */
export const readAmount = (answers: Answers, key: string): Read => readAs(answers[key], 'amount')
/** A percent stored as 0..100 («3» or «3 %»). */
export const readPercent = (answers: Answers, key: string): Read => readAs(answers[key], 'percent')
/** Days («30», «30 дней», «2 недели»). */
export const readDays = (answers: Answers, key: string): Read => readAs(answers[key], 'days')
/** An amount per year; a legacy «150 000 в месяц» is ×12. A percent → null (see readShareOrYearly). */
export const readYearly = (answers: Answers, key: string): Read => readAs(answers[key], 'yearly')

/** A legacy expense written as a share of revenue («около 60 %»), else null. */
export function readShareText(answers: Answers, key: string): number | null {
  const u = unwrapAnswer(answers[key])
  if (typeof u !== 'string') return null
  const p = parseNumber(u)
  return p && p.percent && p.period === null && p.duration === null ? p.value : null
}

/**
 * Evaluate `f` at the midpoint and at every corner of the approx inputs.
 * null when the midpoint has no value (division by zero, a guard).
 */
export function combine(inputs: readonly Num[], f: (xs: number[]) => number | null): Num | null {
  const mid = f(inputs.map((n) => n.v))
  if (mid === null || !finite(mid)) return null
  const ranged = inputs.map((n, i) => (n.approx ? i : -1)).filter((i) => i >= 0)
  if (ranged.length === 0) return exact(mid)
  let lo = mid
  let hi = mid
  const corners = 1 << Math.min(ranged.length, 8)
  for (let mask = 0; mask < corners; mask++) {
    const xs = inputs.map((n) => n.v)
    ranged.forEach((idx, bit) => { xs[idx] = mask & (1 << bit) ? inputs[idx].hi : inputs[idx].lo })
    const r = f(xs)
    if (r === null || !finite(r)) continue
    if (r < lo) lo = r
    if (r > hi) hi = r
  }
  return { v: mid, lo, hi, approx: true }
}

/**
 * A number for a line: exact → `${prefix}${fmt(v)}`; approx →
 * «≈ fmt(v) (диапазон fmt(lo) – fmt(hi))» (no range when both ends read the same).
 */
export function show(n: Num, fmt: (x: number) => string, prefix = ''): string {
  if (!n.approx) return `${prefix}${fmt(n.v)}`
  const a = fmt(n.lo)
  const b = fmt(n.hi)
  return a === b ? `≈ ${fmt(n.v)}` : `≈ ${fmt(n.v)} (диапазон ${a} – ${b})`
}

// ─── Labels of the inputs («из: …», «укажите: …») ───────────────────────────

const LABEL: Readonly<Record<string, string>> = {
  s1_current_revenue_month: 'выручка в месяц',
  s1_current_revenue_year: 'выручка в год',
  s1_goal_12m_revenue_month: 'цель через год (выручка в месяц)',
  s1_goal_3y_revenue_month: 'цель через 3 года (выручка в месяц)',
  s1_employee_count: 'количество сотрудников',
  s3_deals_2023: 'сделки 2023', s3_deals_2024: 'сделки 2024', s3_deals_2025: 'сделки 2025',
  s3_rejections_2023: 'отказы 2023', s3_rejections_2024: 'отказы 2024', s3_rejections_2025: 'отказы 2025',
  s4m_hours_on_ops: 'часов в день на операционку',
  s4n_staffing_table: 'штатное расписание',
  s5_marketing_budget_pct: 'бюджет на маркетинг, % от выручки',
  s5n_funnel_lead_to_sale: 'конверсия «лид → продажа»',
  s7_leads_per_month: 'лидов в месяц',
  s7_avg_check_target_kzt: 'целевой средний чек',
  s7_repeat_freq_days: 'частота повторной покупки',
  s8n_metrics_table: 'таблица ключевых метрик',
  s9n_net_profit: 'чистая прибыль',
  s9n_net_margin: 'чистая маржа',
  s9n_expense_cogs: 'себестоимость',
  s9n_expense_marketing: 'расходы на маркетинг',
  s9n_expense_rent: 'аренда',
  s9n_expense_other: 'прочие расходы',
  s9n_debtor_days: 'срок оплаты (дебиторка)',
  s10_hours_on_ops: 'часов в день на операционку',
}

/** «годовая выручка (2024)»: the year comes from the key (lib/survey/year-labels). */
export function inputLabel(key: string): string {
  if (key === 's9n_revenue_2024') return `годовая выручка (${yearOfKey(key) ?? 2024})`
  return LABEL[key] ?? key
}

/** «выручка в месяц (шаг 1)». */
export function sourceOf(key: string): string {
  const step = SURVEY_KEY_STEP[key]
  return step ? `${inputLabel(key)} (шаг ${step})` : inputLabel(key)
}

/** «средний чек (таблица метрик, шаг 8)». */
export const tableSource = (row: string): string => `${row} (таблица метрик, шаг 8)`

export function uniq<T>(xs: readonly T[]): T[] {
  return Array.from(new Set(xs))
}

/** A hidden calculation: nothing to show yet, `missing` says what to fill in. */
export function needs(id: CalcId, title: string, missing: readonly string[], sources: readonly string[], how: string): CalcResult {
  return { id, title, lines: [], approx: false, missing: uniq(missing), sources: uniq(sources), how }
}

// ─── Revenue the calculations share ─────────────────────────────────────────

export interface Picked {
  num: Num | null
  /** Key the number came from; with `num: null` — the key to ask for. */
  key: string
  unknown: boolean
}

const pick = (key: string, r: Read): Picked => ({ num: isNum(r) ? r : null, key, unknown: r === 'unknown' })

/** Current revenue per month: s1 month, else s1 year ÷ 12. */
export function currentMonth(answers: Answers): Picked {
  const m = readAmount(answers, 's1_current_revenue_month')
  if (isNum(m) && m.v > 0) return pick('s1_current_revenue_month', m)
  const y = readAmount(answers, 's1_current_revenue_year')
  if (isNum(y) && y.v > 0 && m !== 'unknown') {
    const per = combine([y], ([x]) => x / 12)
    return { num: per, key: 's1_current_revenue_month', unknown: false }
  }
  return pick('s1_current_revenue_month', m === 'unknown' ? 'unknown' : null)
}

/** A goal per month: the month answer, else the year ÷ 12. */
export function goalMonth(answers: Answers, horizon: '12m' | '3y'): Picked {
  const mk = `s1_goal_${horizon}_revenue_month`
  const yk = `s1_goal_${horizon}_revenue_year`
  const m = readAmount(answers, mk)
  if (isNum(m) && m.v > 0) return pick(mk, m)
  const y = readAmount(answers, yk)
  if (isNum(y) && y.v > 0) return { num: combine([y], ([x]) => x / 12), key: mk, unknown: false }
  return pick(mk, m === 'unknown' ? 'unknown' : null)
}

/**
 * Revenue per year: the current month × 12 (today's pace), else the step-9
 * yearly revenue. The step-9 expenses and profit pair with `s9n_revenue_2024`
 * instead (same reporting year, lib/data-layer/survey-periods SURVEY_KEY_YEAR).
 */
export function yearRevenue(answers: Answers): Picked & { word: string } {
  const m = currentMonth(answers)
  if (m.num) return { num: combine([m.num], ([x]) => x * 12), key: m.key, unknown: false, word: 'выручка в месяц × 12' }
  const r = readAmount(answers, 's9n_revenue_2024')
  if (isNum(r) && r.v > 0) return { ...pick('s9n_revenue_2024', r), word: inputLabel('s9n_revenue_2024') }
  return { num: null, key: 's1_current_revenue_month', unknown: m.unknown, word: '' }
}
