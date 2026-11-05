/**
 * lib/ai/complexity.ts — task complexity of a feature call and its chat tier.
 *
 * Pure helpers shared by lib/ai/openrouter.ts (which tier serves a call) and
 * lib/ai/structured.ts (the retry of a broken structured answer goes one tier
 * up). Kept apart from openrouter.ts so tests that mock that module do not
 * have to mock these too; openrouter.ts re-exports them.
 */
import type { ChatTier } from './providers/types'

/** Task complexity → drives automatic model selection. */
export type Complexity = 'low' | 'medium' | 'high' | 'max'

/** Complexity → gateway tier, so legacy features follow the owner's tier routes. */
export const COMPLEXITY_TIER: Record<Complexity, ChatTier> = {
  low: 'light',
  medium: 'light',
  high: 'standard',
  max: 'premium',
}

/**
 * Heuristic complexity estimate used when a caller specifies neither `model` nor
 * `complexity`. Larger expected outputs and longer prompts imply harder tasks.
 */
export function autoComplexity(opts: { user: string; system?: string; maxTokens?: number }): Complexity {
  const promptChars = (opts.user?.length ?? 0) + (opts.system?.length ?? 0)
  const maxTokens = opts.maxTokens ?? 2000
  // Big, open-ended generations → reason harder. Short ones → go fast.
  if (maxTokens >= 3000 || promptChars >= 12_000) return 'high'
  if (maxTokens <= 600 && promptChars < 4_000) return 'low'
  return 'medium'
}

const TIER_RANK: Record<ChatTier, number> = { light: 0, standard: 1, premium: 2 }
const ESCALATION: readonly Complexity[] = ['low', 'medium', 'high']

/**
 * The complexity of a retry after a broken answer: one chat tier up, stepping
 * low → medium → high until the tier changes (low and medium are both
 * 'light', so both become 'high' = standard). 'high' stays, and so does
 * 'max': a retry never escalates into the premium tier.
 */
export function escalateComplexity(c: Complexity): Complexity {
  const from = ESCALATION.indexOf(c)
  if (from === -1) return c
  for (const next of ESCALATION.slice(from + 1)) {
    if (TIER_RANK[COMPLEXITY_TIER[next]] > TIER_RANK[COMPLEXITY_TIER[c]]) return next
  }
  return c
}
