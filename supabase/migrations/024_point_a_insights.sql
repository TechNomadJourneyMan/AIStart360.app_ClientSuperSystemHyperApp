-- =============================================================================
-- AIStart360 — Migration 024: Point A "Уточняющие вопросы" insights feed
--
-- Storage for the clarifying-questions feed shown on /point-a. Items can be
-- authored by AI, an expert/coach, the client themselves, or an admin, and
-- progress through a small state machine:
--
--   pending_ai            — slot reserved by the AI pipeline, not yet written
--   pending_confirmation  — AI emitted a predicted answer, awaiting client OK
--   awaiting_answer       — question accepted, no answer attached yet
--   confirmed             — final answer accepted by the client
--   rejected              — question/answer dismissed
--
-- Mirrors the RLS pattern from migration 021 (gri_assessments): owners see
-- own rows, staff sees all, owners can insert/update own rows.
-- Idempotent — safe to re-run.
-- =============================================================================

-- 1. Table -------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.point_a_insights (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- public.companies.id is TEXT (Prisma-owned); match its type for the FK.
  company_id          TEXT        REFERENCES public.companies(id) ON DELETE SET NULL,

  type                TEXT        NOT NULL
                       CHECK (type IN ('ai', 'expert', 'client', 'admin')),
  category            TEXT        NOT NULL,
  -- Free-form, but the UI expects the canonical Russian section labels:
  -- ВЫРУЧКА, СТРАТЕГИЯ, ВОРОНКА, КЛИЕНТЫ, ОРГСТРУКТУРА, КОНКУРЕНТЫ, …

  question_text       TEXT        NOT NULL,
  author_name         TEXT,

  answer_text         TEXT,
  answer_author_name  TEXT,
  answer_author_role  TEXT        CHECK (answer_author_role IN ('ai', 'expert', 'client', 'admin')),
  answered_at         TIMESTAMPTZ,

  status              TEXT        NOT NULL DEFAULT 'pending_ai'
                       CHECK (status IN (
                         'pending_ai',
                         'pending_confirmation',
                         'awaiting_answer',
                         'confirmed',
                         'rejected'
                       )),

  source_meta         JSONB,
  -- Example: {"model":"anthropic/claude-sonnet-4.5","confidence":0.72,"based_on":"diagnostic-xyz"}

  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.point_a_insights IS
  'Clarifying questions feed for /point-a. Rows may originate from AI, expert, client, or admin and move through a small status state machine.';

-- 2. Indexes -----------------------------------------------------------------
CREATE INDEX IF NOT EXISTS point_a_insights_user_created_idx
  ON public.point_a_insights (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS point_a_insights_status_idx
  ON public.point_a_insights (status);

CREATE INDEX IF NOT EXISTS point_a_insights_company_created_idx
  ON public.point_a_insights (company_id, created_at DESC);

-- 3. updated_at trigger ------------------------------------------------------
-- Reuse public.set_updated_at() from migration 001.
DROP TRIGGER IF EXISTS point_a_insights_updated_at ON public.point_a_insights;
CREATE TRIGGER point_a_insights_updated_at
  BEFORE UPDATE ON public.point_a_insights
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 4. RLS ---------------------------------------------------------------------
ALTER TABLE public.point_a_insights ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS point_a_insights_select_own    ON public.point_a_insights;
DROP POLICY IF EXISTS point_a_insights_select_admin  ON public.point_a_insights;
DROP POLICY IF EXISTS point_a_insights_insert_own    ON public.point_a_insights;
DROP POLICY IF EXISTS point_a_insights_insert_admin  ON public.point_a_insights;
DROP POLICY IF EXISTS point_a_insights_update_own    ON public.point_a_insights;
DROP POLICY IF EXISTS point_a_insights_update_admin  ON public.point_a_insights;
DROP POLICY IF EXISTS point_a_insights_delete_own    ON public.point_a_insights;

-- Owner can read own rows
CREATE POLICY point_a_insights_select_own ON public.point_a_insights
  FOR SELECT USING (user_id = auth.uid());

-- Staff (super_admin/admin/manager/analyst/expert) can read all rows
CREATE POLICY point_a_insights_select_admin ON public.point_a_insights
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid()
        AND role IN ('super_admin', 'admin', 'manager', 'analyst', 'expert')
    )
  );

-- Owner can insert own rows
CREATE POLICY point_a_insights_insert_own ON public.point_a_insights
  FOR INSERT WITH CHECK (user_id = auth.uid());

-- Staff can insert on behalf of any user (expert/admin asking questions of a client)
CREATE POLICY point_a_insights_insert_admin ON public.point_a_insights
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid()
        AND role IN ('super_admin', 'admin', 'manager', 'analyst', 'expert')
    )
  );

-- Owner can update own rows (e.g. answer their own questions, confirm AI guesses)
CREATE POLICY point_a_insights_update_own ON public.point_a_insights
  FOR UPDATE USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Staff can update any row (expert answers a question on a client)
CREATE POLICY point_a_insights_update_admin ON public.point_a_insights
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid()
        AND role IN ('super_admin', 'admin', 'manager', 'analyst', 'expert')
    )
  );

-- Owner can delete own rows (UI dismiss flow may rely on rejected status instead)
CREATE POLICY point_a_insights_delete_own ON public.point_a_insights
  FOR DELETE USING (user_id = auth.uid());

-- 5. Realtime publication ---------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'point_a_insights'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.point_a_insights;
  END IF;
END
$$;

ALTER TABLE public.point_a_insights REPLICA IDENTITY FULL;

-- 6. PostgREST schema cache reload ------------------------------------------
NOTIFY pgrst, 'reload schema';
