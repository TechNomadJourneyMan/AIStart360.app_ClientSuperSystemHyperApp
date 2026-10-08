/**
 * Default dependencies of the bot assistant and the test hook to replace them.
 */
import { isRateLimitedKey } from '@/lib/rate-limit'
import { defaultBrainLlm } from './llm-port'
import { dbBrainMemory } from './memory'
import { loadBrainScope } from './scope'
import type { BrainDeps } from './types'
import { defaultAttachDeps, type AttachDeps } from './attach'

/** AI turns per chat: 20 per 10 minutes (on top of the bots' 40 updates / minute). */
export const BRAIN_RATE_MAX = 20
export const BRAIN_RATE_WINDOW_MS = 10 * 60_000

const defaults = (): BrainDeps & { attach: () => AttachDeps } => ({
  llm: defaultBrainLlm,
  memory: dbBrainMemory,
  rateLimit: (key) => isRateLimitedKey(key, 'telegram-brain', { max: BRAIN_RATE_MAX, windowMs: BRAIN_RATE_WINDOW_MS }),
  scope: loadBrainScope,
  now: () => new Date(),
  attach: defaultAttachDeps,
})

let injected: Partial<BrainDeps & { attach: () => AttachDeps }> | null = null

export function brainDeps(): BrainDeps & { attach: () => AttachDeps } {
  return { ...defaults(), ...(injected ?? {}) }
}

/** Test hook: replace some dependencies (null restores the defaults). */
export function __setBrainDeps(deps: Partial<BrainDeps & { attach: () => AttachDeps }> | null): void {
  injected = deps
}
