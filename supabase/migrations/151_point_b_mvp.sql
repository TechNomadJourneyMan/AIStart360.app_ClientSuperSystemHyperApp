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
-- Что делает: расширяет CHECK источника pb_monthly_facts. Больше ничего: RLS (132 + 147: клиент читает месяцы своей
-- компании при открытом разделе Точка Б, персонал — по своему скоупу, пишет только сервер) не меняется.
--
-- Идемпотентна; без BEGIN/COMMIT (применяется через psql -1). Порядок: после 132 (и 147).
-- Откат: rollback/151_point_b_mvp.down.sql (строки 'revenue_history' становятся 'monthly_reconciliation' —
-- данные владельца не теряются, CHECK возвращается к 132).

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

NOTIFY pgrst, 'reload schema';
