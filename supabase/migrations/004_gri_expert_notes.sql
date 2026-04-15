-- =============================================================================
-- AIStart360 — GRI Expert Notes Support
-- Migration: 004_gri_expert_notes.sql
-- Allows storing expert notes in survey_answers with step=0
-- =============================================================================

-- Relax the step constraint to allow step=0 for expert notes
ALTER TABLE public.survey_answers DROP CONSTRAINT IF EXISTS survey_answers_step_check;
ALTER TABLE public.survey_answers ADD CONSTRAINT survey_answers_step_check CHECK (step BETWEEN 0 AND 12);

-- Allow admin/manager/analyst to insert/update expert notes in survey_answers
CREATE POLICY "survey_admin_insert" ON public.survey_answers
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid()
        AND role IN ('super_admin', 'admin', 'manager', 'analyst')
    )
  );

CREATE POLICY "survey_admin_update" ON public.survey_answers
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid()
        AND role IN ('super_admin', 'admin', 'manager', 'analyst')
    )
  );

-- Index for fast expert notes lookup
CREATE INDEX IF NOT EXISTS survey_answers_expert_notes_idx
  ON public.survey_answers(user_id, step)
  WHERE step = 0;
