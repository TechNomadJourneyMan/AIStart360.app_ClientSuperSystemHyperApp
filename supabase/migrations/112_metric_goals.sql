-- 112_metric_goals.sql
--
-- Goals on any metric (docs/superpowers/specs/2026-10-12-point-a-full-design.md §3):
-- public.metric_targets (085) becomes the one source of goals — a deadline,
-- the baseline (value and period of the metric when the goal was set), a
-- label. companies.target_revenue_12m_kzt / _3y_kzt stay for compatibility
-- and are kept in sync by the goal routes (lib/goals/store.ts).
--
-- Idempotent. Apply: node scripts/apply-migration.js supabase/migrations/112_metric_goals.sql

ALTER TABLE public.metric_targets ADD COLUMN IF NOT EXISTS deadline        DATE;
ALTER TABLE public.metric_targets ADD COLUMN IF NOT EXISTS baseline_value  NUMERIC(20,4);
ALTER TABLE public.metric_targets ADD COLUMN IF NOT EXISTS baseline_period TEXT;
ALTER TABLE public.metric_targets ADD COLUMN IF NOT EXISTS label           TEXT;
ALTER TABLE public.metric_targets ADD COLUMN IF NOT EXISTS updated_by      TEXT;

-- Backfill: the revenue targets the owners already set (step 1 / dashboard).
INSERT INTO public.metric_targets (company_id, metric_key, target_value, direction, period_label, source, label)
SELECT c.id, 'biz.finansy.vyruchka_god', c.target_revenue_12m_kzt, 'higher_is_better', '12m', 'owner', 'Выручка через 12 месяцев'
FROM public.companies c
WHERE c.target_revenue_12m_kzt IS NOT NULL AND c.target_revenue_12m_kzt > 0
ON CONFLICT (company_id, metric_key, period_label) DO NOTHING;

INSERT INTO public.metric_targets (company_id, metric_key, target_value, direction, period_label, source, label)
SELECT c.id, 'biz.finansy.vyruchka_god', c.target_revenue_3y_kzt, 'higher_is_better', '3y', 'owner', 'Выручка через 3 года'
FROM public.companies c
WHERE c.target_revenue_3y_kzt IS NOT NULL AND c.target_revenue_3y_kzt > 0
ON CONFLICT (company_id, metric_key, period_label) DO NOTHING;

NOTIFY pgrst, 'reload schema';
