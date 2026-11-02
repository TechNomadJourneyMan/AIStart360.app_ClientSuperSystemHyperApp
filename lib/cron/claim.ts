/**
 * lib/cron/claim.ts — the cross-instance claim for the in-process scheduler (lib/cron/runner.ts).
 *
 * A redeploy on a persistent server overlaps: the new instance is up while the old one is still
 * draining, and both run the same ticker. Each (path, minute) is a row in `cron_runs`; the instance
 * whose INSERT lands owns the run, the others see the conflict and skip it. No lock to hold and
 * nothing to clean up if an instance dies mid-run: the minute is simply spent.
 */
import { Pool } from 'pg'

const CREATE_TABLE = `CREATE TABLE IF NOT EXISTS cron_runs (
  path text NOT NULL,
  minute timestamptz NOT NULL,
  claimed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (path, minute)
)`

const CLAIM = 'INSERT INTO cron_runs (path, minute) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING 1'

/**
 * Builds the claim function for `startCronRunner({ claim })`. Nothing connects until the first claim:
 * the pool is created and the table ensured on first use (once, even if claims race). A failed
 * claim rejects, and the runner then skips the job rather than fire it unclaimed.
 */
export function createPgCronClaim(
  connectionString: string,
  deps: { pool?: Pick<Pool, 'query'> } = {},
): (path: string, minute: Date) => Promise<boolean> {
  let pool = deps.pool
  let ready: Promise<void> | undefined

  const poolOf = (): Pick<Pool, 'query'> => {
    if (!pool) {
      const own = new Pool({ connectionString, max: 2, application_name: 'aistart360-cron-claim' })
      // An idle client dropped by the server emits 'error' on the pool; unhandled, that kills the process.
      own.on('error', () => {})
      pool = own
    }
    return pool
  }

  const ensureTable = (): Promise<void> => {
    if (!ready) {
      ready = poolOf().query(CREATE_TABLE).then(() => undefined)
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
