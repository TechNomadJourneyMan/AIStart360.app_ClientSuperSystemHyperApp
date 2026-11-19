/** Shared types of the rate limiter (lib/rate-limit.ts) and its stores. */

export type RateLimitBackend = 'upstash' | 'postgres' | 'memory'

/** One store answer for a single hit. */
export interface StoreDecision {
  allowed: boolean
  /** Hits left in the current sliding window after this one (0 when denied). */
  remaining: number
  /** Seconds until a hit would be allowed again (0 when allowed). */
  retryAfterSeconds: number
}

/**
 * A counter store. `key` is already '<bucket>:<hashed identifier>'; a store
 * never sees raw user ids or IPs. Throws when the store is unavailable — the
 * caller (lib/rate-limit.ts) applies the fail-closed / fail-open policy.
 */
export interface RateLimitStore {
  readonly backend: RateLimitBackend
  hit(key: string, windowSeconds: number, max: number): Promise<StoreDecision>
  /**
   * Give back ONE allowed hit of `key` (the latest window that holds one; never below zero) — for
   * limiters that count only failed attempts: reserve with hit() before the check, refund on
   * success. Optional: a store without it cannot refund (the hit stays counted).
   */
  refund?(key: string, windowSeconds: number, max: number): Promise<void>
}
