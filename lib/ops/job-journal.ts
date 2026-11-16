/**
 * lib/ops/job-journal.ts — the journal of job outcomes, public.ops_job_runs (migration 154).
 *
 * Written by the in-process scheduler after every call (lib/cron/runner.ts, wired in
 * lib/runtime/server-start.ts) and by the scheduled Inngest functions when a run ends
 * (lib/functions/ops-ping.ts). Read by the watchdog (lib/ops/job-watchdog.ts), /api/health
 * (lib/health/platform.ts) and the GIGA system card.
 *
 * Its own small pool, not Prisma:
 *   - the scheduler lives in instrumentation.ts, compiled apart from the routes; Prisma there would be
 *     a second client with a pool of its own (lib/db.ts keeps the client on globalThis only outside
 *     production);
 *   - a Prisma pool held by hung requests must not keep the journal from saying so.
 * One connection per process (shared through globalThis by the scheduler and the routes), closed
 * when idle, with a connect timeout and a query timeout, so a write never hangs a job. No server
 * settings in the startup packet (statement_timeout and the like): a transaction pooler in front of
 * the database may refuse unknown startup parameters. The database is the one Prisma of this process
 * uses (lib/runtime/prisma-url.ts), so the watchdog and /api/health read what was written.
 *
 * Best effort by design: a failed write is one log line and never reaches the job that was being
 * recorded; a missing table (migration 154 not applied) is said once per process.
 */
import { Pool } from 'pg'
import { maskConnectionSecrets } from '@/lib/runtime/mask-secrets'
import { portalRole, type PortalRole } from '@/lib/runtime/role'

type Env = Partial<NodeJS.ProcessEnv>

export type JobKind = 'cron' | 'inngest'
export type JobStatus = 'ok' | 'http_error' | 'error' | 'timeout' | 'claim_failed'

export interface JobOutcome {
  /** A cron path ('/api/cron/expert-sla') or 'inngest:<function id>'. */
  job: string
  kind: JobKind
  /** The minute the cron job was due (cron only). */
  scheduledFor?: Date | null
  startedAt: Date
  finishedAt?: Date
  durationMs?: number | null
  status: JobStatus
  httpStatus?: number | null
  /** Free text; cut to its first line and JOURNAL_ERROR_MAX characters here. */
  error?: string | null
}

export const JOURNAL_ERROR_MAX = 300
/** A write that takes longer is abandoned (the connection and statement timeouts end it too). */
const WRITE_TIMEOUT_MS = 8_000
const CONNECT_TIMEOUT_MS = 5_000
/** Client side: pg stops waiting for the answer (the server may still finish a one-row INSERT). */
const QUERY_TIMEOUT_MS = 6_000

/** The job id of an Inngest function in the journal. */
export const inngestJobName = (functionId: string): string => `inngest:${functionId}`

/** The first line of `error`, trimmed and cut to JOURNAL_ERROR_MAX characters; null when there is nothing. */
export function shortJobError(error: unknown): string | null {
  const text = error instanceof Error ? error.message : error == null ? '' : String(error)
  const line = text.split('\n')[0].trim()
  if (!line) return null
  return line.length > JOURNAL_ERROR_MAX ? `${line.slice(0, JOURNAL_ERROR_MAX - 1)}…` : line
}

/**
 * Where the journal is written: the database Prisma of this process uses — DIRECT_URL with
 * PRISMA_DATASOURCE=direct, else DATABASE_URL (the Prisma-only query parameters such as
 * pgbouncer=true or connection_limit are ignored by pg).
 */
export function journalConnectionString(env: Env = process.env): string | undefined {
  const direct = env.PRISMA_DATASOURCE?.trim() === 'direct' ? env.DIRECT_URL?.trim() : undefined
  return direct || env.DATABASE_URL?.trim() || undefined
}

export type JournalQuery = (sql: string, params: unknown[]) => Promise<{ rows: unknown[] }>

const POOL_KEY = Symbol.for('aistart360.ops.journal.pool')
const WARNED_KEY = Symbol.for('aistart360.ops.journal.warned')
const shared = globalThis as Record<symbol, unknown>

