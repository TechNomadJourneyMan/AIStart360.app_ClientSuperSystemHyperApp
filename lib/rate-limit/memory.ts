/**
 * In-memory sliding-window store — development and tests ONLY.
 *
 * Same algorithm as public.rate_limit_hit (supabase/migrations/100): the
 * previous fixed window is weighted by how much of it still overlaps the
 * sliding window, and only allowed hits are counted. Counters live in this
 * process, so on serverless every instance would have its own — that is why
 * lib/rate-limit.ts never selects this store in production.
 *
 * Bounded: entries expire two windows after their window started; expired
 * entries are swept periodically and the map never holds more than
 * `maxEntries` keys (least recently used are dropped first).
 */
import type { RateLimitStore, StoreDecision } from './types'

interface Entry {
  windowStart: number
  cur: number
  prev: number
  expiresAt: number
}

export interface MemoryStoreOptions {
  maxEntries?: number
  sweepEveryMs?: number
  now?: () => number
}

export interface MemoryStore extends RateLimitStore {
  readonly backend: 'memory'
  size(): number
  clear(): void
}

export function createMemoryStore(opts: MemoryStoreOptions = {}): MemoryStore {
  const maxEntries = opts.maxEntries ?? 10_000
  const sweepEveryMs = opts.sweepEveryMs ?? 60_000
  const now = opts.now ?? Date.now
  const entries = new Map<string, Entry>()
  let lastSweep = now()

  function sweep(t: number) {
    lastSweep = t
    entries.forEach((e, k) => {
      if (e.expiresAt <= t) entries.delete(k)
    })
  }

  function decide(e: Entry, t: number, windowMs: number, max: number): StoreDecision {
    const elapsed = t - e.windowStart
    const weight = Math.max(0, 1 - elapsed / windowMs)
    const estimate = e.prev * weight + e.cur
    if (estimate + 1 <= max) {
      e.cur += 1
      return { allowed: true, remaining: Math.max(0, Math.floor(max - (estimate + 1))), retryAfterSeconds: 0 }
    }
    let retryMs: number
    if (e.cur < max && e.prev > 0) {
      retryMs = windowMs * (1 - (max - e.cur - 1) / e.prev) - elapsed
    } else {
      retryMs = windowMs - elapsed + windowMs * Math.max(0, 1 - (max - 1) / Math.max(e.cur, 1))
    }
    const retryAfterSeconds = Math.min(2 * Math.ceil(windowMs / 1000), Math.max(1, Math.ceil(retryMs / 1000)))
    return { allowed: false, remaining: 0, retryAfterSeconds }
  }

  return {
    backend: 'memory',
    async hit(key, windowSeconds, max) {
      const t = now()
      if (t - lastSweep >= sweepEveryMs) sweep(t)
      const windowMs = windowSeconds * 1000
      const windowStart = Math.floor(t / windowMs) * windowMs
      const mapKey = `${windowSeconds}|${key}`

      let e = entries.get(mapKey)
      if (e) {
        entries.delete(mapKey) // re-inserted below → Map order = recency
        if (e.windowStart !== windowStart) {
          e = {
            prev: e.windowStart === windowStart - windowMs ? e.cur : 0,
            cur: 0,
            windowStart,
            expiresAt: windowStart + 2 * windowMs,
          }
        }
      } else {
        e = { prev: 0, cur: 0, windowStart, expiresAt: windowStart + 2 * windowMs }
      }
      const decision = decide(e, t, windowMs, max)
      entries.set(mapKey, e)

      if (entries.size > maxEntries) {
        sweep(t)
        const it = entries.keys()
        while (entries.size > maxEntries) {
          const oldest = it.next()
          if (oldest.done) break
          entries.delete(oldest.value)
        }
      }
      return decision
    },
    size: () => entries.size,
    clear: () => entries.clear(),
  }
}
