-- =============================================================================
-- AIStart360 — Migration 032: Smart Assistant
--
-- Backing storage for the smart assistant:
--
--   * public.expert_cases   — escalation cases routed to staff (expert/admin).
--                             Opened when the assistant detects a validation
--                             issue, a critical risk, incomplete data, or when
--                             the client explicitly requests human help. The
--                             internal adapter inserts via service-role and so
--                             bypasses RLS; client/staff reads go through RLS.
--
--   * public.assistant_runs — snapshot cache + audit of each assistant compute.
--                             Stores the curated completion/issue snapshot and
--                             the optional LLM analysis (nullable — null when no
--                             key or insufficient data). One row per compute,
--                             with at most one is_current=true per user
--                             (enforced in the app, like point_b_analysis).
--
-- Idempotent — safe to re-run. RLS mirrors migration 024 (point_a_insights):
-- owners see/insert own rows, staff (super_admin/admin/manager/analyst/expert)
-- see/update all. Both tables join supabase_realtime + REPLICA IDENTITY FULL so
-- the hint widget and chat can subscribe. updated_at reuses public.set_updated_at().
-- =============================================================================

-- =============================================================================
-- 1. expert_cases
-- =============================================================================

-- 1.1 Table ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.expert_cases (
  id                         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                    UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- public.companies.id is TEXT (Prisma-owned); match its type for the FK.
  company_id                 TEXT        REFERENCES public.companies(id) ON DELETE SET NULL,
  diagnostic_id              UUID        REFERENCES public.diagnostics(id) ON DELETE SET NULL,

  status                     TEXT        NOT NULL DEFAULT 'new'
                              CHECK (status IN ('new', 'in_progress', 'resolved', 'closed')),
  priority                   TEXT        NOT NULL DEFAULT 'medium'
                              CHECK (priority IN ('low', 'medium', 'high', 'critical')),
  trigger_type               TEXT        NOT NULL
                              CHECK (trigger_type IN (
                                'user_requested_help',
                                'validation_issue',
                                'llm_recommendation',
                                'critical_risk',
                                'incomplete_data',
                                'manual'
                              )),

  title                      TEXT        NOT NULL,
  summary                    TEXT,
  detected_issues            JSONB       NOT NULL DEFAULT '[]'::jsonb,
  user_message               TEXT,
  assistant_recommendation   TEXT,
  expert_action_recommended  TEXT,

  assigned_to                UUID        REFERENCES public.profiles(id) ON DELETE SET NULL,

  created_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.expert_cases IS
  'Escalation cases routed to staff by the smart assistant (user-requested help, validation issue, LLM recommendation, critical risk, incomplete data, or manual). Internal adapter inserts via service-role and bypasses RLS.';

-- 1.2 Indexes ----------------------------------------------------------------
CREATE INDEX IF NOT EXISTS expert_cases_user_created_idx
  ON public.expert_cases (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS expert_cases_status_idx
  ON public.expert_cases (status);

CREATE INDEX IF NOT EXISTS expert_cases_priority_idx
  ON public.expert_cases (priority);

CREATE INDEX IF NOT EXISTS expert_cases_company_idx
  ON public.expert_cases (company_id);

-- 1.3 updated_at trigger -----------------------------------------------------
-- Reuse public.set_updated_at() from migration 001.
DROP TRIGGER IF EXISTS expert_cases_updated_at ON public.expert_cases;
CREATE TRIGGER expert_cases_updated_at
  BEFORE UPDATE ON public.expert_cases
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 1.4 RLS --------------------------------------------------------------------
ALTER TABLE public.expert_cases ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS expert_cases_select_own   ON public.expert_cases;
DROP POLICY IF EXISTS expert_cases_select_admin ON public.expert_cases;
DROP POLICY IF EXISTS expert_cases_insert_own   ON public.expert_cases;
DROP POLICY IF EXISTS expert_cases_update_admin ON public.expert_cases;

-- Owner can read own cases
CREATE POLICY expert_cases_select_own ON public.expert_cases
  FOR SELECT USING (user_id = auth.uid());

-- Staff (super_admin/admin/manager/analyst/expert) can read all cases
CREATE POLICY expert_cases_select_admin ON public.expert_cases
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid()
        AND role IN ('super_admin', 'admin', 'manager', 'analyst', 'expert')
    )
  );

