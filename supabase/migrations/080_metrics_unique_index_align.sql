-- 080_metrics_unique_index_align.sql
-- Приводит metrics_unique_idx к форме, которая уже живёт в прод-базе:
--   (company_id, metric_key, period_year, period_quarter, period_month, scenario, source)
--   NULLS NOT DISTINCT
-- lib/metrics/materialize.ts делает upsert именно с этой целью ON CONFLICT.
-- 070 создавал индекс «IF NOT EXISTS» и в проде ничего не менял (индекс с
-- этим именем уже был, но с другими колонками) — поэтому материализация
-- падала с «no unique or exclusion constraint matching the ON CONFLICT».
--
-- В прод-базе миграция ничего не делает. В базе, собранной с нуля по 001/070,
-- пересоздаёт индекс (дубликаты по новому ключу невозможны: новый ключ шире).
-- Применение: node scripts/apply-migration.js supabase/migrations/080_metrics_unique_index_align.sql

ALTER TABLE public.metrics ADD COLUMN IF NOT EXISTS period_month INT;
ALTER TABLE public.metrics ADD COLUMN IF NOT EXISTS scenario TEXT;

DO $$
DECLARE
  def TEXT;
BEGIN
  SELECT indexdef INTO def FROM pg_indexes
  WHERE schemaname = 'public' AND indexname = 'metrics_unique_idx';

  IF def IS NULL OR def NOT LIKE '%period_month, scenario, source) NULLS NOT DISTINCT%' THEN
    DROP INDEX IF EXISTS public.metrics_unique_idx;
    CREATE UNIQUE INDEX metrics_unique_idx
      ON public.metrics (company_id, metric_key, period_year, period_quarter, period_month, scenario, source)
      NULLS NOT DISTINCT;
  END IF;
END $$;
