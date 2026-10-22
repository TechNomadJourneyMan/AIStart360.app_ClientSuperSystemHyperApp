-- 131_survey_answer_attribution.sql
--
-- Who filled / changed each questionnaire answer, and files attached to a
-- question (plan docs/superpowers/plans/2026-10-22-platform-fixes-wave.md, W5;
-- PO items 4.1 / 4.2).
--
--   1. survey_answers.updated_by       uuid  — the person (auth user / profile id)
--      survey_answers.updated_by_role  text  — user | expert | admin | ai | system
--      survey_answers.updated_at       timestamptz
--      Written by the server on every write (lib/survey/attribution.ts).
--      Additive and nullable, no backfill: old answers stay without an author
--      (the UI shows «ИИ (из документов)» when the answer JSON carries `source`,
--      otherwise «Автор не записан»). No FK on updated_by: an author may be
--      purged later (migration 083) and a dangling id only loses the name.
--   2. A BEFORE trigger keeps the author honest:
--        * an API caller with a user JWT (authenticated / anon) that is not
--          platform staff can only write its own answers (RLS); its rows are
--          stamped updated_by = auth.uid(), updated_by_role = 'user' (or 'ai'
--          when the owner accepted a value found in a document), so a client
--          cannot claim «изменил эксперт» through PostgREST;
--        * a trusted writer (service role, staff, migrations) that changes the
--          answer without stamping it clears the previous author instead of
--          inheriting it (updated_at = now(), author unknown).
--      The existing triggers are unchanged: survey_answers_guard_tenant_write
--      (096, BEFORE, sorts first) and survey_answers_history (073/076, AFTER).
--      RLS policies of survey_answers are untouched (row-level, not column-level).
--   3. documents.question_key text — the questionnaire question a file was
--      attached to from the answer editor; index (user_id, question_key).
--      documents.user_id is text on prod; the documents guard (089/096) is
--      unchanged — the link is written by the server with the service role.
--
-- Idempotent (IF NOT EXISTS / guarded constraints / CREATE OR REPLACE).
-- Apply: node scripts/apply-migration.js supabase/migrations/131_survey_answer_attribution.sql

-- ─── 1. survey_answers: author columns ─────────────────────────────────────
ALTER TABLE public.survey_answers ADD COLUMN IF NOT EXISTS updated_by UUID;
ALTER TABLE public.survey_answers ADD COLUMN IF NOT EXISTS updated_by_role TEXT;
ALTER TABLE public.survey_answers ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'survey_answers_updated_by_role_check'
      AND conrelid = 'public.survey_answers'::regclass
  ) THEN
    ALTER TABLE public.survey_answers
      ADD CONSTRAINT survey_answers_updated_by_role_check
      CHECK (updated_by_role IS NULL OR updated_by_role IN ('user', 'expert', 'admin', 'ai', 'system'));
  END IF;
END $$;

COMMENT ON COLUMN public.survey_answers.updated_by IS 'Who last wrote the answer (auth user / profile id); NULL = unknown (old rows, system).';
COMMENT ON COLUMN public.survey_answers.updated_by_role IS 'user | expert | admin | ai | system — shown under the field («Заполнил: вы», «Изменил эксперт …»).';
COMMENT ON COLUMN public.survey_answers.updated_at IS 'When the answer was last written by updated_by.';

-- ─── 2. survey_answers: author guard ───────────────────────────────────────
CREATE OR REPLACE FUNCTION public.stamp_survey_answer_author()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  -- A client with a user JWT writes only its own answers (RLS): it is the user.
  IF coalesce(auth.role(), '') IN ('authenticated', 'anon') AND NOT public.is_platform_staff() THEN
    NEW.updated_by := auth.uid();
    NEW.updated_by_role := CASE WHEN NEW.updated_by_role = 'ai' THEN 'ai' ELSE 'user' END;
    NEW.updated_at := now();
    RETURN NEW;
  END IF;

  -- Trusted writers: an unstamped change of the answer has no known author.
  IF TG_OP = 'UPDATE'
     AND NEW.answer IS DISTINCT FROM OLD.answer
     AND NEW.updated_at IS NOT DISTINCT FROM OLD.updated_at THEN
    NEW.updated_by := NULL;
    NEW.updated_by_role := NULL;
    NEW.updated_at := now();
  ELSIF NEW.updated_at IS NULL AND NEW.updated_by_role IS NOT NULL THEN
    NEW.updated_at := now();
  END IF;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.stamp_survey_answer_author() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS survey_answers_stamp_author ON public.survey_answers;
CREATE TRIGGER survey_answers_stamp_author
  BEFORE INSERT OR UPDATE ON public.survey_answers
  FOR EACH ROW EXECUTE FUNCTION public.stamp_survey_answer_author();

-- ─── 3. documents: the question a file is attached to ──────────────────────
ALTER TABLE public.documents ADD COLUMN IF NOT EXISTS question_key TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'documents_question_key_check'
      AND conrelid = 'public.documents'::regclass
  ) THEN
    ALTER TABLE public.documents
      ADD CONSTRAINT documents_question_key_check
      CHECK (question_key IS NULL OR question_key ~ '^[a-z][a-z0-9_]{1,79}$');
  END IF;
END $$;

COMMENT ON COLUMN public.documents.question_key IS 'Questionnaire question (survey_answers.question_key) the file was attached to in the answer editor; NULL = not attached.';

CREATE INDEX IF NOT EXISTS documents_user_question_idx
  ON public.documents (user_id, question_key)
  WHERE question_key IS NOT NULL;

NOTIFY pgrst, 'reload schema';
