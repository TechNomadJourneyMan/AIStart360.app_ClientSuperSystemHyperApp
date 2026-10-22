/**
 * lib/point-b/planfact/checkpoint.ts — one plan-fact checkpoint (spec §13): planned (from the approved version),
 * actual (the facts of the month), forecast (the model on today's facts), the verdict per KPI and the overall one
 * with its reason. Pure: the clock and the model result come in.
 */
import type { ModelResult } from '../model/types'
import { plannedFor, planKpis, type PlannedVersion } from './planned'
import { kpiVerdicts, overallVerdict } from './verdict'
import type { Checkpoint, CheckpointForecast, KpiValues, PlanKpi, Tolerances } from './types'

const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n)
const MAX_MONTHS = 60

function addMonths(d: Date, m: number): Date {
  const x = new Date(d.getTime())
  x.setUTCMonth(x.getUTCMonth() + m)
  return x
}

/** The forecast part of a checkpoint from a fresh model result. */
export function forecastFromResult(result: ModelResult | null, now: Date): CheckpointForecast {
  if (!result) return { atDeadlineAnnual: null, trendMonthlyPct: null, basis: 'insufficient', goalAnnual: null, deadline: null, reachDate: null }
  const g = result.gap
  const trend = result.forecast?.trendMonthlyPct
  const base = g?.baseAnnual
  const target = g?.targetAnnual
  let reachDate: string | null = null
  if (finite(trend) && trend > 0 && finite(base) && base > 0 && finite(target) && target > base) {
    const months = Math.ceil(Math.log(target / base) / Math.log(1 + trend / 100))
    if (finite(months) && months <= MAX_MONTHS) reachDate = addMonths(now, Math.max(1, months)).toISOString().slice(0, 10)
  }
  return {
    atDeadlineAnnual: finite(result.forecast?.atCurrentPace?.base) ? result.forecast.atCurrentPace.base : null,
    trendMonthlyPct: finite(trend) ? Math.round(trend * 100) / 100 : null,
    basis: result.forecast?.basis === 'history' ? 'history' : 'insufficient',
    goalAnnual: finite(target) ? target : null,
    deadline: finite(g?.months) && g.months >= 1 ? addMonths(now, g.months).toISOString().slice(0, 10) : null,
    reachDate,
  }
}

export interface BuildCheckpointInput {
  version: PlannedVersion
  period: string
  actual: KpiValues
  actualSources?: Checkpoint['actualSources']
  result: ModelResult | null
  tolerances: Tolerances
  now: Date
}

export function buildCheckpoint(input: BuildCheckpointInput): Checkpoint {
  const kpis: PlanKpi[] = planKpis(input.version)
  const planned = plannedFor(input.version, input.period)
  const actual: KpiValues = {}
  const sources: Checkpoint['actualSources'] = {}
  for (const k of kpis) {
    const v = input.actual[k]
    if (finite(v)) {
      actual[k] = v
      const src = input.actualSources?.[k]
      if (src) sources[k] = src
    }
  }
  const verdict = kpiVerdicts(kpis, planned.values, actual, input.tolerances)
  const { overall, reason } = overallVerdict(verdict, input.period)
  return {
    period: input.period,
    versionId: input.version.id,
    planned: planned.values,
    plannedRange: planned.revenueRange,
    actual,
    actualSources: sources,
    forecast: forecastFromResult(input.result, input.now),
    verdict,
    overall,
    reason,
    computedAt: input.now.toISOString(),
  }
}

/** The checkpoint for the verdict strip: the newest with data, else the newest. `list` is sorted by period. */
export function currentCheckpoint(list: Checkpoint[]): Checkpoint | null {
  if (!list.length) return null
  return [...list].reverse().find((c) => c.overall !== 'no_data') ?? list[list.length - 1]
}
