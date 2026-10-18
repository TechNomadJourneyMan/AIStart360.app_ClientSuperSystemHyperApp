/**
 * lib/point-b/model/inputs.ts — ModelInputs from the loaded Point B inputs (pure, no IO).
 *
 * Levers come from the metric values Point A holds (lib/point-b/metrics.ts); percent metrics become
 * fractions. A value that is not a positive number is NOT a lever: it becomes `null` and the model
 * lists it in `missing` — there are no invented defaults here. The goal is the primary REVENUE goal
 * of the plan (lib/point-b/horizons.ts).
 */
import { REVENUE_GOAL_METRIC } from '@/lib/goals/store'
import { horizonDeadline, horizonMonths, pickPrimaryRevenueGoal } from '../horizons'
import type { FinmodelState } from '../finmodel/store'
import type { PointBInputs } from '../inputs'
import { POINT_B_ACTIVE_CLIENTS_METRIC, POINT_B_HEADCOUNT_METRIC } from '../metrics'
import { POINT_B_LEVER_METRICS } from '../engine'
import type { PlanGoalsSnapshot } from '../plan/types'
import type { ModelGoal, ModelInputs, Sourced, TemplateKey } from './types'

const NONE: Sourced<number> = { value: null, origin: null, period: null }

export const noValue = (): Sourced<number> => ({ ...NONE })

/** A positive finite number or null. */
function positive(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null
}

function lever(metrics: PointBInputs['metricOptions']['metrics'], id: string, scale = 1): Sourced<number> {
  const v = positive(metrics?.[id])
  return v === null ? noValue() : { value: v * scale, origin: 'fact', period: null }
}

const PERIOD_RE = /^(\d{4})-(0[1-9]|1[0-2])$/

/** Valid months only (YYYY-MM, a positive finite revenue), one value per month (the last wins), ascending. */
export function sanitizeHistory(history: ModelInputs['history']): ModelInputs['history'] {
  const byPeriod = new Map<string, number>()
  for (const h of history ?? []) {
    if (h && typeof h.period === 'string' && PERIOD_RE.test(h.period) && positive(h.revenue) !== null) byPeriod.set(h.period, h.revenue)
  }
  return [...byPeriod.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([period, revenue]) => ({ period, revenue }))
}

/** The active base the funnel starts from: the stated one, else leads × conversion × 12 (derived). */
export function withDerivedActiveBase(levers: ModelInputs['levers']): ModelInputs['levers'] {
  if (positive(levers.activeBase.value) !== null) return levers
  const leads = positive(levers.leads.value)
  const conversion = positive(levers.conversion.value)
  if (leads === null || conversion === null) return levers
  return { ...levers, activeBase: { value: leads * conversion * 12, origin: 'derived', period: null } }
}

function modelGoal(goals: PlanGoalsSnapshot | null, now: Date): ModelGoal | null {
  if (!goals) return null
  const item = pickPrimaryRevenueGoal(goals.items, { primary: goals.primary, now })
  if (!item) return null
  return {
    metricKey: REVENUE_GOAL_METRIC as ModelGoal['metricKey'],
    targetAnnual: item.targetValue,
    deadline: horizonDeadline(item, now),
    months: horizonMonths(item, now),
    reviewStatus: item.reviewStatus,
  }
}

export function buildModelInputs(input: {
  pb: PointBInputs
  history: ModelInputs['history']
  template: TemplateKey
  goals: PlanGoalsSnapshot | null
  now: Date
  /** The «Финмодель» (level 2). Omitted = not loaded. */
  finmodel?: FinmodelState | null
}): ModelInputs {
  const { pb, now } = input
  const metrics = pb.metricOptions.metrics
  const revenue = positive(pb.base.revenue)
  const levers: ModelInputs['levers'] = {
    leads: lever(metrics, POINT_B_LEVER_METRICS.leads),
    // The registry stores percent points («12» = 12%); the model works with fractions.
    conversion: lever(metrics, POINT_B_LEVER_METRICS.conversion, 0.01),
    avgCheck: lever(metrics, POINT_B_LEVER_METRICS.avgCheck),
    repeat: lever(metrics, POINT_B_LEVER_METRICS.repeat, 0.01),
    activeBase: lever(metrics, POINT_B_ACTIVE_CLIENTS_METRIC),
    cac: lever(metrics, POINT_B_LEVER_METRICS.cac),
    headcount: lever(metrics, POINT_B_HEADCOUNT_METRIC),
  }
  return {
    template: input.template,
    base: {
      revenueYear: revenue === null ? noValue() : { value: revenue, origin: 'fact', period: pb.base.period },
      ageMonths: pb.base.ageMonths,
      stale: pb.base.stale,
    },
    levers: withDerivedActiveBase(levers),
    history: sanitizeHistory(input.history),
    // The registry stores the margin in percent points («35» = 35%); the model works with fractions.
    grossMargin: lever(metrics, POINT_B_LEVER_METRICS.margin, 0.01),
    finmodel: input.finmodel ?? null,
    goal: modelGoal(input.goals, now),
    now: now.toISOString(),
  }
}