-- Owner can open own cases (user-requested help). Internal adapter uses
-- service-role and bypasses RLS for the detector-driven triggers.
CREATE POLICY expert_cases_insert_own ON public.expert_cases
  FOR INSERT WITH CHECK (user_id = auth.uid());

-- Staff can update any case (triage, assign, resolve)
CREATE POLICY expert_cases_update_admin ON public.expert_cases
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid()
        AND role IN ('super_admin', 'admin', 'manager', 'analyst', 'expert')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid()
        AND role IN ('super_admin', 'admin', 'manager', 'analyst', 'expert')
    )
  );

-- 1.5 Realtime publication ---------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'expert_cases'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.expert_cases;
  END IF;
END
$$;

ALTER TABLE public.expert_cases REPLICA IDENTITY FULL;

-- =============================================================================
-- 2. assistant_runs
-- =============================================================================

-- 2.1 Table ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.assistant_runs (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  diagnostic_id  UUID        REFERENCES public.diagnostics(id) ON DELETE SET NULL,

  overall_pct    INT         NOT NULL DEFAULT 0,
  status         TEXT        NOT NULL,
  completion     JSONB       NOT NULL DEFAULT '{}'::jsonb,
  issues         JSONB       NOT NULL DEFAULT '[]'::jsonb,
  -- nullable; null when no key / insufficient data
  llm_analysis   JSONB,
  llm_status     TEXT        NOT NULL DEFAULT 'none'
                  CHECK (llm_status IN ('none', 'processing', 'completed', 'failed', 'insufficient_data')),
  is_current     BOOLEAN     NOT NULL DEFAULT true,

  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.assistant_runs IS
  'Snapshot cache + audit of each smart-assistant compute (curated completion/issues snapshot + optional LLM analysis). At most one is_current=true per user, enforced in the app like point_b_analysis.';

-- 2.2 Indexes ----------------------------------------------------------------
CREATE INDEX IF NOT EXISTS assistant_runs_user_created_idx
  ON public.assistant_runs (user_id, created_at DESC);

-- 2.3 RLS --------------------------------------------------------------------
ALTER TABLE public.assistant_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS assistant_runs_select_own   ON public.assistant_runs;
DROP POLICY IF EXISTS assistant_runs_select_admin ON public.assistant_runs;
DROP POLICY IF EXISTS assistant_runs_insert_own   ON public.assistant_runs;
DROP POLICY IF EXISTS assistant_runs_update_own   ON public.assistant_runs;

-- Owner can read own runs
CREATE POLICY assistant_runs_select_own ON public.assistant_runs
  FOR SELECT USING (user_id = auth.uid());

-- Staff (super_admin/admin/manager/analyst/expert) can read all runs
CREATE POLICY assistant_runs_select_admin ON public.assistant_runs
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid()
        AND role IN ('super_admin', 'admin', 'manager', 'analyst', 'expert')
    )
  );

-- Owner can insert own runs
CREATE POLICY assistant_runs_insert_own ON public.assistant_runs
  FOR INSERT WITH CHECK (user_id = auth.uid());

-- Owner can update own runs (e.g. flip is_current on a new compute)
CREATE POLICY assistant_runs_update_own ON public.assistant_runs
  FOR UPDATE USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- 2.4 Realtime publication ---------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'assistant_runs'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.assistant_runs;
  END IF;
END
$$;

ALTER TABLE public.assistant_runs REPLICA IDENTITY FULL;

-- =============================================================================
-- 3. PostgREST schema cache reload
-- =============================================================================
NOTIFY pgrst, 'reload schema';
