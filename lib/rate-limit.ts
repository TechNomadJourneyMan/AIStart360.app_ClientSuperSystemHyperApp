import { Ratelimit } from '@upstash/ratelimit'
import { Redis } from '@upstash/redis'

// 10 запросов в минуту на auth endpoints
export const authRateLimit = new Ratelimit({
  redis: Redis.fromEnv(),
  limiter: Ratelimit.slidingWindow(10, '1m'),
  analytics: true,
})
