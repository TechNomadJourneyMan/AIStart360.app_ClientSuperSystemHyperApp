/**
 * scripts/railway/ensure-cron-runs.mjs — the pre-deploy step after the queue bootstrap: creates the
 * scheduler's claim table `cron_runs` in the Workflow database (WORKFLOW_POSTGRES_URL), with the very
 * statement lib/cron/claim.ts runs on first use. Idempotent.
 *
 * Errors are printed by code (or name) only: a pg message can echo the connection string, its user
 * or its password, and a deploy log is not the place for any of them.
 */
import pg from 'pg'
import { CREATE_CRON_RUNS_TABLE } from '../../lib/cron/cron-runs-table.mjs'

/**
 * @param {string} connectionString
 * @param {{ Pool?: any, log?: (line: string) => void, error?: (line: string) => void }} [deps]
 * @returns {Promise<boolean>} true when the table is there
 */
export async function ensureCronRunsTable(connectionString, deps = {}) {
  const Pool = deps.Pool ?? pg.Pool
  const log = deps.log ?? console.log
  const error = deps.error ?? console.error
  const pool = new Pool({
    connectionString,
    max: 1,
    connectionTimeoutMillis: 10_000,
    application_name: 'aistart360-predeploy',
  })
  // An idle client dropped by the server emits 'error' on the pool; unhandled, it would end the step
  // with a stack trace that may carry the message. The query below reports the failure instead.
  pool.on('error', () => {})
  try {
    await pool.query(CREATE_CRON_RUNS_TABLE)
    log('predeploy: таблица cron_runs готова')
    return true
  } catch (e) {
    const code = /** @type {{ code?: unknown } | null} */ (e)?.code
    const what = typeof code === 'string' && code ? code : e instanceof Error ? e.name : 'неизвестная ошибка'
    error(`predeploy: таблица cron_runs не создана (${what})`)
    return false
  } finally {
    await pool.end().catch(() => {})
  }
}
