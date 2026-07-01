import { Ratelimit } from '@upstash/ratelimit'
import { Redis } from '@upstash/redis'

const upstashEnabled = Boolean(
  process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN,
)
const redis = upstashEnabled ? Redis.fromEnv() : null

// 10 запросов в минуту — дефолтный лимитер для auth endpoints (back-compat export).
export const authRateLimit = redis
  ? new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(10, '1m'), analytics: true })
  : null

// Кэш лимитеров по (max, windowMs), чтобы per-bucket opts реально соблюдались, а
// не подменялись общим 10/мин. Раньше ветка Upstash всегда брала authRateLimit и
// игнорировала opts.max — «дорогой AI = 3/мин» молча превращался в 10/мин.
const limiterCache = new Map<string, Ratelimit>()
function getUpstashLimiter(max: number, windowMs: number): Ratelimit | null {
  if (!redis) return null
  const key = `${max}:${windowMs}`
  let rl = limiterCache.get(key)
  if (!rl) {
    const windowSec = Math.max(1, Math.round(windowMs / 1000))
    rl = new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(max, `${windowSec} s` as Parameters<typeof Ratelimit.slidingWindow>[1]),
      analytics: true,
    })
    limiterCache.set(key, rl)
  }
  return rl
}

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
  const max = opts.max ?? DEFAULT_MAX
  const windowMs = opts.windowMs ?? DEFAULT_WINDOW_MS
  const limiter = getUpstashLimiter(max, windowMs)
  if (limiter) {
    const { success } = await limiter.limit(`${bucket}:${ip}`)
    return !success
  }
  return memoryLimited(`${bucket}:${ip}`, max, windowMs)
}
