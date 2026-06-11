-- =============================================================================
-- AIStart360 — Migration 027: GRI Pulse (weekly pulse-survey)
--
-- "GRI Pulse" is a lightweight WEEKLY check-in: the owner re-scores each of the
-- 7 GRI blocks (1–10, one slider per block, ~2 min) so the platform tracks
-- growth-readiness dynamics BETWEEN full diagnostics (gri_assessments / 021).
--
-- One row per (user_id, week_start). Re-submitting the same week overwrites via
-- upsert. RLS scoped to owner + staff roles, mirroring migration 021.
-- Added to supabase_realtime publication like 016/022. Idempotent — safe re-run.
-- =============================================================================

-- 1. Table -------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.gri_pulse_responses (
  id           UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID         NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- Nullable; not FK-constrained (public.companies.id is TEXT/Prisma-owned).
  company_id   UUID,

  -- Monday (UTC) of the surveyed week.
  week_start   DATE         NOT NULL,

  -- scores shape: { [sectionId]: integer 1..10 } — keys are the 7 GRI section
  -- ids from lib/gri-assessment/sections.ts.
  scores       JSONB        NOT NULL,

  -- Mean of the 7 block scores, 1..10, 2 decimals (server-computed).
  pulse_index  NUMERIC(4,2) NOT NULL,

  note         TEXT,
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.gri_pulse_responses IS
  'Weekly GRI Pulse check-ins: one row per (user_id, week_start). Tracks growth-readiness dynamics between full GRI diagnostics.';
COMMENT ON COLUMN public.gri_pulse_responses.scores IS
  'JSONB: { [sectionId]: integer 1..10 } for the 7 GRI sections.';
COMMENT ON COLUMN public.gri_pulse_responses.pulse_index IS
  'Mean of the 7 block scores (1..10), 2 decimals.';
COMMENT ON COLUMN public.gri_pulse_responses.week_start IS
  'Monday (UTC) of the surveyed week.';

-- 2. Constraints & indexes ---------------------------------------------------
-- One pulse per user per week (target of the route-handler upsert).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'gri_pulse_responses_user_week_uniq'
  ) THEN
    ALTER TABLE public.gri_pulse_responses
      ADD CONSTRAINT gri_pulse_responses_user_week_uniq UNIQUE (user_id, week_start);
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS gri_pulse_responses_user_week_idx
  ON public.gri_pulse_responses(user_id, week_start DESC);

-- 3. RLS ---------------------------------------------------------------------
ALTER TABLE public.gri_pulse_responses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS gri_pulse_select_own   ON public.gri_pulse_responses;
DROP POLICY IF EXISTS gri_pulse_select_admin ON public.gri_pulse_responses;
DROP POLICY IF EXISTS gri_pulse_insert_own   ON public.gri_pulse_responses;
DROP POLICY IF EXISTS gri_pulse_update_own   ON public.gri_pulse_responses;

-- Owner can read own rows
CREATE POLICY gri_pulse_select_own ON public.gri_pulse_responses
  FOR SELECT USING (user_id = auth.uid());

-- Staff (super_admin/admin/manager/analyst) can read all rows
-- (same staff-policy pattern as gri_assessments in migration 021).
CREATE POLICY gri_pulse_select_admin ON public.gri_pulse_responses
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid()
        AND role IN ('super_admin', 'admin', 'manager', 'analyst')
    )
  );

-- Owner can insert own rows; service role bypasses RLS automatically
CREATE POLICY gri_pulse_insert_own ON public.gri_pulse_responses
  FOR INSERT WITH CHECK (user_id = auth.uid());

-- Owner can update own rows (re-submitting the same week)
CREATE POLICY gri_pulse_update_own ON public.gri_pulse_responses
  FOR UPDATE USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- 4. Realtime ----------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'gri_pulse_responses'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.gri_pulse_responses;
  END IF;
END
$$;

ALTER TABLE public.gri_pulse_responses REPLICA IDENTITY FULL;

-- 5. PostgREST schema cache reload ------------------------------------------
NOTIFY pgrst, 'reload schema';
