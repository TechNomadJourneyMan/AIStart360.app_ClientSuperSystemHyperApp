/**
 * lib/goals/evaluate.ts — a goal on any catalog metric, evaluated against the
 * company's current value (spec 2026-10-12 §3). Pure.
 *
 *   gap        target − current (and in %)
 *   pace       growth needed per year (CAGR) for money / counts; change in
 *              points per year for percentages / scores
 *   realism    realistic / ambitious / aggressive / unrealistic
 *   status     achieved / on_track / at_risk / behind / overdue / no_data,
 *              progress since the baseline against the time elapsed
 * Generalises lib/point-b/engine.ts assessRealism (revenue only, CAGR).
 */

export type GoalDirection = 'higher_is_better' | 'lower_is_better' | 'range'
export type GoalRealism = 'realistic' | 'ambitious' | 'aggressive' | 'unrealistic' | 'unknown'
export type GoalStatus = 'achieved' | 'on_track' | 'at_risk' | 'behind' | 'overdue' | 'no_data'

export interface Goal {
  id: string
  metricId: string
  label: string
  unit: string
  targetValue: number
  direction: GoalDirection
  /** '12m' | '3y' | '2026-Q4' | '2026' … */
  periodLabel: string
  /** ISO date; derived from periodLabel when absent. */
  deadline: string | null
  baselineValue: number | null
  baselinePeriod: string | null
  source: 'owner' | 'expert' | 'agent' | 'survey'
  note: string | null
  createdAt: string | null
}

export interface GoalEvaluation {
  goalId: string
  metricId: string
  label: string
  unit: string
  current: number | null
  currentPeriod: string | null
  target: number
  baseline: number | null
  deadline: string
  monthsLeft: number
  gap: number | null
  gapPct: number | null
  /** Money / counts: growth per year needed (%). */
  requiredCagr: number | null
  /** Percentages / scores: change per year needed (points). */
  requiredPointsPerYear: number | null
  /** Per month needed (money / counts: % per month). */
  requiredMonthly: number | null
  realism: GoalRealism
  realismText: string
  status: GoalStatus
  /** 0..100 progress since the baseline. */
  progress: number | null
}

const DAY = 24 * 3600 * 1000

function addMonths(d: Date, m: number): Date {
  const x = new Date(d.getTime())
  x.setUTCMonth(x.getUTCMonth() + m)
  return x
}

/** The deadline of a goal: explicit, else from its period label. */
export function goalDeadline(goal: Pick<Goal, 'deadline' | 'periodLabel' | 'createdAt'>, now: Date): Date {
  if (goal.deadline && Number.isFinite(Date.parse(goal.deadline))) return new Date(goal.deadline)
  const from = goal.createdAt && Number.isFinite(Date.parse(goal.createdAt)) ? new Date(goal.createdAt) : now
  const p = goal.periodLabel.trim()
  let m = /^(\d+)\s*m$/i.exec(p)
  if (m) return addMonths(from, Number(m[1]))
  m = /^(\d+)\s*y$/i.exec(p)
  if (m) return addMonths(from, Number(m[1]) * 12)
  m = /^(\d{4})-Q([1-4])$/i.exec(p)
  if (m) return new Date(Date.UTC(Number(m[1]), Number(m[2]) * 3, 0, 23, 59, 59))
  m = /^(\d{4})$/.exec(p)
  if (m) return new Date(Date.UTC(Number(m[1]), 11, 31, 23, 59, 59))
  return addMonths(from, 12)
}

/** Percent / score-like units are judged in points, not in growth multiples. */
export function isPointsUnit(unit: string, metricId = ''): boolean {
  return unit === '%' || unit === 'из 10' || /nps/i.test(metricId)
}

const LEVEL_TEXT: Record<Exclude<GoalRealism, 'unknown'>, string> = {
  realistic: 'Реалистично', ambitious: 'Амбициозно', aggressive: 'Агрессивно', unrealistic: 'Нереалистично',
}

function round(n: number, d = 1): number {
  const f = 10 ** d
  return Math.round(n * f) / f
}

