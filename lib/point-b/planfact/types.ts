/**
 * lib/point-b/planfact/types.ts — the contracts of the Point B plan-fact (spec §13; plan Ф6b). Types only.
 *
 * Units of every KPI value (planned, actual, forms, checkpoints): revenue — KZT per MONTH, leads — per month,
 * conversion — PERCENT (12 = 12%), average check — KZT, cash — KZT on the accounts at the end of the month.
 * The model keeps conversion as a fraction; the plan-fact converts at its border (planned.ts / actuals.ts).
 */

export type PlanKpi = 'revenue' | 'leads' | 'conversion' | 'avg_check' | 'cash'
export const PLAN_KPIS: readonly PlanKpi[] = ['revenue', 'leads', 'conversion', 'avg_check', 'cash']

/** The verdict of a KPI and of a checkpoint (spec §13): «на курсе / риск / отстаём / нет данных». */
export type PlanFactVerdict = 'on_track' | 'risk' | 'behind' | 'no_data'

/** Shortfall of the fact against the plan, percent: within `onTrackPct` — on track, within `riskPct` — risk. */
export interface Tolerances { onTrackPct: number; riskPct: number }
export const DEFAULT_TOLERANCES: Tolerances = { onTrackPct: 5, riskPct: 15 }

export type KpiValues = Partial<Record<PlanKpi, number | null>>

export interface KpiVerdictEntry {
  kpi: PlanKpi
  verdict: PlanFactVerdict
  planned: number | null
  actual: number | null
  /** (planned − actual) / |planned| × 100; negative = above the plan; null without both numbers. */
  shortfallPct: number | null
  /** «конверсия 11% при плане 13%» / «нет факта за месяц». */
  reason: string
}

export interface CheckpointForecast {
  /** Where the business lands at the goal's deadline at the current pace (annual run-rate), the model's forecast. */
  atDeadlineAnnual: number | null
  trendMonthlyPct: number | null
  basis: 'history' | 'insufficient'
  goalAnnual: number | null
  deadline: string | null
  /** YYYY-MM-DD when the revenue goal is reached at the current trend; null = not within 60 months / no trend. */
  reachDate: string | null
}

export interface Checkpoint {
  /** YYYY-MM */
  period: string
  versionId: string
  planned: KpiValues
  /** The band of the planned monthly revenue (the scenario corridor). */
  plannedRange: { low: number; high: number } | null
  actual: KpiValues
  /** Where each actual came from: the monthly reconciliation or the facts of Point A. */
  actualSources: Partial<Record<PlanKpi, 'reconciliation' | 'facts'>>
  forecast: CheckpointForecast
  verdict: Partial<Record<PlanKpi, KpiVerdictEntry>>
  overall: PlanFactVerdict
  reason: string
  computedAt: string
}

/** Progress of ONE goal (spec §13): never a single aggregated percent. */
export interface GoalProgress {
  metricKey: string
  periodLabel: string
  label: string
  unit: 'money_year' | 'money' | 'number' | 'percent'
  base: number | null
  fact: number | null
  /** YYYY-MM of the fact, or null when it is the current value without a period. */
  factPeriod: string | null
  target: number
  /** Share of the way from the base to the target, 0..1+ (may be negative, may be above 1); null = no fact or no base. */
  pathShare: number | null
  /** Share of the time from the start to the deadline, 0..1. */
  timeShare: number | null
  startDate: string | null
  deadline: string | null
  /** Forecast date of reaching the goal at the current pace; null with the reason in `forecastNote`. */
  forecastDate: string | null
  forecastNote: string | null
}

export interface VersionSummary {
  id: string
  version: number
  status: 'draft' | 'in_review' | 'approved' | 'superseded'
  authorName: string | null
  authorKind: string | null
  approvedAt: string | null
  approverName: string | null
  createdAt: string
  changeReason: string | null
  goals: Array<{ key: string; label: string; target: number; deadline: string | null; status: string }>
  primaryGoal: string | null
  selectedScenario: string | null
  /** The pace profile of the selected scenario (or the first stored one). */
  pace: { key: string; label: string; rampMonths: number | null; reserveMonths: number | null; growthCapAnnual: number | null } | null
  /** Key assumptions: what the model was computed from (level, base revenue, levers, goal months). */
  assumptions: Array<{ key: string; label: string; value: string }>
  /** Totals of the selected scenario's trajectory. */
  totals: { timeToGoalMonths: number | null; revenueAtDeadline: number | null; revenueTotal: number | null; netProfitTotal: number | null; fundingNeed: number | null }
  strategy: Array<{ key: string; kind: string; title: string }>
  /**
   * The client sees only the content of the APPROVED version (RLS of migration 125, spec §6); of a superseded version
   * he gets the metadata (number, dates, who approved, the reason of the change) — the content is empty here.
   */
  contentHidden?: boolean
}

export interface VersionDiffEntry { field: string; label: string; before: string; after: string }

export interface VersionDiff {
  from: { id: string; version: number }
  to: { id: string; version: number }
  goals: VersionDiffEntry[]
  pace: VersionDiffEntry[]
  assumptions: VersionDiffEntry[]
  totals: VersionDiffEntry[]
  strategyAdded: Array<{ key: string; kind: string; title: string }>
  strategyRemoved: Array<{ key: string; kind: string; title: string }>
  strategyRenamed: Array<{ key: string; before: string; after: string }>
  /** The reason / comment of the newer version. */
  reason: string | null
  unchanged: boolean
}

/** The plan-fact part of GET /api/v1/point-b/state (and of the staff view). */
export interface PlanFactState {
  /** Newest month LAST, at most 12. */
  checkpoints: Checkpoint[]
  /** The checkpoint shown in the verdict strip: the newest with data, else the newest. */
  current: Checkpoint | null
  progress: GoalProgress[]
  /** The KPIs of the approved plan — what the «Факт за месяц» form asks. */
  kpis: PlanKpi[]
  /** The month the form proposes (the last finished one) and whether it is filled. */
  reconciliation: { period: string; done: boolean; values: KpiValues }
  /** When the forecast was last calculated; null = never. */
  computedAt: string | null
  /** Days since `computedAt` (the «обновлено N дней назад» badge). */
  staleDays: number | null
  /** Approved / superseded versions for the client; every version for the staff. Newest first, at most 10. */
  versions: VersionSummary[]
}
