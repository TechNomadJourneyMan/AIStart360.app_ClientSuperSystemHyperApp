-- 072_gri_assessment_drafts.sql — серверный черновик полного GRI-теста.
--
-- Тест из 67 критериев занимает 15–20 минут, а на сервер уходил только готовый
-- результат: до этого момента ответы жили в localStorage одного браузера
-- (чистка данных сайта / другое устройство = всё заново). Черновик — одна
-- строка на пользователя; после успешной отправки результата она удаляется.
--
-- Заодно: частичный уникальный индекс на «текущую» оценку. Триггер
-- set_gri_assessment_current (021) снимает флаг AFTER INSERT, и две параллельные
-- вставки могли оставить две is_current-строки.
-- Применение: node scripts/apply-migration.js supabase/migrations/072_gri_assessment_drafts.sql

CREATE TABLE IF NOT EXISTS public.gri_assessment_drafts (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  state JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.gri_assessment_drafts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS gri_assessment_drafts_sel_own ON public.gri_assessment_drafts;
CREATE POLICY gri_assessment_drafts_sel_own ON public.gri_assessment_drafts
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS gri_assessment_drafts_ins_own ON public.gri_assessment_drafts;
CREATE POLICY gri_assessment_drafts_ins_own ON public.gri_assessment_drafts
  FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS gri_assessment_drafts_upd_own ON public.gri_assessment_drafts;
CREATE POLICY gri_assessment_drafts_upd_own ON public.gri_assessment_drafts
  FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS gri_assessment_drafts_del_own ON public.gri_assessment_drafts;
CREATE POLICY gri_assessment_drafts_del_own ON public.gri_assessment_drafts
  FOR DELETE USING (auth.uid() = user_id);

COMMENT ON TABLE public.gri_assessment_drafts IS
  'Незавершённый проход полного GRI-теста: {onboarding, scores, completedSections}. Одна строка на пользователя.';

-- Одна текущая оценка на пользователя: сначала чиним возможные дубли.
WITH ranked AS (
  SELECT id, row_number() OVER (PARTITION BY user_id ORDER BY created_at DESC, id DESC) AS rn
  FROM public.gri_assessments
  WHERE is_current
)
UPDATE public.gri_assessments g SET is_current = false
FROM ranked r WHERE g.id = r.id AND r.rn > 1;

-- Флаг снимается ДО вставки (раньше — AFTER INSERT), иначе новая строка
-- конфликтовала бы с индексом ниже. Тело функции из 021 не меняется.
DROP TRIGGER IF EXISTS gri_assessments_current_flip ON public.gri_assessments;
CREATE TRIGGER gri_assessments_current_flip
  BEFORE INSERT ON public.gri_assessments
  FOR EACH ROW EXECUTE FUNCTION public.set_gri_assessment_current();

CREATE UNIQUE INDEX IF NOT EXISTS gri_assessments_one_current_per_user
  ON public.gri_assessments (user_id) WHERE is_current;

NOTIFY pgrst, 'reload schema';