export function evaluateGoal(goal: Goal, current: { value: number | null; period?: string | null }, now: Date): GoalEvaluation {
  const deadline = goalDeadline(goal, now)
  const monthsLeft = Math.max(0, round((deadline.getTime() - now.getTime()) / (30.44 * DAY), 1))
  const value = current.value !== null && Number.isFinite(current.value) ? current.value : null
  const t = goal.targetValue
  const points = isPointsUnit(goal.unit, goal.metricId)
  const lower = goal.direction === 'lower_is_better'

  const base: GoalEvaluation = {
    goalId: goal.id, metricId: goal.metricId, label: goal.label, unit: goal.unit,
    current: value, currentPeriod: current.period ?? null, target: t, baseline: goal.baselineValue,
    deadline: deadline.toISOString().slice(0, 10), monthsLeft,
    gap: null, gapPct: null, requiredCagr: null, requiredPointsPerYear: null, requiredMonthly: null,
    realism: 'unknown', realismText: 'Нет текущего значения — оценить реалистичность нельзя', status: 'no_data', progress: null,
  }
  if (value === null) return base

  const gap = round(t - value, 2)
  const gapPct = value !== 0 ? round(((t - value) / Math.abs(value)) * 100) : null
  const achieved = goal.direction === 'range' ? Math.abs(value - t) <= Math.abs(t) * 0.05 : lower ? value <= t : value >= t
  const years = Math.max(monthsLeft / 12, 1 / 12)

  let realism: GoalRealism = 'unknown'
  let requiredCagr: number | null = null
  let requiredPointsPerYear: number | null = null
  let requiredMonthly: number | null = null
  let realismText = ''
  if (achieved) {
    realism = 'realistic'
    realismText = 'Цель уже достигнута'
  } else if (points) {
    requiredPointsPerYear = round(Math.abs(t - value) / years)
    requiredMonthly = round(Math.abs(t - value) / Math.max(monthsLeft, 1))
    const p = requiredPointsPerYear
    realism = p <= 5 ? 'realistic' : p <= 15 ? 'ambitious' : p <= 30 ? 'aggressive' : 'unrealistic'
    realismText = `${LEVEL_TEXT[realism]}: нужно ${lower ? 'снижение' : 'рост'} на ~${p} п. п. в год`
  } else if (value > 0 && t > 0) {
    const mult = lower ? value / t : t / value
    requiredCagr = round((Math.pow(mult, 1 / years) - 1) * 100)
    requiredMonthly = round((Math.pow(mult, 1 / Math.max(monthsLeft, 1)) - 1) * 100, 2)
    const c = requiredCagr
    realism = c <= 20 ? 'realistic' : c <= 50 ? 'ambitious' : c <= 100 ? 'aggressive' : 'unrealistic'
    realismText = `${LEVEL_TEXT[realism]}: ${lower ? 'снижение' : 'рост'} ×${round(mult, 1)} за ${Math.round(monthsLeft)} мес (~${c}% в год)`
  } else {
    realismText = 'Текущее значение не позволяет оценить темп'
  }

  // Progress since the baseline against the time elapsed.
  let progress: number | null = null
  let status: GoalStatus
  if (achieved) {
    progress = 100
    status = 'achieved'
  } else if (deadline.getTime() <= now.getTime()) {
    status = 'overdue'
  } else if (goal.baselineValue !== null && goal.baselineValue !== t) {
    const p = (value - goal.baselineValue) / (t - goal.baselineValue)
    progress = round(Math.max(0, Math.min(1, p)) * 100)
    const start = goal.createdAt && Number.isFinite(Date.parse(goal.createdAt)) ? Date.parse(goal.createdAt) : now.getTime()
    const total = deadline.getTime() - start
    const elapsed = total > 0 ? Math.max(0, Math.min(1, (now.getTime() - start) / total)) : 0
    status = p >= elapsed - 0.1 ? 'on_track' : p >= elapsed - 0.3 ? 'at_risk' : 'behind'
  } else {
    // No baseline: judged by the pace it needs.
    status = realism === 'realistic' || realism === 'ambitious' ? 'on_track' : realism === 'aggressive' ? 'at_risk' : 'behind'
  }

  return { ...base, gap, gapPct, requiredCagr, requiredPointsPerYear, requiredMonthly, realism, realismText, status, progress }
}
