-- 098_agents_runtime_fixes.sql
--
-- 1. ai_budget_reservations — in-flight model spend of the agent runtime.
--    Before an agent's LLM call the runtime reserves the call's worst-case
--    cost under one advisory lock (lib/agents/store.ts reserveBudget), checking
--    the agent / company / platform daily budgets against spent + reserved.
--    After the call the reservation is deleted and the real cost is added to
--    agent_runs.cost_usd in the same statement. Parallel runs therefore see
--    each other's calls, and a run that is killed mid-call (maxDuration, lost
--    lease) leaves its reservation counted for the rest of the UTC day instead
--    of spending invisibly. Rows older than two days are purged on reserve.
--
-- 2. platform_events.dispatch_attempts — a failed dispatch is no longer marked
--    dispatched; redispatchPending retries it with exponential backoff
--    (lib/events/platform.ts), at most PLATFORM_EVENT_MAX_ATTEMPTS times.
--
-- Written by the server only (owner role); no tenant access.
--
-- Idempotent. Apply: node scripts/apply-migration.js supabase/migrations/098_agents_runtime_fixes.sql

CREATE TABLE IF NOT EXISTS public.ai_budget_reservations (
  id          BIGINT        GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  run_id      UUID          REFERENCES public.agent_runs(id) ON DELETE SET NULL,
  agent_key   TEXT          NOT NULL,
  company_id  TEXT,
  amount_usd  NUMERIC(12,6) NOT NULL CHECK (amount_usd >= 0),
  created_at  TIMESTAMPTZ   NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.ai_budget_reservations IS
  'Worst-case cost of agent LLM calls in flight (098); counted in today''s spend until settled.';

CREATE INDEX IF NOT EXISTS ai_budget_reservations_created_idx ON public.ai_budget_reservations (created_at);

ALTER TABLE public.ai_budget_reservations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ai_budget_reservations FROM anon, authenticated;

ALTER TABLE public.platform_events ADD COLUMN IF NOT EXISTS dispatch_attempts SMALLINT NOT NULL DEFAULT 0;

NOTIFY pgrst, 'reload schema';
