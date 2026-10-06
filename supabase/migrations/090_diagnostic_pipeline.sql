-- 090_diagnostic_pipeline.sql
--
-- State of the multi-agent diagnostic pipeline on diagnostic_sessions (085):
--   stage            the stage currently running (agent key) or NULL
--   stages           per-stage record {status, task_id, summary, started_at,
--                    finished_at, ...} written by the stage agents
--   rerun_requested  new input arrived while the session was in flight; the
--                    orchestrator starts a fresh pass after finalising if the
--                    inputs really changed after started_at
--   orchestrator_task_id  the agent task that opened the session
--
-- Stages and their order live in code (lib/diagnostics/pipeline.ts).
-- Written by the service role only (085 revoked writes from API roles).
--
-- Idempotent. Apply: node scripts/apply-migration.js supabase/migrations/090_diagnostic_pipeline.sql

ALTER TABLE public.diagnostic_sessions
  ADD COLUMN IF NOT EXISTS stage                TEXT,
  ADD COLUMN IF NOT EXISTS stages               JSONB   NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS rerun_requested      BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS orchestrator_task_id UUID    REFERENCES public.agent_tasks(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.diagnostic_sessions.stages IS
  'Per-stage pipeline record keyed by agent key: {status: running|done|skipped|failed, task_id, summary, ...} (090).';

-- Sweeps look for in-flight sessions by age.
CREATE INDEX IF NOT EXISTS diagnostic_sessions_inflight_idx
  ON public.diagnostic_sessions (updated_at)
  WHERE status IN ('collecting', 'processing');

-- Supersede lookups by producer (findings / recommendations of one agent).
CREATE INDEX IF NOT EXISTS diagnostic_findings_producer_idx
  ON public.diagnostic_findings (company_id, produced_by) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS diagnostic_recommendations_producer_idx
  ON public.diagnostic_recommendations (company_id, produced_by) WHERE status = 'proposed';

NOTIFY pgrst, 'reload schema';