function sharedPool(connectionString: string, log: (line: string) => void): Pick<Pool, 'query'> {
  const existing = shared[POOL_KEY] as { pool: Pool; url: string } | undefined
  if (existing && existing.url === connectionString) return existing.pool
  const pool = new Pool({
    connectionString,
    max: 1,
    connectionTimeoutMillis: CONNECT_TIMEOUT_MS,
    idleTimeoutMillis: 10_000,
    allowExitOnIdle: true,
    query_timeout: QUERY_TIMEOUT_MS,
    application_name: 'aistart360-ops-journal',
  })
  // An idle client dropped by the server emits 'error' on the pool; unhandled, that kills the process.
  pool.on('error', (error: unknown) => {
    try {
      log(`ops: journal pool error: ${maskConnectionSecrets(error instanceof Error ? error.message : String(error), connectionString)}`)
    } catch {
      // a broken logger must not turn a pool error into an uncaught one
    }
  })
  shared[POOL_KEY] = { pool, url: connectionString }
  return pool
}

/** A query on the journal's own pool (also used by the watchdog for the cron_runs retention reads). */
export function journalQuery(env: Env = process.env, log: (line: string) => void = (l) => console.error(l)): JournalQuery | null {
  const url = journalConnectionString(env)
  if (!url) return null
  return async (sql, params) => {
    const pool = sharedPool(url, log)
    const res = await pool.query(sql, params as unknown[])
    return { rows: res.rows }
  }
}

function warnOnce(key: string, line: string, log: (line: string) => void): void {
  const warned = (shared[WARNED_KEY] ??= new Set<string>()) as Set<string>
  if (warned.has(key)) return
  warned.add(key)
  try {
    log(line)
  } catch {
    // ignore
  }
}

const isMissingTable = (error: unknown): boolean => {
  const err = error as { code?: unknown; message?: unknown } | null
  return err?.code === '42P01' || (typeof err?.message === 'string' && /ops_job_runs/.test(err.message) && /does not exist/.test(err.message))
}

const INSERT = `INSERT INTO public.ops_job_runs
  (job, kind, service, scheduled_for, started_at, finished_at, duration_ms, status, http_status, error)
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`

export interface RecordDeps {
  query?: JournalQuery | null
  env?: Env
  role?: PortalRole
  log?: (line: string) => void
}

/**
 * Writes one outcome. Resolves true when the row is in, false otherwise; never rejects and never
 * takes longer than WRITE_TIMEOUT_MS.
 */
export async function recordJobRun(outcome: JobOutcome, deps: RecordDeps = {}): Promise<boolean> {
  const log = deps.log ?? ((line: string) => console.error(line))
  const env = deps.env ?? process.env
  const url = journalConnectionString(env)
  const query = deps.query !== undefined ? deps.query : journalQuery(env, log)
  if (!query) {
    warnOnce('no_url', 'ops: DATABASE_URL не задан — журнал исходов задач (ops_job_runs) не пишется', log)
    return false
  }
  const finishedAt = outcome.finishedAt ?? new Date()
  const duration = outcome.durationMs ?? Math.max(0, finishedAt.getTime() - outcome.startedAt.getTime())
  const params = [
    outcome.job.slice(0, 200),
    outcome.kind,
    deps.role ?? portalRole(env),
    outcome.scheduledFor ? outcome.scheduledFor.toISOString() : null,
    outcome.startedAt.toISOString(),
    finishedAt.toISOString(),
    Number.isFinite(duration) ? Math.max(0, Math.round(duration)) : null,
    outcome.status,
    outcome.httpStatus && outcome.httpStatus >= 100 && outcome.httpStatus <= 599 ? outcome.httpStatus : null,
    shortJobError(outcome.error),
  ]
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([
      query(INSERT, params),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`journal write took longer than ${WRITE_TIMEOUT_MS} ms`)), WRITE_TIMEOUT_MS)
        ;(timer as { unref?: () => void }).unref?.()
      }),
    ])
    return true
  } catch (error) {
    if (isMissingTable(error)) {
      warnOnce('no_table', 'ops: таблицы ops_job_runs нет (миграция 154 не применена) — журнал исходов задач не пишется', log)
    } else {
      try {
        log(`ops: запись в журнал задач не удалась (${outcome.job}): ${maskConnectionSecrets(error instanceof Error ? error.message : String(error), url)}`)
      } catch {
        // ignore
      }
    }
    return false
  } finally {
    clearTimeout(timer)
  }
}
