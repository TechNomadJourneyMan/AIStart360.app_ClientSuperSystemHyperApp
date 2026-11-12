/**
 * lib/runtime/prisma-url.ts — the Prisma connection URL on a persistent server.
 *
 * On Vercel each function instance holds its own small pool (DATABASE_URL carries connection_limit=1
 * for the Supabase pooler). A long-lived Railway process serves every request through one client, so
 * one connection would queue them all: there the limit comes from PRISMA_CONNECTION_LIMIT (an integer
 * 1..50, default 5) instead. Everything else in the URL is kept byte for byte (pgbouncer=true and the
 * rest). Elsewhere nothing is overridden. The URL is never logged.
 *
 * PRISMA_DATASOURCE=direct makes the persistent server use DIRECT_URL, the pooler in session mode: a
 * long-lived pool keeps its connections there, so a query costs one network round trip instead of the
 * several of transaction mode. Measured from Railway (ams) to Supabase (eu-west-1): SELECT 1 took
 * 16 ms over DIRECT_URL and 92 ms over DATABASE_URL.
 */
import { isPersistentServer } from '@/lib/runtime/platform'

// Partial, like lib/runtime/platform.ts: Next's typings make NODE_ENV mandatory in ProcessEnv.
type Env = Partial<NodeJS.ProcessEnv>

export const DEFAULT_PRISMA_CONNECTION_LIMIT = 5
const MAX_PRISMA_CONNECTION_LIMIT = 50

/** PRISMA_CONNECTION_LIMIT as a pool size: an integer 1..50, anything else is the default. */
export function prismaConnectionLimit(raw: string | undefined): number {
  const text = raw?.trim() ?? ''
  if (!/^\d+$/.test(text)) return DEFAULT_PRISMA_CONNECTION_LIMIT
  const limit = Number(text)
  return limit >= 1 && limit <= MAX_PRISMA_CONNECTION_LIMIT ? limit : DEFAULT_PRISMA_CONNECTION_LIMIT
}

/**
 * `url` with connection_limit=`limit`: every existing connection_limit is dropped and the new one
 * appended. Plain string work on the query, so the other params are not re-encoded.
 */
export function withConnectionLimit(url: string, limit: number): string {
  const queryAt = url.indexOf('?')
  const base = queryAt === -1 ? url : url.slice(0, queryAt)
  const params = queryAt === -1 ? [] : url.slice(queryAt + 1).split('&')
  const kept = params.filter((param) => param !== '' && param.split('=')[0] !== 'connection_limit')
  return `${base}?${[...kept, `connection_limit=${limit}`].join('&')}`
}

/** The datasource URL for PrismaClient on a persistent server; undefined (no override) anywhere else. */
export function persistentPrismaDatasourceUrl(env: Env = process.env): string | undefined {
  if (!isPersistentServer(env)) return undefined
  const direct = env.PRISMA_DATASOURCE?.trim() === 'direct' ? env.DIRECT_URL?.trim() : undefined
  const url = direct || env.DATABASE_URL?.trim()
  if (!url) return undefined
  return withConnectionLimit(url, prismaConnectionLimit(env.PRISMA_CONNECTION_LIMIT))
}

/**
 * Local development only (`next dev`, NODE_ENV=development): PRISMA_DATASOURCE=direct switches the
 * client to DIRECT_URL, the session pooler, as on a persistent server. Over the transaction pooler
 * every query is wrapped in BEGIN / DEALLOCATE ALL / COMMIT — four round trips; from a laptop far
 * from the database (~140 ms each) that alone made a page with a dozen queries take seconds. Off by
 * default; a persistent server keeps persistentPrismaDatasourceUrl. The URL is never logged.
 */
export function localDevPrismaDatasourceUrl(env: Env = process.env): string | undefined {
  if (env.NODE_ENV !== 'development' || isPersistentServer(env)) return undefined
  if (env.PRISMA_DATASOURCE?.trim() !== 'direct') return undefined
  const url = env.DIRECT_URL?.trim()
  if (!url) return undefined
  return withConnectionLimit(url, prismaConnectionLimit(env.PRISMA_CONNECTION_LIMIT))
}
