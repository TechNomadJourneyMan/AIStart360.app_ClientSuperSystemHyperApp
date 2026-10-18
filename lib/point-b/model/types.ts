/**
 * lib/point-b/model/types.ts — the contracts of the Point B model (plan Ф2, «Контракты»).
 *
 * The model is pure: `ModelInputs` in, `ModelResult` out (lib/point-b/model/compute.ts). Nothing here
 * reads a clock or a database; the time comes in as `ModelInputs.now`. Results never carry NaN or
 * Infinity (they survive a JSON round-trip), and carry `MODEL_VERSION`.
 *
 * Money is KZT. Ratios (`conversion`, `repeat`) are fractions 0..1, not percent. Annual figures are
 * RUN-RATES: the goal is an annual revenue at the deadline and it is reached when the mean of the
 * last three months × 12 is at least the goal.
 */
import type { GoalReviewStatus } from '../plan/types'

export const MODEL_VERSION = 'pb-model-1'

/** 0 — only goals; 1 — levers (this phase); 2 — financial model (a later phase). */
export type DataLevel = 0 | 1 | 2
export type ModelKind = 'funnel' | 'growth' | 'none'
export type TemplateKey = 'default' | 'ecommerce' | 'services' | 'production'
/** Where a number comes from (spec §5: the six layers of data are never mixed up). */
export type Origin = 'fact' | 'user' | 'expert' | 'derived' | 'default'

export interface Sourced<T> { value: T | null; origin: Origin | null; period: string | null }

export interface ModelGoal {
  metricKey: 'biz.finansy.vyruchka_god'
  targetAnnual: number
  /** YYYY-MM-DD */
  deadline: string
  months: number
  reviewStatus: GoalReviewStatus
}

export interface MissingInput {
  key: string
  label: string
  unlocks: string
  level: 1 | 2
  actions: Array<'survey' | 'documents' | 'expert'>
}

export interface ModelInputs {
  template: TemplateKey
  base: { revenueYear: Sourced<number>; ageMonths: number | null; stale: boolean }
  levers: {
    leads: Sourced<number>
    /** fraction 0..1 */
    conversion: Sourced<number>
    avgCheck: Sourced<number>
    /** fraction 0..1 of clients who bought again within 12 months */
    repeat: Sourced<number>
    activeBase: Sourced<number>
    cac: Sourced<number>
    headcount: Sourced<number>
  }
  /** Monthly revenue, ascending. */
  history: Array<{ period: string /* YYYY-MM */; revenue: number }>
  goal: ModelGoal | null
  /** ISO, passed in from outside. */
  now: string
}

export interface Range { low: number | null; base: number | null; high: number | null }

export interface ScenarioProfile {
  key: 'cautious' | 'moderate' | 'aggressive'
  label: string
  /** Months in which the levers reach the target level. */
  rampMonths: number
  /** Liquidity reserve policy (used in a later phase). */
  reserveMonths: number
  /** Growth of revenue per employee, a fraction. */
  productivityGain: number
  /** Ceiling of annual growth for the simplified model. */
  growthCapAnnual: number
  /** Shares of the contribution of each lever, sum 1. */
  leverMix: { leads: number; conversion: number; avgCheck: number; repeat: number }
}

export interface ScenarioResult {
  key: ScenarioProfile['key']
  label: string
  feasible: boolean
  infeasibleReason: string | null
  timeToGoalMonths: Range
  /** Annual run-rate at the goal's deadline. */
  revenueAtDeadline: Range
  requiredUplift: Array<{
    lever: 'leads' | 'conversion' | 'avgCheck' | 'repeat' | 'growth'
    label: string
    current: number | null
    target: number | null
    upliftPct: number | null
  }>
  investments: { marketingMonthlyIncrease: number | null; totalOverRamp: number | null; staffNeed: number | null; note: string }
  constraints: string[]
  risks: string[]
  conditions: string[]
  downside: string
  reviewPoints: string[]
  signsToChangePace: string[]
  assumptions: string[]
  /** Annual run-rate by month; month 0 is today (low = base = high = the base revenue). */
  trajectory: Array<{ month: number; low: number; base: number; high: number }>
}

export type VerdictKey = 'on_track' | 'at_risk' | 'behind' | 'no_data'

export interface ModelResult {
  modelVersion: string
  computedAt: string
  level: DataLevel
  kind: ModelKind
  template: TemplateKey
  gap: { baseAnnual: number | null; targetAnnual: number | null; absolute: number | null; multiplier: number | null; requiredCagrPct: number | null; months: number | null }
  forecast: { atCurrentPace: Range; trendMonthlyPct: number | null; basis: 'history' | 'insufficient' }
  verdict: { key: VerdictKey; headline: string; reason: string }
  /** Empty at level 0. */
  scenarios: ScenarioResult[]
  missing: MissingInput[]
  warnings: string[]
}

export type Forecast = ModelResult['forecast']

/** An input the model cannot work with (a zero check, a conversion above 100%…). The text is for the user. */
export class ModelInputError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ModelInputError'
  }
}
