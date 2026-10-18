/**
 * lib/point-b/horizons.ts — goal horizons (spec §2: month, quarter, year, 3 years — the period is
 * set by the owner, the expert or the admin).
 *
 *   horizonMonths            a goal (deadline or period label) → whole months from `now`
 *   pickPrimaryRevenueGoal   the revenue goal the model solves for
 *   HORIZON_PRESETS          the presets of the goal wizard
 *   isValidPeriodLabel       `Nm`, `Ny`, `YYYY`, `YYYY-Qn`; at most 60 months (the model horizon)
 *
 * Dates come from lib/goals/evaluate.ts `goalDeadline` (a date deadline is the END of that day,
 * a label counts from the start of the goal's horizon, else from `now`). Pure: no clock.
 */
import { goalDeadline } from '@/lib/goals/evaluate'
import { REVENUE_GOAL_METRIC } from '@/lib/goals/store'
import type { PlanGoalItem } from './plan/types'

/** The model does not look further than this (spec §9.4). */
export const MAX_HORIZON_MONTHS = 60

export const HORIZON_PRESETS: ReadonlyArray<{ label: string; periodLabel: string }> = [
  { label: 'Месяц', periodLabel: '1m' },
  { label: 'Квартал', periodLabel: '3m' },
  { label: 'Год', periodLabel: '12m' },
  { label: '3 года', periodLabel: '3y' },
]

type HorizonGoal = { deadline: string | null; periodLabel: string; createdAt?: string | null; baselineAt?: string | null }

/** Same month arithmetic as lib/goals/evaluate.ts, so «1m» is always exactly one month. */
function addMonths(d: Date, m: number): Date {
  const x = new Date(d.getTime())
  x.setUTCMonth(x.getUTCMonth() + m)
  return x
}

/** The deadline of a goal (explicit date, else from its label), as goalDeadline wants the goal. */
function deadlineOf(goal: HorizonGoal, now: Date): Date {
  return goalDeadline({ deadline: goal.deadline, periodLabel: goal.periodLabel, createdAt: goal.createdAt ?? null, baselineAt: goal.baselineAt ?? null }, now)
}

/** Months from `now` to the goal's deadline, rounded up; 0 when the deadline has passed. */
export function horizonMonths(goal: HorizonGoal, now: Date): number {
  const deadline = deadlineOf(goal, now).getTime()
  if (!Number.isFinite(deadline) || deadline <= now.getTime()) return 0
  let months = 0
  // At most a few hundred steps even for a label like «2100».
  while (months < 2400 && addMonths(now, months).getTime() < deadline) months++
  return months
}

/**
 * The goal the model is built on: the plan's primary goal (when it is a revenue goal that exists),
 * else the revenue goal for 12 months, else the revenue goal with the nearest deadline. null when
 * the company has no revenue goal.
 */
export function pickPrimaryRevenueGoal(
  items: PlanGoalItem[],
  opts: { primary?: { metricKey: string; periodLabel: string } | null; now?: Date } = {},
): PlanGoalItem | null {
  const revenue = items.filter((i) => i.metricKey === REVENUE_GOAL_METRIC && Number.isFinite(i.targetValue) && i.targetValue > 0)
  if (!revenue.length) return null
  const primary = opts.primary
  if (primary && primary.metricKey === REVENUE_GOAL_METRIC) {
    const hit = revenue.find((i) => i.periodLabel === primary.periodLabel)
    if (hit) return hit
  }
  const year = revenue.find((i) => i.periodLabel === '12m')
  if (year) return year
  const now = opts.now ?? new Date()
  let best: { item: PlanGoalItem; at: number } | null = null
  for (const item of revenue) {
    const at = deadlineOf(item, now).getTime()
    if (Number.isFinite(at) && (!best || at < best.at)) best = { item, at }
  }
  return best?.item ?? revenue[0]
}

/** `Nm` (1–60), `Ny` (1–5), `YYYY` (2000–2100), `YYYY-Qn`. */
export function isValidPeriodLabel(label: string): boolean {
  const p = typeof label === 'string' ? label.trim() : ''
  let m = /^(\d{1,3})m$/i.exec(p)
  if (m) return Number(m[1]) >= 1 && Number(m[1]) <= MAX_HORIZON_MONTHS
  m = /^(\d{1,2})y$/i.exec(p)
  if (m) return Number(m[1]) >= 1 && Number(m[1]) * 12 <= MAX_HORIZON_MONTHS
  m = /^(\d{4})$/.exec(p)
  if (m) return Number(m[1]) >= 2000 && Number(m[1]) <= 2100
  m = /^(\d{4})-Q([1-4])$/i.exec(p)
  if (m) return Number(m[1]) >= 2000 && Number(m[1]) <= 2100
  return false
}
