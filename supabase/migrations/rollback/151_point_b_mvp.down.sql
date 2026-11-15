-- 151_point_b_mvp.down.sql — ROLLBACK of migration 151.
--
-- NOT part of the migration sequence (appliers read only supabase/migrations/*.sql).
-- The revenue months the owner typed in «Финмодель → Выручка по месяцам» (source 'revenue_history') are kept and
-- re-labelled 'monthly_reconciliation' (the 132 meaning: the owner's own revenue of a month), then the CHECK of the
-- source returns to 132. Roll the CODE back first: the 151 code writes 'revenue_history' and would be refused.
--   psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 -1 -f supabase/migrations/rollback/151_point_b_mvp.down.sql

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

UPDATE public.pb_monthly_facts SET source = 'monthly_reconciliation' WHERE source = 'revenue_history';

ALTER TABLE public.pb_monthly_facts DROP CONSTRAINT IF EXISTS pb_monthly_facts_source_check;
ALTER TABLE public.pb_monthly_facts
  ADD CONSTRAINT pb_monthly_facts_source_check
  CHECK (source = 'monthly_reconciliation');

COMMENT ON COLUMN public.pb_monthly_facts.source IS NULL;

NOTIFY pgrst, 'reload schema';
