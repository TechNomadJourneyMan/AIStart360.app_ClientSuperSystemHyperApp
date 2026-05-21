-- =============================================================================
-- AIStart360 — Migration 021: GRI Assessments
-- Persistence for the client-side GRI Assessment widget
-- (components/gri/assessment/GRIAssessment.tsx). Mirrors the diagnostics
-- pattern from migration 001: per-user versioned rows with is_current flag,
-- RLS scoped to owner + staff roles, owned by Supabase (not Prisma).
-- =============================================================================

-- 1. Table -------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.gri_assessments (
  id                  UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID         NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- public.companies.id is TEXT (Prisma-owned); match its type for the FK.
  company_id          TEXT         REFERENCES public.companies(id) ON DELETE SET NULL,

  -- Raw widget state captured from the client state-machine
  onboarding          JSONB        NOT NULL DEFAULT '{}'::jsonb,
  scores              JSONB        NOT NULL DEFAULT '{}'::jsonb,
  -- scores shape: { [sectionId]: { [criterionId]: 1-10 } }

  -- Pre-computed roll-ups (server-side from `scores`)
  section_avgs        JSONB        NOT NULL DEFAULT '{}'::jsonb,
  -- section_avgs shape: { [sectionId]: number }
  gri_index           NUMERIC(4,2) NOT NULL,
  -- Overall mean of section_avgs (0..10), rounded to 2 decimals

  completed_sections  JSONB        NOT NULL DEFAULT '{}'::jsonb,

  is_current          BOOLEAN      NOT NULL DEFAULT TRUE,
  created_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.gri_assessments IS
  'GRI self-assessment results from the client-side widget. New row per submission; trigger flips previous rows to is_current=false.';
COMMENT ON COLUMN public.gri_assessments.scores IS
  'JSONB: { [sectionId]: { [criterionId]: integer 1..10 } }';
COMMENT ON COLUMN public.gri_assessments.section_avgs IS
  'JSONB: { [sectionId]: number } — per-section mean across scored criteria.';
COMMENT ON COLUMN public.gri_assessments.gri_index IS
  'Overall mean across section_avgs (only sections with a positive average count). 0..10, 2 decimals.';

-- 2. Indexes -----------------------------------------------------------------
CREATE INDEX IF NOT EXISTS gri_assessments_user_current_idx
  ON public.gri_assessments(user_id, is_current);

CREATE INDEX IF NOT EXISTS gri_assessments_company_created_idx
  ON public.gri_assessments(company_id, created_at DESC);

-- 3. is_current trigger ------------------------------------------------------
-- On INSERT, mark all previous rows for the same user as not current.
-- Scoped by user_id only (a user may not have a company_id, and the widget
-- is one assessment per user at a time).
CREATE OR REPLACE FUNCTION public.set_gri_assessment_current()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  UPDATE public.gri_assessments
  SET    is_current = FALSE
  WHERE  user_id    = NEW.user_id
    AND  id        != NEW.id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS gri_assessments_current_flip ON public.gri_assessments;
CREATE TRIGGER gri_assessments_current_flip
  AFTER INSERT ON public.gri_assessments
  FOR EACH ROW EXECUTE FUNCTION public.set_gri_assessment_current();

-- 4. updated_at trigger ------------------------------------------------------
-- Reuse the public.set_updated_at() function defined in migration 001.
DROP TRIGGER IF EXISTS gri_assessments_updated_at ON public.gri_assessments;
CREATE TRIGGER gri_assessments_updated_at
  BEFORE UPDATE ON public.gri_assessments
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 5. RLS ---------------------------------------------------------------------
ALTER TABLE public.gri_assessments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS gri_assessments_select_own   ON public.gri_assessments;
DROP POLICY IF EXISTS gri_assessments_select_admin ON public.gri_assessments;
DROP POLICY IF EXISTS gri_assessments_insert_own   ON public.gri_assessments;
DROP POLICY IF EXISTS gri_assessments_update_own   ON public.gri_assessments;
DROP POLICY IF EXISTS gri_assessments_update_admin ON public.gri_assessments;

-- Owner can read own rows
CREATE POLICY gri_assessments_select_own ON public.gri_assessments
  FOR SELECT USING (user_id = auth.uid());

-- Staff (super_admin/admin/manager/analyst) can read all rows
CREATE POLICY gri_assessments_select_admin ON public.gri_assessments
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid()
        AND role IN ('super_admin', 'admin', 'manager', 'analyst')
    )
  );

-- Owner can insert own rows; service role bypasses RLS automatically
CREATE POLICY gri_assessments_insert_own ON public.gri_assessments
  FOR INSERT WITH CHECK (user_id = auth.uid());

-- Owner can update own rows
CREATE POLICY gri_assessments_update_own ON public.gri_assessments
  FOR UPDATE USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Staff can update any row (mirrors diagnostics admin pattern)
CREATE POLICY gri_assessments_update_admin ON public.gri_assessments
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid()
        AND role IN ('super_admin', 'admin', 'manager', 'analyst')
    )
  );

-- 6. PostgREST schema cache reload ------------------------------------------
NOTIFY pgrst, 'reload schema';
