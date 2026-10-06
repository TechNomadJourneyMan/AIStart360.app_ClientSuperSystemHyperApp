/**
 * Upstash Redis store — used when UPSTASH_REDIS_REST_URL and
 * UPSTASH_REDIS_REST_TOKEN are both set. Uses the official @upstash/ratelimit
 * sliding window (already a dependency), one limiter per (max, window).
 *
 * The SDK's default is to ALLOW a request when Redis does not answer within
 * `timeout`; here a timeout is reported as a store error instead, so the
 * fail-closed / fail-open policy of lib/rate-limit.ts decides.
 */
import { Ratelimit } from '@upstash/ratelimit'
import { Redis } from '@upstash/redis'
import type { RateLimitStore, StoreDecision } from './types'

const TIMEOUT_MS = 2_000

export function upstashConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.UPSTASH_REDIS_REST_URL?.trim() && env.UPSTASH_REDIS_REST_TOKEN?.trim())
}

export function createUpstashStore(): RateLimitStore {
  const redis = Redis.fromEnv()
  const limiters = new Map<string, Ratelimit>()

  function limiter(max: number, windowSeconds: number): Ratelimit {
    const k = `${max}:${windowSeconds}`
    let rl = limiters.get(k)
    if (!rl) {
      rl = new Ratelimit({
        redis,
        limiter: Ratelimit.slidingWindow(max, `${windowSeconds} s`),
        prefix: 'aistart360:rl',
        timeout: TIMEOUT_MS,
        analytics: false,
      })
      limiters.set(k, rl)
    }
    return rl
  }

  return {
    backend: 'upstash',
    async hit(key, windowSeconds, max): Promise<StoreDecision> {
      const res = await limiter(max, windowSeconds).limit(key)
      if (res.reason === 'timeout') throw new Error('upstash timeout')
      return {
        allowed: res.success,
        remaining: Math.max(0, res.remaining),
        retryAfterSeconds: res.success ? 0 : Math.max(1, Math.ceil((res.reset - Date.now()) / 1000)),
      }
    },
  }
}
