-- 047_gri_plan_progress.sql — прогресс интерактивного плана 90 дней (Фаза 5, идея №4).
-- Галочки «шаг выполнен» по карточкам action_plan_90d конкретного gri_assessment.
-- step_key — стабильный ключ шага, который строит lib/gri/plan-progress.ts
-- (формат `<horizon>-c<idx>`, напр. days_1_30-c0); assessment_id намеренно без FK:
-- gri_assessments живёт в той же схеме, но история проходов может чиститься,
-- а прогресс завязан на конкретный проход и просто перестаёт читаться.
-- Применение: node scripts/apply-migration.js supabase/migrations/047_gri_plan_progress.sql

CREATE TABLE IF NOT EXISTS public.gri_plan_progress (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  assessment_id UUID NOT NULL,
  step_key TEXT NOT NULL,
  done_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, assessment_id, step_key)
);

CREATE INDEX IF NOT EXISTS idx_gri_plan_progress_user_assessment
  ON public.gri_plan_progress (user_id, assessment_id);

-- RLS: только own CRUD (шаблон 044_crm_clients, но БЕЗ staff-политики —
-- личный прогресс владельца не нужен персоналу).
ALTER TABLE public.gri_plan_progress ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS gri_plan_progress_sel_own ON public.gri_plan_progress;
CREATE POLICY gri_plan_progress_sel_own ON public.gri_plan_progress
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS gri_plan_progress_ins_own ON public.gri_plan_progress;
CREATE POLICY gri_plan_progress_ins_own ON public.gri_plan_progress
  FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS gri_plan_progress_upd_own ON public.gri_plan_progress;
CREATE POLICY gri_plan_progress_upd_own ON public.gri_plan_progress
  FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS gri_plan_progress_del_own ON public.gri_plan_progress;
CREATE POLICY gri_plan_progress_del_own ON public.gri_plan_progress
  FOR DELETE USING (auth.uid() = user_id);

COMMENT ON TABLE public.gri_plan_progress IS
  'Отметки «шаг выполнен» интерактивного плана 90 дней (GRI). Одна строка = один выполненный шаг конкретного прохода диагностики.';
COMMENT ON COLUMN public.gri_plan_progress.assessment_id IS
  'id строки gri_assessments, к плану которой относится отметка (без FK — см. шапку файла).';
COMMENT ON COLUMN public.gri_plan_progress.step_key IS
  'Стабильный ключ шага плана: `<horizon>-c<idx>` (напр. days_1_30-c0), строит lib/gri/plan-progress.ts.';

NOTIFY pgrst, 'reload schema';
