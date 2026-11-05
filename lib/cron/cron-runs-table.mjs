/**
 * lib/cron/cron-runs-table.mjs — the table behind the scheduler's cross-instance claim
 * (lib/cron/claim.ts). Plain JavaScript so that both the Next server and Railway's pre-deploy
 * step (scripts/railway/predeploy.mjs, run by bare node) use the one statement.
 */

/** Idempotent: one row per (path, minute) an instance has claimed. */
export const CREATE_CRON_RUNS_TABLE = `CREATE TABLE IF NOT EXISTS cron_runs (
  path text NOT NULL,
  minute timestamptz NOT NULL,
  claimed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (path, minute)
)`
