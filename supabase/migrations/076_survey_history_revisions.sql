-- 076_survey_history_revisions.sql
-- История анкеты склеивает правки одного автора в течение 10 минут. Чтобы
-- «6 → 9 → 6» не выглядело как «6 → 6 (ничего не менялось)», считаем, сколько
-- правок вошло в запись. Добавляется колонка; функция триггера увеличивает её.
-- Применение: node scripts/apply-migration.js supabase/migrations/076_survey_history_revisions.sql

ALTER TABLE public.survey_answer_history ADD COLUMN IF NOT EXISTS revisions INT NOT NULL DEFAULT 1;

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
      (user_id, question_key, operation, old_value, new_value, changed_by, source, impersonation_session_id)
    VALUES (v_user, v_key, TG_OP, v_old, v_new, v_actor, v_source, v_imp);
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;
REVOKE ALL ON FUNCTION public.track_survey_answer_history() FROM PUBLIC, anon, authenticated;

-- Уже склеенные записи с одинаковыми «было/стало» — это минимум две правки.
UPDATE public.survey_answer_history
SET revisions = 2
WHERE revisions = 1 AND operation = 'UPDATE' AND old_value IS NOT DISTINCT FROM new_value;

NOTIFY pgrst, 'reload schema';
