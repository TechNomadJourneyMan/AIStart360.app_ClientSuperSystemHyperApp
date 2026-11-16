-- 151_point_b_mvp.sql
--
-- R3-PB (Раунд 3, Точка Б — минимальная рабочая Точка Б для платного клиента).
--
-- «Выручка по месяцам» до плана (пакет M2 аудита R3-B): владелец вносит выручку за 12–24 месяца во вкладке
-- «Финмодель», ещё до одобрения плана, чтобы «Обзор» мог дать прогноз «при текущем ходе» и вердикт (прогнозу нужны
-- 12 месяцев подряд). Месяцы хранятся в той же таблице, что и «Факт за месяц» сверки (132, pb_monthly_facts,
-- metric = 'revenue'): одна история выручки по месяцам для «Обзора», пересчёта и план-факта
-- (lib/point-b/model/history.ts). Источник строки различает, откуда она:
--   monthly_reconciliation  «Факт за месяц» после одобрения плана (как было)
--   revenue_history         таблица «Выручка по месяцам» во «Финмодели» (новое)
-- Отдельная таблица по-прежнему нужна (см. 132): metric_overrides сделали бы месячную выручку текущей ГОДОВОЙ
-- выручкой Точки А, а metric_facts — производная таблица слоя данных (её перезаписывает синхронизация).
--
-- Что делает:
--   1. расширяет CHECK источника pb_monthly_facts (RLS 132 + 147 не меняется: клиент читает месяцы своей компании при
--      открытом разделе Точка Б, персонал — по своему скоупу, пишет только сервер);
--   2. (ревью R3-PB, H1) point_b_analysis: ИИ-стратегия Точки Б — черновик ТОЛЬКО для персонала (решение PO), а
--      политики 029 давали владельцу диагностики читать и переписывать строку через PostgREST (его JWT + anon-ключ):
--      `ai_strategy`, `ai_status`, `roadmap`, `target_*`, которые читает ИИ-черновик ревью персонала. Все чтения и записи
--      приложения идут сервисной ролью (diagnostics/point-b, ai-generate, fan-out, ai-draft и профиль в ГИГА), поэтому
--      политики владельца `point_b_owner_read` / `point_b_owner_write` удаляются, у authenticated отзываются права на
--      запись, у anon — все права. Персонал по-прежнему читает через `point_b_staff_read` (140: Admin / Super Admin и
--      назначенный эксперт), сервисная роль — всё. Старые строки не трогаются: клиент их больше не видит.
--
-- Идемпотентна; без BEGIN/COMMIT (применяется через psql -1). Порядок: после 132, 140 и 147.
-- Откат: rollback/151_point_b_mvp.down.sql (строки 'revenue_history' становятся 'monthly_reconciliation' —
-- данные владельца не теряются, CHECK возвращается к 132; политики и права point_b_analysis — как до 151).

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

DO $$
BEGIN
  IF to_regclass('public.pb_monthly_facts') IS NULL THEN
    RAISE EXCEPTION '151 requires 132_point_b_checkpoints_runs (public.pb_monthly_facts)';
  END IF;
END $$;

ALTER TABLE public.pb_monthly_facts DROP CONSTRAINT IF EXISTS pb_monthly_facts_source_check;
ALTER TABLE public.pb_monthly_facts
  ADD CONSTRAINT pb_monthly_facts_source_check
  CHECK (source IN ('monthly_reconciliation', 'revenue_history'));

COMMENT ON COLUMN public.pb_monthly_facts.source IS
  'monthly_reconciliation — «Факт за месяц» сверки одобренного плана; revenue_history — таблица «Выручка по месяцам» во «Финмодели» (151), до плана';

-- ─── 2. point_b_analysis: клиент не читает и не пишет (ИИ-стратегия — черновик персонала) ─────────────────
DO $$
BEGIN
  IF to_regclass('public.point_b_analysis') IS NULL THEN
    RAISE NOTICE '151: public.point_b_analysis is absent — skipped';
    RETURN;
  END IF;
  DROP POLICY IF EXISTS point_b_owner_read ON public.point_b_analysis;
  DROP POLICY IF EXISTS point_b_owner_write ON public.point_b_analysis;
  REVOKE ALL ON public.point_b_analysis FROM anon;
  REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.point_b_analysis FROM authenticated;
  -- Staff sessions keep reading through point_b_staff_read (140); without a policy a client reads nothing.
  GRANT SELECT ON public.point_b_analysis TO authenticated;
  GRANT ALL ON public.point_b_analysis TO service_role;
END $$;

NOTIFY pgrst, 'reload schema';
