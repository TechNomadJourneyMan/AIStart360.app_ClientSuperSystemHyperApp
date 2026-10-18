/**
 * lib/point-b/model/types.ts — the contracts of the Point B model (plan Ф2, «Контракты»).
 *
 * The model is pure: `ModelInputs` in, `ModelResult` out (lib/point-b/model/compute.ts). Nothing here
 * reads a clock or a database; the time comes in as `ModelInputs.now`. Results never carry NaN or
 * Infinity (they survive a JSON round-trip), and carry `MODEL_VERSION`.
 *
 * Money is KZT. Ratios (`conversion`, `repeat`) are fractions 0..1, not percent. Annual figures are
 * RUN-RATES: the goal is an annual revenue at the deadline and it is reached in the first month whose
 * (de-seasonalised) monthly run-rate × 12 is at least the goal.
 */
import type { FinmodelKey } from '../finmodel/keys'
import type { FinmodelState } from '../finmodel/store'
import type { GoalReviewStatus } from '../plan/types'

/** pb-model-2: level 2 (profit and cash flow). A result of pb-model-1 is read but has no money: it is recalculated. */
export const MODEL_VERSION = 'pb-model-2'

/** 0 — only goals; 1 — levers; 2 — financial model (profit and cash flow, needs a complete finmodel). */
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
  /** Gross margin, a fraction 0..1 (the registry stores percent points). Level 2 needs it. */
  grossMargin?: Sourced<number>
  /** The «Финмодель» of the company (level 2). Absent / null = not loaded: the model stays at level 1 without level-2 hints. */
  finmodel?: FinmodelState | null
  goal: ModelGoal | null
  /** ISO, passed in from outside. */
  now: string
}

/**
 * A band. For money `low ≤ base ≤ high`. For TIME (`timeToGoalMonths`) `low` is the unfavourable case —
 * the LATER month — and `high` the favourable one: low ≥ base ≥ high. null = not reached within 60 months.
 */
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

/**
 * Level 2 (plan Ф3, «Контракты»): profit and cash flow, kept apart. Arrays are by month 1..H,
 * H = max(months to the goal, months to the exit) + 12, at most 60. Money is KZT.
 */
export interface ScenarioFinance {
  ebitda: number[]
  netProfit: number[]
  cash: number[]
  nwc: number[]
  minCash: { value: number; month: number }
  /** The first month with cash below zero; null = never. */
  cashGapMonth: number | null
  /** max(0, MinReserve − min Cash). */
  fundingNeed: number
  reserveRequired: number
  totals: { revenue: number; ebitda: number; netProfit: number; operatingCashFlow: number; capex: number; debtService: number }
  assumptions: string[]
}

export interface ScenarioResult {
  key: ScenarioProfile['key']
  label: string
  feasible: boolean
  infeasibleReason: string | null
  timeToGoalMonths: Range
  /** Annual run-rate at the goal's deadline. */
  revenueAtDeadline: Range
  /** `current` / `target`: leads per month, a check in ₸, conversion and repeat as FRACTIONS 0..1, growth as a fraction (0.25 = 25% a year). */
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
  /** Present at level 2 only. */
  finance?: ScenarioFinance
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

/**
 * GET /api/v1/point-b/state — everything the client page needs in one read.
 * `overview.result` is the automatic preliminary calculation (always, for a PRO client); `plan.scenarios`
 * come from the APPROVED plan version only — a draft or a version in review never reaches the client.
 */
export interface PointBState {
  access: 'ok'
  overview: { result: ModelResult; labelledAutomatic: true }
  /** Completeness of the «Финмодель» (level 2) — never the values: they come from GET /api/v1/point-b/finmodel. */
  finmodel: { complete: boolean; missing: FinmodelKey[]; defaulted: FinmodelKey[] }
  plan: {
    status: 'none' | 'preparing' | 'published'
    version: number | null
    selectedScenario: string | null
    scenarios: ScenarioResult[]
    approvedAt: string | null
    authorName: string | null
  }
}

/** An input the model cannot work with (a zero check, a conversion above 100%…). The text is for the user. */
export class ModelInputError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ModelInputError'
  }
}
