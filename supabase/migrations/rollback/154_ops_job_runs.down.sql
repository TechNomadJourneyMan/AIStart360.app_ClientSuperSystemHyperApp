-- 154_ops_job_runs.down.sql — ROLLBACK of migration 154 (R4-A1).
--
-- NOT part of the migration sequence (appliers read only supabase/migrations/*.sql).
-- Drops the journal of job outcomes. Its rows are operational history only (when a cron or a
-- scheduled Inngest function last ran and how it ended) — no client data.
-- The app may stay: without the table the journal writes are skipped (one log line per process),
-- the watchdog answers 503 «migration_154_required» and /api/health reports the journal check as
-- unknown, never as a failure.
--   psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 -1 -f supabase/migrations/rollback/154_ops_job_runs.down.sql

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DROP TABLE IF EXISTS public.ops_job_runs;

NOTIFY pgrst, 'reload schema';
