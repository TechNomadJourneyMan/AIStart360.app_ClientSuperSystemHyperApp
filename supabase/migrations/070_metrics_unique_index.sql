-- 070_metrics_unique_index.sql
-- Восстанавливает уникальный индекс на public.metrics.
--
-- НАЙДЕНО 2026-09-08 при сквозной проверке: materializeAll() падает в БД с
--   "there is no unique or exclusion constraint matching the ON CONFLICT specification"
-- потому что lib/metrics/materialize.ts делает upsert с
--   onConflict: 'company_id,metric_key,period_year,period_quarter,source'
-- а соответствующего уникального индекса в подключённой базе нет. Индекс
-- объявлен в 001_onboarding_system.sql (metrics_unique_idx), но в текущей БД
-- отсутствует — таблица `metrics` там создавалась иначе.
--
-- ПОСЛЕДСТВИЕ: ни одна метрика не материализуется, public.metrics пустая, и
-- каталог /metrics показывает «Нет данных» по всем бизнес-метрикам и KPI.
--
-- ВНИМАНИЕ: шаг 1 УДАЛЯЕТ дубликаты (оставляя самую свежую строку в каждой
-- группе) — без этого уникальный индекс не построится. Дубликаты избыточны по
-- смыслу: свежая материализация всегда перекрывает предыдущую. Применяйте
-- осознанно: node scripts/apply-migration.js supabase/migrations/070_metrics_unique_index.sql

-- 1. Схлопнуть дубликаты. NULL в period_year / period_quarter в PARTITION BY
--    группируются вместе — ровно то, что нужно перед построением индекса.
WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY company_id, metric_key, period_year, period_quarter, source
      ORDER BY recorded_at DESC NULLS LAST, id DESC
    ) AS rn
  FROM public.metrics
)
DELETE FROM public.metrics m
USING ranked r
WHERE m.id = r.id
  AND r.rn > 1;

-- 2. Собственно индекс — цель ON CONFLICT в materialize.ts.
CREATE UNIQUE INDEX IF NOT EXISTS metrics_unique_idx
  ON public.metrics(company_id, metric_key, period_year, period_quarter, source);
