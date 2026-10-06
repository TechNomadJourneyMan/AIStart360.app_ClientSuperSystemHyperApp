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
  }
}

/** Delete up to `limit` expired counter rows. Returns the number deleted. */
export async function prunePostgres(limit = 10_000): Promise<number> {
  const prisma = await getPrisma()
  const rows = await prisma.$queryRaw<{ deleted: number }[]>`
    SELECT public.rate_limit_prune(${limit}::int) AS deleted`
  return Number(rows[0]?.deleted ?? 0)
}
