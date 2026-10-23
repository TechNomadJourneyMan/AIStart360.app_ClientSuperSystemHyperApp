-- 134_survey_answer_via.sql
--
-- HOW each questionnaire answer was given (spec docs/superpowers/specs/
-- 2026-10-23-survey-three-modes-design.md §5.4, §11; plan
-- docs/superpowers/plans/2026-10-23-survey-modes-phase1.md, task 2).
--
--   1. survey_answers.updated_via text — the path next to the author of 131:
--        full      the full questionnaire and edits in «Мои ответы»
--        express   express flow and deepening blocks
--        chat      confirmed in the AI chat (written by the server only)
--        helper    confirmed in the field «Помощник» (saved by the form)
--        document  accepted from a document (role 'ai')
--        staff     an expert / admin edit (written by the server only)
--        system    migrations, auto-year, goal sync
--      Nullable, no backfill: old answers keep their author line without a path.
--   2. The author guard of 131 (stamp_survey_answer_author) also guards the
--      path: a caller with a user JWT that is not platform staff may set only
--      full | express | helper | document (anything else becomes NULL) — a
--      client cannot pass its own edit off as a chat confirmation or as an
--      expert's edit. 'document' and the role 'ai' go together. A trusted
--      writer (service role, staff, migrations) that changes the answer
--      without stamping it clears the path together with the author; a stamp
--      by a different author without a path clears the inherited path.
--   3. survey_answer_history.via — the path in the change history; the
--      history trigger (073/076, verified identical on prod 2026-10-23)
--      copies NEW.updated_via and no longer glues edits made on different
--      paths into one record.
--   4. ai_conversations.surface += 'survey' (the questionnaire chat, Ф4);
--      ai_pending_actions.kind += 'set_survey_answer' (the «Записать» card).
--      Constraint names verified on prod 2026-10-23.
--
-- Idempotent (IF NOT EXISTS / guarded or dropped-and-recreated constraints /
-- CREATE OR REPLACE). Additive: no data is changed.
-- Apply (on push to main, PO rule): node scripts/apply-migration.js supabase/migrations/134_survey_answer_via.sql

-- ─── 1. survey_answers.updated_via ─────────────────────────────────────────
ALTER TABLE public.survey_answers ADD COLUMN IF NOT EXISTS updated_via TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'survey_answers_updated_via_check'
      AND conrelid = 'public.survey_answers'::regclass
  ) THEN
    ALTER TABLE public.survey_answers
      ADD CONSTRAINT survey_answers_updated_via_check
      CHECK (updated_via IS NULL OR updated_via IN ('full', 'express', 'chat', 'helper', 'document', 'staff', 'system'));
  END IF;
END $$;

COMMENT ON COLUMN public.survey_answers.updated_via IS 'full | express | chat | helper | document | staff | system — how the answer was given («Заполнил: вы (через ИИ-помощника)»). NULL = unknown (old rows).';

-- ─── 2. author + path guard ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.stamp_survey_answer_author()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  -- A client with a user JWT writes only its own answers (RLS): it is the user.
  IF coalesce(auth.role(), '') IN ('authenticated', 'anon') AND NOT public.is_platform_staff() THEN
    NEW.updated_by := auth.uid();
    NEW.updated_by_role := CASE WHEN NEW.updated_by_role = 'ai' OR NEW.updated_via = 'document' THEN 'ai' ELSE 'user' END;
    -- The client's own paths only; 'chat' and 'staff' are written by the server.
    NEW.updated_via := CASE
      WHEN NEW.updated_by_role = 'ai' THEN 'document'
      WHEN NEW.updated_via IN ('full', 'express', 'helper') THEN NEW.updated_via
      ELSE NULL
    END;
    NEW.updated_at := now();
    RETURN NEW;
  END IF;

  -- Trusted writers: an unstamped change of the answer has no known author or path.
  IF TG_OP = 'UPDATE'
     AND NEW.answer IS DISTINCT FROM OLD.answer
     AND NEW.updated_at IS NOT DISTINCT FROM OLD.updated_at THEN
    NEW.updated_by := NULL;
    NEW.updated_by_role := NULL;
    NEW.updated_via := NULL;
    NEW.updated_at := now();
  ELSE
    -- A new author without a path does not inherit the previous author's path.
    IF TG_OP = 'UPDATE'
       AND NEW.updated_via IS NOT DISTINCT FROM OLD.updated_via
       AND (NEW.updated_by IS DISTINCT FROM OLD.updated_by OR NEW.updated_by_role IS DISTINCT FROM OLD.updated_by_role) THEN
      NEW.updated_via := NULL;
    END IF;
    IF NEW.updated_at IS NULL AND NEW.updated_by_role IS NOT NULL THEN
      NEW.updated_at := now();
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.stamp_survey_answer_author() FROM PUBLIC, anon, authenticated;

