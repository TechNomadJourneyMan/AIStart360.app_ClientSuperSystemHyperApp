-- 108_agent_automation.sql
--
-- Agent automation and the agent notifier (lib/agents/automation.ts,
-- lifecycle.ts, digest.ts). The switches themselves are rows of
-- system_settings (040) with code defaults, so no seed is needed:
--   agents_notify_lifecycle  true   agents_auto_retry      true
--   agents_auto_diagnostic   true   agents_daily_digest    true
--   agents_stuck_alerts      true   agents_stuck_minutes   20
-- Dedupe of notifications uses notification_events.dedupe_key (087); the
-- «once per company per day» diagnostic uses agent_tasks.idempotency_key (086).
--
-- Schema here only serves the new hot queries:
--   agent_tasks_started_idx     «> 5 tasks started within 2 minutes» on every
--                               task start (anti-spam summary)
--   agent_runs_failed_day_idx   top errors of the last 24 h in the digest
--
-- Idempotent. Apply: node scripts/apply-migration.js supabase/migrations/108_agent_automation.sql

CREATE INDEX IF NOT EXISTS agent_tasks_started_idx
  ON public.agent_tasks (started_at DESC) WHERE started_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS agent_runs_failed_day_idx
  ON public.agent_runs (started_at DESC) WHERE status = 'failed';

COMMENT ON INDEX public.agent_tasks_started_idx IS
  'Recent task starts: burst detection of the agent notifier (108).';
