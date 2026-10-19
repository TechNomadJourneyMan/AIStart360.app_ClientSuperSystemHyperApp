/**
 * lib/point-b/strategy/types.ts — the strategy tree of a plan version (spec §11).
 *
 * Stored in pb_plan_versions.strategy (jsonb): versioned, immutable once approved, copied into the next
 * draft. Levels are strictly strategy → initiative → task. A task becomes a row of action_items when
 * the version is published (tasks.ts); the progress is calculated on read from the live statuses.
 * Types only (plus the empty value) — safe to import from the UI.
 */

export type StrategyKind = 'strategy' | 'initiative' | 'task'

export interface StrategyNode {
  /** uuid-like, stable between versions (the link with action_items.pb_task_key). */
  key: string
  kind: StrategyKind
  parentKey: string | null
  title: string
  description: string | null
  ownerLabel: string | null
  /** YYYY-MM-DD. */
  dueDate: string | null
  /** 1..5, strategies and initiatives only. */
  impact: number | null
  effort: number | null
  /** A metric of the registry and a Point A block — a link only, nothing is calculated from them. */
  metricId: string | null
  block: string | null
  kpi: { name: string; target: number | null; unit: string | null } | null
  /** Keys of nodes of the SAME level. */
  dependsOn: string[]
  delayRisk: string | null
  order: number
}

export interface Milestone {
  key: string
  title: string
  /** YYYY-MM-DD. */
  date: string
  description: string | null
  kpi: string | null
}

export interface PlanStrategy {
  items: StrategyNode[]
  milestones: Milestone[]
}

export const EMPTY_STRATEGY: PlanStrategy = Object.freeze({ items: [], milestones: [] }) as PlanStrategy

export const STRATEGY_LIMITS = Object.freeze({
  strategies: 12,
  initiatives: 60,
  tasks: 300,
  milestones: 24,
  title: 200,
  description: 2000,
  jsonBytes: 400 * 1024,
})