-- The trigger itself is unchanged (131); recreated so the migration also
-- works on a database where 131 ran without it.
DROP TRIGGER IF EXISTS survey_answers_stamp_author ON public.survey_answers;
CREATE TRIGGER survey_answers_stamp_author
  BEFORE INSERT OR UPDATE ON public.survey_answers
  FOR EACH ROW EXECUTE FUNCTION public.stamp_survey_answer_author();

-- ─── 3. survey_answer_history.via ──────────────────────────────────────────
ALTER TABLE public.survey_answer_history ADD COLUMN IF NOT EXISTS via TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'survey_answer_history_via_check'
      AND conrelid = 'public.survey_answer_history'::regclass
  ) THEN
    ALTER TABLE public.survey_answer_history
      ADD CONSTRAINT survey_answer_history_via_check
      CHECK (via IS NULL OR via IN ('full', 'express', 'chat', 'helper', 'document', 'staff', 'system'));
  END IF;
END $$;

COMMENT ON COLUMN public.survey_answer_history.via IS 'survey_answers.updated_via of the change (NULL for deletes and old rows).';

-- 076 + the path: copied into the record; edits on different paths are not glued.
CREATE OR REPLACE FUNCTION public.track_survey_answer_history()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_claims   JSONB;
  v_headers  JSONB;
  v_role     TEXT;
  v_actor    TEXT;
  v_source   TEXT;
  v_imp      UUID;
  v_user     UUID := COALESCE(NEW.user_id, OLD.user_id);
  v_key      TEXT := COALESCE(NEW.question_key, OLD.question_key);
  v_old      JSONB := CASE WHEN TG_OP <> 'INSERT' THEN OLD.answer END;
  v_new      JSONB := CASE WHEN TG_OP <> 'DELETE' THEN NEW.answer END;
  v_via      TEXT := CASE WHEN TG_OP <> 'DELETE' THEN NEW.updated_via END;
  v_existing BIGINT;
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.answer IS NOT DISTINCT FROM NEW.answer THEN
    RETURN NEW;
  END IF;

  BEGIN
    v_claims := NULLIF(current_setting('request.jwt.claims', true), '')::jsonb;
  EXCEPTION WHEN others THEN v_claims := NULL;
  END;
  BEGIN
    v_headers := NULLIF(current_setting('request.headers', true), '')::jsonb;
  EXCEPTION WHEN others THEN v_headers := NULL;
  END;
  v_role := COALESCE(v_claims ->> 'role', '');

  IF v_role = 'service_role' THEN
    v_actor := NULLIF(v_headers ->> 'x-actor-id', '');
    v_source := COALESCE(NULLIF(v_headers ->> 'x-actor-source', ''), 'service');
    IF v_source NOT IN ('admin', 'impersonation', 'service', 'user') THEN v_source := 'service'; END IF;
    BEGIN
      v_imp := NULLIF(v_headers ->> 'x-impersonation-id', '')::uuid;
    EXCEPTION WHEN others THEN v_imp := NULL;
    END;
  ELSIF v_claims ->> 'sub' IS NOT NULL THEN
    v_actor := v_claims ->> 'sub';
    v_source := 'user';
  ELSE
    v_source := 'service';
  END IF;

  SELECT h.id INTO v_existing
  FROM public.survey_answer_history h
  WHERE h.user_id = v_user
    AND h.question_key = v_key
    AND h.changed_by IS NOT DISTINCT FROM v_actor
    AND h.source = v_source
    AND h.impersonation_session_id IS NOT DISTINCT FROM v_imp
    AND h.via IS NOT DISTINCT FROM v_via
    AND h.operation <> 'DELETE'
    AND h.updated_at > now() - interval '10 minutes'
  ORDER BY h.id DESC
  LIMIT 1;

  IF v_existing IS NOT NULL AND TG_OP <> 'DELETE' THEN
    UPDATE public.survey_answer_history
    SET new_value = v_new, updated_at = now(), revisions = revisions + 1
    WHERE id = v_existing;
  ELSE
    INSERT INTO public.survey_answer_history
      (user_id, question_key, operation, old_value, new_value, changed_by, source, impersonation_session_id, via)
    VALUES (v_user, v_key, TG_OP, v_old, v_new, v_actor, v_source, v_imp, v_via);
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;
REVOKE ALL ON FUNCTION public.track_survey_answer_history() FROM PUBLIC, anon, authenticated;

-- ─── 4. AI chat: the questionnaire surface and the «Записать» card ─────────
ALTER TABLE public.ai_conversations DROP CONSTRAINT IF EXISTS ai_conversations_surface_check;
ALTER TABLE public.ai_conversations ADD CONSTRAINT ai_conversations_surface_check
  CHECK (surface IN ('report', 'dashboard', 'point_a', 'point_b', 'simulator', 'intake', 'gri', 'global', 'survey'));

ALTER TABLE public.ai_pending_actions DROP CONSTRAINT IF EXISTS ai_pending_actions_kind_check;
ALTER TABLE public.ai_pending_actions ADD CONSTRAINT ai_pending_actions_kind_check
  CHECK (kind IN ('set_value', 'resolve_discrepancy', 'set_goal', 'set_survey_answer'));

NOTIFY pgrst, 'reload schema';
