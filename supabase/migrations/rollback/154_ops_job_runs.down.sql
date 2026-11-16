-- 154_ops_job_runs.down.sql — ROLLBACK of migration 154 (R4-A1).
--
-- NOT part of the migration sequence (appliers read only supabase/migrations/*.sql).
-- Drops the journal of job outcomes and the table of job expectations. Their rows are operational
-- history only (when a cron or a scheduled Inngest function last ran and how it ended, since when
-- the watchdog expects it) — no client data.
-- The app may stay: without the tables the journal writes are skipped (one log line per process),
-- GET /api/cron/ops-watchdog answers 200 with journal = 'not_migrated' and runs its other checks,
-- /api/health reports the journal checks as unknown, never as a failure.
--   psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 -1 -f supabase/migrations/rollback/154_ops_job_runs.down.sql

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DROP TABLE IF EXISTS public.ops_job_expectations;
DROP TABLE IF EXISTS public.ops_job_runs;

NOTIFY pgrst, 'reload schema';
