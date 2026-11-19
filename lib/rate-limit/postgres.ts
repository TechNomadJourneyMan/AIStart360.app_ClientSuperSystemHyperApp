/**
 * Postgres store — public.rate_limit_hit / rate_limit_prune (migration 100)
 * through Prisma's connection (server role; anon/authenticated cannot call
 * them). Shared by every serverless instance; one round trip per hit.
 */
import type { RateLimitStore, StoreDecision } from './types'

type Prisma = (typeof import('@/lib/db'))['prisma']

let prismaPromise: Promise<Prisma> | null = null
function getPrisma(): Promise<Prisma> {
  // Lazy: importing the limiter must not construct a PrismaClient (tests,
  // Upstash deployments).
  prismaPromise ??= import('@/lib/db').then((m) => m.prisma)
  return prismaPromise
}

interface HitRow {
  allowed: boolean
  remaining: number
  retry_after_seconds: number
}

export function createPostgresStore(): RateLimitStore {
  return {
    backend: 'postgres',
    async hit(key, windowSeconds, max): Promise<StoreDecision> {
      const prisma = await getPrisma()
      const rows = await prisma.$queryRaw<HitRow[]>`
        SELECT allowed, remaining, retry_after_seconds
          FROM public.rate_limit_hit(${key}::text, ${windowSeconds}::int, ${max}::int)`
      const row = rows[0]
      if (!row) throw new Error('rate_limit_hit returned no row')
      return {
        allowed: row.allowed === true,
        remaining: Number(row.remaining) || 0,
        retryAfterSeconds: Number(row.retry_after_seconds) || 0,
      }
    },
    async refund(key, windowSeconds): Promise<void> {
      const prisma = await getPrisma()
      // The latest window row of the key that still holds a hit (the one the reserved hit went
      // into, unless the window rolled over in between — then the newest one with a count).
      // The table owner's connection, like rate_limit_hit (100: no grants to API roles).
      await prisma.$executeRaw`
        UPDATE public.rate_limit_hits h
           SET count = h.count - 1
         WHERE (h.key, h.window_seconds, h.window_start) = (
                 SELECT r.key, r.window_seconds, r.window_start
                   FROM public.rate_limit_hits r
                  WHERE r.key = ${key}::text AND r.window_seconds = ${windowSeconds}::int AND r.count > 0
                  ORDER BY r.window_start DESC
                  LIMIT 1)
           AND h.count > 0`
    },
  }
}

/** Delete up to `limit` expired counter rows. Returns the number deleted. */
export async function prunePostgres(limit = 10_000): Promise<number> {
  const prisma = await getPrisma()
  const rows = await prisma.$queryRaw<{ deleted: number }[]>`
    SELECT public.rate_limit_prune(${limit}::int) AS deleted`
  return Number(rows[0]?.deleted ?? 0)
}
