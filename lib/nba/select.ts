/**
 * lib/nba/select.ts — Next Best Action selector (deterministic core).
 *
 * Picks the ONE action a user should do next from a set of already-collected
 * signals. Deterministic and pure so it is fully unit-testable and reproducible
 * (docs/SPEC-2026-07-09-AI-FEATURES/02-next-best-action-plan.md §A2). Signal
 * collection (CRM reminders, Point A red zones, GRI limits, plan tasks, pulse…)
 * lives in the API layer; the LLM only phrases the winner's title/reason, it
 * never chooses. Invariant: returns a single action or null — never a list.
 */

export type NbaSignalKey =
  | 'crm_overdue'
  | 'red_zone'
  | 'gri_limit'
  | 'survey_incomplete'
  | 'plan_task'
  | 'pulse_stale'
  | 'gri_rescan'
  | 'psych_missing'
  | 'docs_missing'

/** Base weights (fixed methodology). Higher = more urgent by default. */
export const NBA_BASE_WEIGHTS: Record<NbaSignalKey, number> = {
  crm_overdue: 90,
  red_zone: 85,
  gri_limit: 80,
  survey_incomplete: 75,
  plan_task: 65,
  pulse_stale: 60,
  gri_rescan: 55,
  psych_missing: 35,
  docs_missing: 30,
}

/** Fixed priority order for deterministic tie-breaking. */
export const NBA_SIGNAL_ORDER: NbaSignalKey[] = [
  'crm_overdue', 'red_zone', 'gri_limit', 'survey_incomplete',
  'plan_task', 'pulse_stale', 'gri_rescan', 'psych_missing', 'docs_missing',
]

/** Stage-specific +10 boosts (seed = get set up; scale = work the pipeline). */
const STAGE_BOOST: Record<string, Partial<Record<NbaSignalKey, number>>> = {
  seed: { survey_incomplete: 10, docs_missing: 10 },
  early: { survey_incomplete: 10 },
  scale: { crm_overdue: 10, plan_task: 10 },
  mature: { crm_overdue: 10, plan_task: 10 },
}

const GOAL_BOOST = 5
const PSYCH_BOOST_CAP = 10
const COUNT_BONUS_PER = 2
const COUNT_BONUS_CAP = 10
const COOLDOWN_PENALTY = 100

export interface NbaSignal {
  key: NbaSignalKey
  /** Stable instance id for cooldown/logging, e.g. `red_zone:sales`. */
  actionKey: string
  active: boolean
  title: string
  reason: string
  cta: { label: string; href: string }
  source: { type: string; ref?: string }
  /** Number of underlying items (e.g. overdue reminders) for a bounded bonus. */
  count?: number
}

export interface NbaModifiers {
  stage?: string | null
  /** Signal keys aligned with the user's stated goal → small boost. */
  goalAlignedKeys?: NbaSignalKey[]
  /** Per-signal psych-profile nudges; clamped to ±10 so it can never dominate. */
  psychBoost?: Partial<Record<NbaSignalKey, number>>
}

export interface NbaHistory {
  /** True if this actionKey was dismissed within the 72h cooldown. */
  dismissedWithinCooldown?: (actionKey: string) => boolean
  /** True if this actionKey was completed within the 7d cooldown. */
  completedWithinCooldown?: (actionKey: string) => boolean
}

export interface NextBestAction {
  key: NbaSignalKey
  actionKey: string
  title: string
  reason: string
  cta: { label: string; href: string }
  source: { type: string; ref?: string }
  score: number
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n))
}

function scoreSignal(s: NbaSignal, mods: NbaModifiers, history: NbaHistory): number {
  let score = NBA_BASE_WEIGHTS[s.key]

  if (s.count && s.count > 1) {
    score += Math.min((s.count - 1) * COUNT_BONUS_PER, COUNT_BONUS_CAP)
  }

  const stageBoost = mods.stage ? STAGE_BOOST[mods.stage]?.[s.key] ?? 0 : 0
  score += stageBoost

  if (mods.goalAlignedKeys?.includes(s.key)) score += GOAL_BOOST

  if (mods.psychBoost?.[s.key] != null) {
    score += clamp(mods.psychBoost[s.key]!, -PSYCH_BOOST_CAP, PSYCH_BOOST_CAP)
  }

  if (history.dismissedWithinCooldown?.(s.actionKey)) score -= COOLDOWN_PENALTY
  if (history.completedWithinCooldown?.(s.actionKey)) score -= COOLDOWN_PENALTY

  return score
}

export function selectNextBestAction(
  signals: NbaSignal[],
  modifiers: NbaModifiers = {},
  history: NbaHistory = {},
): NextBestAction | null {
  const scored = signals
    .filter((s) => s.active)
    .map((s) => ({ s, score: scoreSignal(s, modifiers, history) }))
    .filter((c) => c.score > 0)

  if (scored.length === 0) return null

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score
    return NBA_SIGNAL_ORDER.indexOf(a.s.key) - NBA_SIGNAL_ORDER.indexOf(b.s.key)
  })

  const { s, score } = scored[0]
  return {
    key: s.key,
    actionKey: s.actionKey,
    title: s.title,
    reason: s.reason,
    cta: s.cta,
    source: s.source,
    score,
  }
}
