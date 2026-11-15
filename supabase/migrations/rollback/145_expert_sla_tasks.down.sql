-- 145_expert_sla_tasks.down.sql — ROLLBACK of migration 145 (R2-B, expert SLA).
--
-- NOT part of the migration sequence (scripts/test-db/setup.mjs and go-live
-- checks read only supabase/migrations/*.sql, not sub-folders).
-- Drops the SLA ledger, its functions and the clock-start setting. The source
-- data (expert_cases, report_versions, pb_recommendations, pb_plan_versions,
-- user_assignments written by the auto-assignment) is NOT touched: assignments
-- made by the mechanism stay — review them in GIGA «Эксперты» / user cards.
-- Roll the app back first (or switch the setting expert_sla.enabled off):
-- after this file the SLA cron finds no functions and logs an error each run;
-- the GIGA / expert queue pages answer 503.
--   node scripts/apply-migration.js supabase/migrations/rollback/145_expert_sla_tasks.down.sql

SET LOCAL lock_timeout = '5s';

DROP FUNCTION IF EXISTS public.expert_sla_claim(text, timestamptz, int);
DROP FUNCTION IF EXISTS public.expert_sla_sync(timestamptz, int, int, int);
DROP FUNCTION IF EXISTS public.expert_sla_is_worker(uuid);
DROP TABLE IF EXISTS public.expert_sla_tasks;
DELETE FROM public.system_settings WHERE key = 'expert_sla_clock_start';

NOTIFY pgrst, 'reload schema';
