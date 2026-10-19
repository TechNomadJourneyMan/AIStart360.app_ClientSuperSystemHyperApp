/**
 * lib/point-b/strategy/load.ts — the strategy part of the client's page state (PointBState.plan.strategy):
 * the tree of the APPROVED version with the LIVE progress read from the client's action plan.
 *
 * Reads only; the caller authorises the user and passes the strategy of the published version (a draft's
 * strategy never gets here). A failed read of the statuses (migration 128 not applied, the table is down)
 * does not fail the page: the tree is shown with no progress («нет задач»), the error is logged.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import type { StrategyState } from '../model/types'
import { buildMatrix } from './matrix'
import { computeProgress, type TaskStatus } from './progress'
import { loadTaskStatuses } from './tasks'
import { EMPTY_STRATEGY, type PlanStrategy } from './types'
import { validateStrategy } from './validate'

/** The stored jsonb as a strategy; `{}` (the column default) is an empty one, a broken value too (logged). */
export function readStoredStrategy(raw: unknown): PlanStrategy {
  // The profanity filter is for what people write; a published plan is not hidden when the filter grows.
  const parsed = validateStrategy(raw ?? {}, { moderation: false })
  if (parsed.ok) return parsed.strategy
  console.error('[point-b/strategy] stored strategy is not valid — shown as empty', parsed.field)
  return { items: [], milestones: [] }
}

export async function loadStrategyState(sb: SupabaseClient, userId: string, stored: unknown): Promise<StrategyState> {
  const strategy = readStoredStrategy(stored ?? EMPTY_STRATEGY)
  const keys = strategy.items.filter((n) => n.kind === 'task').map((n) => n.key)
  let statuses: Record<string, TaskStatus> = {}
  if (keys.length) {
    try {
      statuses = await loadTaskStatuses(sb, userId, keys)
    } catch (err) {
      console.error('[point-b/strategy] task statuses not read — no progress is shown', err instanceof Error ? err.message : err)
    }
  }
  return {
    items: strategy.items,
    milestones: strategy.milestones,
    progress: computeProgress(strategy.items, statuses),
    matrix: buildMatrix(strategy.items),
  }
}
