import { Ratelimit } from '@upstash/ratelimit'
import { Redis } from '@upstash/redis'

// 10 запросов в минуту на auth endpoints
export const authRateLimit =
  process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
    ? new Ratelimit({
        redis: Redis.fromEnv(),
        limiter: Ratelimit.slidingWindow(10, '1m'),
        analytics: true,
      })
    : null

// ── Shared limiter helper ────────────────────────────────────────────────────
// Uses Upstash when configured; otherwise a best-effort in-memory fallback so
// sensitive endpoints (login/register/demo-access/etc.) are never COMPLETELY
// unprotected when Redis is absent. The in-memory map is per-instance only.
const DEFAULT_WINDOW_MS = 60_000
const DEFAULT_MAX = 10
const memBuckets = new Map<string, { count: number; resetAt: number }>()

export function clientIp(req: Request): string {
  const h = req.headers
  return (
    h.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    h.get('x-real-ip') ||
    'unknown'
  )
}

function memoryLimited(key: string, max: number, windowMs: number): boolean {
  const now = Date.now()
  const cur = memBuckets.get(key)
  if (!cur || cur.resetAt < now) {
    memBuckets.set(key, { count: 1, resetAt: now + windowMs })
    return false
  }
  cur.count += 1
  return cur.count > max
}

/**
 * Enforce a rate limit for `bucket`, keyed by client IP. Returns true when the
 * request should be rejected (429). Falls back to an in-memory limiter when
 * Upstash is not configured, so the endpoint is never fully unprotected.
 */
export async function isRateLimited(
  req: Request,
  bucket: string,
  opts: { max?: number; windowMs?: number } = {},
): Promise<boolean> {
  const ip = clientIp(req)
  if (authRateLimit) {
    const { success } = await authRateLimit.limit(`${bucket}:${ip}`)
    return !success
  }
  return memoryLimited(
    `${bucket}:${ip}`,
    opts.max ?? DEFAULT_MAX,
    opts.windowMs ?? DEFAULT_WINDOW_MS,
  )
}
