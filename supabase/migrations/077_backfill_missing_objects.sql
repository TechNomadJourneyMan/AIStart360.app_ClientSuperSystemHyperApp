-- 077_backfill_missing_objects.sql
-- Сверка 2026-09-17: в прод-базе отсутствовали отдельные объекты старых
-- миграций (файлы 001 и 004 целиком повторно не применить — в них CREATE POLICY
-- без IF NOT EXISTS). Здесь — только недостающее, идемпотентно.
--   001: индексы documents_doc_type_idx, diagnostics_company_idx;
--        нумерация версий диагностики (set_diagnostic_version + триггер).
--   004: частичный индекс заметок эксперта в survey_answers.
-- Триггер companies_updated_at из 001 НЕ восстанавливается: его заменил
-- companies_onboarding_updated_at (миграция 013).
-- Применение: node scripts/apply-migration.js supabase/migrations/077_backfill_missing_objects.sql

CREATE INDEX IF NOT EXISTS documents_doc_type_idx  ON public.documents(doc_type);
CREATE INDEX IF NOT EXISTS diagnostics_company_idx ON public.diagnostics(company_id, is_current);
CREATE INDEX IF NOT EXISTS survey_answers_expert_notes_idx
  ON public.survey_answers(user_id, step)
  WHERE step = 0;

-- Номер версии диагностики внутри пары user+company. IS NOT DISTINCT FROM —
-- чтобы расчёты без компании (company_id IS NULL) тоже нумеровались
-- (в исходной версии 001 NULL = NULL давало «версию 1» каждый раз).
-- Флаг is_current сбрасывается в том же объёме, что и в 001.
CREATE OR REPLACE FUNCTION public.set_diagnostic_version()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  UPDATE public.diagnostics
  SET    is_current = FALSE
  WHERE  user_id    = NEW.user_id
    AND  company_id IS NOT DISTINCT FROM NEW.company_id
    AND  id        != NEW.id
    AND  is_current;

  SELECT COALESCE(MAX(version), 0) + 1
  INTO   NEW.version
  FROM   public.diagnostics
  WHERE  user_id    = NEW.user_id
    AND  company_id IS NOT DISTINCT FROM NEW.company_id
    AND  id        != NEW.id;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS diagnostics_versioning ON public.diagnostics;
CREATE TRIGGER diagnostics_versioning
  BEFORE INSERT ON public.diagnostics
  FOR EACH ROW EXECUTE FUNCTION public.set_diagnostic_version();

NOTIFY pgrst, 'reload schema';
