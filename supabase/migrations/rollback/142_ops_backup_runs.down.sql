-- 142_ops_backup_runs.down.sql — ROLLBACK of migration 142 (R4-A4).
--
-- NOT part of the migration sequence (appliers read only supabase/migrations/*.sql).
-- Drops the journal of backups public.ops_backup_runs (its indexes go with it). Use it together with
-- docs/backup/README.md §5 «Откат на старый скрипт», never on its own while the new backup script runs:
--   • the rows are operational history only (when a backup ran, size, sha256, object key, error) —
--     no client data; the dumps and manifests in the bucket stay. To keep the history, first:
--       \copy (SELECT * FROM public.ops_backup_runs ORDER BY started_at) TO 'ops_backup_runs.csv' CSV HEADER
--   • the backup script (scripts/backup/railway-db-backup.sh) keeps working: its journal write is
--     best effort, a missing table only costs a line in its log;
--   • the watchdog GET /api/cron/backup-freshness answers 503 migration_142_required every hour and
--     wakes nobody — but the journal of job outcomes (154) records each such run as an error, so the
--     job watchdog (lib/ops/job-watchdog.ts) raises «последний запуск с ошибкой» for it, at most once
--     in 6 h per problem. To silence that too, take the job out of lib/cron/schedule.ts (README §5).
-- Idempotent: a second run is a no-op. 142 applies again on top (CREATE … IF NOT EXISTS) and starts
-- an empty journal.
-- The journal public.schema_migrations is NOT touched here — whoever rolls back records it
-- (docs/deploy/runbook.md §10).
--   psql "$TGT_URL" -X -v ON_ERROR_STOP=1 -1 -f supabase/migrations/rollback/142_ops_backup_runs.down.sql

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DROP TABLE IF EXISTS public.ops_backup_runs;

NOTIFY pgrst, 'reload schema';
