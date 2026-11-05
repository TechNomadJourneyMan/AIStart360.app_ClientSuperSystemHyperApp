/**
 * lib/cron/claim.ts — the cross-instance claim for the in-process scheduler (lib/cron/runner.ts).
 *
 * A redeploy on a persistent server overlaps: the new instance is up while the old one is still
 * draining, and both run the same ticker. Each (path, minute) is a row in `cron_runs`; the instance
 * whose INSERT lands owns the run, the others see the conflict and skip it. No lock to hold and
 * nothing to clean up if an instance dies mid-run: the minute is simply spent.
 */
import { Pool } from 'pg'
import { maskConnectionSecrets } from '@/lib/runtime/mask-secrets'
import { CREATE_CRON_RUNS_TABLE } from './cron-runs-table.mjs'

/** An unreachable host fails the claim (and the runner skips that job) instead of hanging the tick. */
const CONNECT_TIMEOUT_MS = 10_000

const CLAIM = 'INSERT INTO cron_runs (path, minute) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING 1'

/**
 * Builds the claim function for `startCronRunner({ claim })`. Nothing connects until the first claim:
 * the pool is created and the table ensured on first use (once, even if claims race). A failed
 * claim rejects, and the runner then skips the job rather than fire it unclaimed.
 */
export function createPgCronClaim(
  connectionString: string,
  deps: { pool?: Pick<Pool, 'query'>; log?: (line: string) => void } = {},
): (path: string, minute: Date) => Promise<boolean> {
  let pool = deps.pool
  let ready: Promise<void> | undefined

  const poolOf = (): Pick<Pool, 'query'> => {
    if (!pool) {
      const own = new Pool({
        connectionString,
        max: 2,
        connectionTimeoutMillis: CONNECT_TIMEOUT_MS,
        application_name: 'aistart360-cron-claim',
      })
      // An idle client dropped by the server emits 'error' on the pool; unhandled, that kills the process.
      // The pool recovers by itself on the next query, so it is only worth a line in the log.
      own.on('error', (error: unknown) => {
        try {
          const code = (error as { code?: unknown } | null)?.code
          // The message can echo the connection string (or its user and password); none of it may reach the log.
          const message = error instanceof Error ? error.message : String(error)
          ;(deps.log ?? console.error)(`cron: claim pool error: ${typeof code === 'string' ? `${code} ` : ''}${maskConnectionSecrets(message, connectionString)}`)
        } catch {
          // a broken logger must not turn a pool error into an uncaught one
        }
      })
      pool = own
    }
    return pool
  }

  const ensureTable = (): Promise<void> => {
    if (!ready) {
      ready = poolOf().query(CREATE_CRON_RUNS_TABLE).then(() => undefined)
      // A failed attempt is not remembered, so the next claim tries again.
      ready.catch(() => { ready = undefined })
    }
    return ready
  }

  return async (path, minute) => {
    await ensureTable()
    // ISO string: the stored minute does not depend on the time zone of this process.
    const result = await poolOf().query(CLAIM, [path, minute.toISOString()])
    return result.rows.length > 0
  }
}
