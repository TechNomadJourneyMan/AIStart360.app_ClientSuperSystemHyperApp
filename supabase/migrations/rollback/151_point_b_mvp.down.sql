-- 151_point_b_mvp.down.sql — ROLLBACK of migration 151.
--
-- NOT part of the migration sequence (appliers read only supabase/migrations/*.sql).
-- The revenue months the owner typed in «Финмодель → Выручка по месяцам» (source 'revenue_history') are kept and
-- re-labelled 'monthly_reconciliation' (the 132 meaning: the owner's own revenue of a month), then the CHECK of the
-- source returns to 132. point_b_analysis gets back the owner policies of 029 and the grants of before 151 (the client
-- could then read the staff-only AI strategy again — roll back only together with the code). Roll the CODE back first: the 151 code writes 'revenue_history' and would be refused.
--   psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 -1 -f supabase/migrations/rollback/151_point_b_mvp.down.sql

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

UPDATE public.pb_monthly_facts SET source = 'monthly_reconciliation' WHERE source = 'revenue_history';

ALTER TABLE public.pb_monthly_facts DROP CONSTRAINT IF EXISTS pb_monthly_facts_source_check;
ALTER TABLE public.pb_monthly_facts
  ADD CONSTRAINT pb_monthly_facts_source_check
  CHECK (source = 'monthly_reconciliation');

COMMENT ON COLUMN public.pb_monthly_facts.source IS NULL;

-- point_b_analysis: the owner policies of 029 and the grants as they were before 151.
DO $$
BEGIN
  IF to_regclass('public.point_b_analysis') IS NULL THEN RETURN; END IF;
  DROP POLICY IF EXISTS point_b_owner_read ON public.point_b_analysis;
  CREATE POLICY point_b_owner_read ON public.point_b_analysis FOR SELECT TO authenticated
    USING (EXISTS (SELECT 1 FROM public.diagnostics d WHERE d.id = point_b_analysis.diagnostic_id AND d.user_id = (SELECT auth.uid())));
  DROP POLICY IF EXISTS point_b_owner_write ON public.point_b_analysis;
  CREATE POLICY point_b_owner_write ON public.point_b_analysis FOR ALL TO authenticated
    USING (EXISTS (SELECT 1 FROM public.diagnostics d WHERE d.id = point_b_analysis.diagnostic_id AND d.user_id = (SELECT auth.uid())))
    WITH CHECK (EXISTS (SELECT 1 FROM public.diagnostics d WHERE d.id = point_b_analysis.diagnostic_id AND d.user_id = (SELECT auth.uid())));
  GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.point_b_analysis TO authenticated, anon;
END $$;

NOTIFY pgrst, 'reload schema';
