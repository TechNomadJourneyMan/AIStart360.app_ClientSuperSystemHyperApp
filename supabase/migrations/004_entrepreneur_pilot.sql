-- =============================================================================
-- AIStart360 Entrepreneur Pilot
-- Durable onboarding, approval queue, and AI diagnostic narrative state.
-- Additive migration: does not remove or rewrite existing business data.
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- The live project already contains a legacy Prisma-shaped companies table.
-- Keep its text primary key and add only the onboarding fields that are absent.
ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS employee_count INTEGER,
  ADD COLUMN IF NOT EXISTS founded_at DATE,
  ADD COLUMN IF NOT EXISTS regions TEXT[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS contact_position TEXT,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

DROP TRIGGER IF EXISTS companies_onboarding_updated_at ON public.companies;
CREATE TRIGGER companies_onboarding_updated_at
  BEFORE UPDATE ON public.companies
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- A Supabase-native approval queue for the entrepreneur onboarding flow.
-- This intentionally avoids the legacy Prisma admin_requests/companies contour,
-- whose schema is not compatible with the onboarding companies table.
CREATE TABLE IF NOT EXISTS public.approval_requests (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  company_id        TEXT        REFERENCES public.companies(id) ON DELETE SET NULL,
  request_type      TEXT        NOT NULL DEFAULT 'registration'
                                CHECK (request_type IN ('registration', 'access', 'support')),
  status            TEXT        NOT NULL DEFAULT 'pending'
                                CHECK (status IN ('pending', 'in_review', 'approved', 'rejected', 'archived')),
  priority          TEXT        NOT NULL DEFAULT 'medium'
                                CHECK (priority IN ('low', 'medium', 'high', 'critical')),
  source            TEXT        NOT NULL DEFAULT 'client_portal',
  payload           JSONB       NOT NULL DEFAULT '{}'::jsonb,
  rejection_reason  TEXT,
  reviewed_by       UUID        REFERENCES public.profiles(id) ON DELETE SET NULL,
  reviewed_at       TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (request_type, user_id)
);

CREATE INDEX IF NOT EXISTS approval_requests_status_created_idx
  ON public.approval_requests(status, created_at DESC);

DROP TRIGGER IF EXISTS approval_requests_updated_at ON public.approval_requests;
CREATE TRIGGER approval_requests_updated_at
  BEFORE UPDATE ON public.approval_requests
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Draft progress is separate from finalized survey_answers. Partial autosaves
-- must not make a step look completed.
CREATE TABLE IF NOT EXISTS public.onboarding_progress (
  user_id           UUID        PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  company_id        TEXT        REFERENCES public.companies(id) ON DELETE SET NULL,
  current_step      INTEGER     NOT NULL DEFAULT 1 CHECK (current_step BETWEEN 1 AND 6),
  completed_steps   INTEGER[]   NOT NULL DEFAULT '{}',
  draft_answers     JSONB       NOT NULL DEFAULT '{}'::jsonb,
  version           INTEGER     NOT NULL DEFAULT 1,
  completed_at      TIMESTAMPTZ,
  saved_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS onboarding_progress_updated_at ON public.onboarding_progress;
CREATE TRIGGER onboarding_progress_updated_at
  BEFORE UPDATE ON public.onboarding_progress
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.diagnostics
  ADD COLUMN IF NOT EXISTS ai_status TEXT,
  ADD COLUMN IF NOT EXISTS ai_analysis JSONB,
  ADD COLUMN IF NOT EXISTS ai_model TEXT,
  ADD COLUMN IF NOT EXISTS ai_generated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS ai_error TEXT;

-- Normalize two statuses used by the earlier experimental AI contour.
UPDATE public.diagnostics SET ai_status = 'not_requested'
  WHERE ai_status IS NULL OR ai_status = 'none';
UPDATE public.diagnostics SET ai_status = 'error'
  WHERE ai_status = 'failed';

ALTER TABLE public.diagnostics
  ALTER COLUMN ai_status SET DEFAULT 'not_requested',
  ALTER COLUMN ai_status SET NOT NULL;

ALTER TABLE public.diagnostics
  DROP CONSTRAINT IF EXISTS diagnostics_ai_status_check;
ALTER TABLE public.diagnostics
  ADD CONSTRAINT diagnostics_ai_status_check
  CHECK (ai_status IN ('not_requested', 'pending', 'completed', 'fallback', 'error'));

ALTER TABLE public.approval_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.onboarding_progress ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "approval_requests_select_own" ON public.approval_requests;
CREATE POLICY "approval_requests_select_own" ON public.approval_requests
  FOR SELECT USING (user_id = auth.uid());

DROP POLICY IF EXISTS "onboarding_progress_select_own" ON public.onboarding_progress;
CREATE POLICY "onboarding_progress_select_own" ON public.onboarding_progress
  FOR SELECT USING (user_id = auth.uid());

DROP POLICY IF EXISTS "onboarding_progress_insert_own" ON public.onboarding_progress;
CREATE POLICY "onboarding_progress_insert_own" ON public.onboarding_progress
  FOR INSERT WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "onboarding_progress_update_own" ON public.onboarding_progress;
CREATE POLICY "onboarding_progress_update_own" ON public.onboarding_progress
  FOR UPDATE USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- The API routes use the service role for admin writes. Service-role clients
-- bypass RLS, so no public admin write policy is required.

CREATE OR REPLACE VIEW public.v_client_diagnostics AS
SELECT
  p.id          AS user_id,
  p.email,
  p.full_name,
  p.role,
  p.status      AS approval_status,
  c.id          AS company_id,
  c.name        AS company_name,
  c.industry,
  c.stage,
  d.id          AS diagnostic_id,
  d.overall_score,
  d.health_index,
  d.stage       AS diagnostic_stage,
  d.finance_score,
  d.sales_score,
  d.operations_score,
  d.marketing_score,
  d.strategy_score,
  d.risks,
  d.quick_wins,
  d.ai_status,
  d.ai_analysis,
  d.calculated_at
FROM public.profiles p
LEFT JOIN public.companies c
  ON c.user_id = p.id
LEFT JOIN public.diagnostics d
  ON d.user_id = p.id AND d.is_current = TRUE
WHERE p.role IN ('client', 'owner')
ORDER BY d.overall_score DESC NULLS LAST;

COMMENT ON TABLE public.approval_requests IS
  'Supabase-native queue for entrepreneur registration and access decisions.';
COMMENT ON TABLE public.onboarding_progress IS
  'Durable partial onboarding draft and completed-step state.';
