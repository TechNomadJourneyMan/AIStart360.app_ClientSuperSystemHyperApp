-- 093_ai_usage_ledger.sql
--
-- Spend of model calls made OUTSIDE the agent runtime (the older features
-- that call OpenRouter directly through lib/ai/openrouter.ts: point A
-- narrative, insights, market analysis, pulse briefings, GRI strategy, …).
-- Agent calls are already accounted on agent_runs (086). Together they form
-- the platform's daily AI spend that AGENT_PLATFORM_DAILY_BUDGET_USD caps:
-- once it is reached, neither agents nor these features call a model.
--
-- Written by the server only; staff read it through the admin API.
--
-- Idempotent. Apply: node scripts/apply-migration.js supabase/migrations/093_ai_usage_ledger.sql

CREATE TABLE IF NOT EXISTS public.ai_usage_ledger (
  id           BIGINT       GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  source       TEXT         NOT NULL CHECK (length(source) BETWEEN 1 AND 120),  -- 'feature:<label>'
  model        TEXT,
  tokens_in    INTEGER      NOT NULL DEFAULT 0,
  tokens_out   INTEGER      NOT NULL DEFAULT 0,
  cost_usd     NUMERIC(12,6) NOT NULL DEFAULT 0 CHECK (cost_usd >= 0),
  cost_source  TEXT         NOT NULL DEFAULT 'provider' CHECK (cost_source IN ('provider', 'estimate')),
  company_id   TEXT         REFERENCES public.companies(id) ON DELETE SET NULL,
  ok           BOOLEAN      NOT NULL DEFAULT TRUE,
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.ai_usage_ledger IS
  'Model spend of non-agent features (093); with agent_runs.cost_usd it is the platform AI spend.';

CREATE INDEX IF NOT EXISTS ai_usage_ledger_created_idx ON public.ai_usage_ledger (created_at DESC);
CREATE INDEX IF NOT EXISTS ai_usage_ledger_company_idx ON public.ai_usage_ledger (company_id, created_at DESC)
  WHERE company_id IS NOT NULL;

ALTER TABLE public.ai_usage_ledger ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ai_usage_ledger FROM anon, authenticated;

NOTIFY pgrst, 'reload schema';
