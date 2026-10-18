-- 126_point_b_finmodel.sql
--
-- Point B, level 2 «Финмодель» (docs/superpowers/specs/2026-10-18-point-b-design.md §5, §7;
-- plan docs/superpowers/plans/2026-10-18-point-b-phase3-finmodel-cash.md, task 1):
--
--   pb_finmodel_inputs  the numbers the owner and the expert type into the «Финмодель» form:
--                       cash on the account, fixed costs, payroll, debt, working-capital days,
--                       tax rate, capex. One row per (company, key, period): a repeated input
--                       overwrites the row. NOT in the metric registry on purpose — new registry
--                       metrics would move the Point A coverage and the survey progress.
--
--   key         one of the 11 finmodel keys (lib/point-b/finmodel/keys.ts). Percent keys are
--               stored as FRACTIONS (0.1 = 10%), days as days, money in KZT.
--   value       never negative (zero is valid for debt, debt service and capex).
--   period_key  the period the fact is for: 'YYYY-MM', 'YYYY' or '' (an «as of date» value).
--   origin      who entered it: the owner or an expert. Values from the questionnaire and from
--               the platform metrics are NOT stored here — the loader merges them on read.
--   status      'entered' (typed in) or 'verified' (checked by an expert). A change after the
--               check returns the row to 'entered' (the application does it; the verified_*
--               columns are cleared with it).
--
-- RLS: the table is written by the server only (service role). A signed-in user may SELECT the
-- rows of the companies he may read (can_read_company); anon has nothing; no INSERT / UPDATE
-- grants to authenticated.
--
-- Idempotent. NOT applied to production by the author of this file: apply with
-- node scripts/apply-migration.js supabase/migrations/126_point_b_finmodel.sql
-- only after the product owner's go-ahead.

CREATE TABLE IF NOT EXISTS public.pb_finmodel_inputs (
  id               UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id       TEXT          NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  key              TEXT          NOT NULL
                   CHECK (key IN (
                     'cash_balance', 'fixed_costs_month', 'payroll_month', 'debt_total',
                     'debt_service_month', 'interest_rate_annual', 'dso_days', 'dio_days',
                     'dpo_days', 'tax_rate', 'capex_year'
                   )),
  value            NUMERIC(20,6) NOT NULL CHECK (value >= 0),
  period_key       TEXT          NOT NULL DEFAULT ''
                   CHECK (period_key = '' OR period_key ~ '^[0-9]{4}(-(0[1-9]|1[0-2]))?$'),
  as_of            DATE,
  origin           TEXT          NOT NULL CHECK (origin IN ('owner', 'expert')),
  status           TEXT          NOT NULL DEFAULT 'entered' CHECK (status IN ('entered', 'verified')),
  note             TEXT          CHECK (note IS NULL OR length(note) <= 500),
  verified_by      UUID,
  verified_by_name TEXT          CHECK (verified_by_name IS NULL OR length(verified_by_name) <= 200),
  verified_at      TIMESTAMPTZ,
  updated_by       UUID,
  created_at       TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ   NOT NULL DEFAULT now()
);

-- One value per company, key and period.
CREATE UNIQUE INDEX IF NOT EXISTS pb_finmodel_inputs_company_key_period_uidx
  ON public.pb_finmodel_inputs (company_id, key, period_key);

DROP TRIGGER IF EXISTS pb_finmodel_inputs_updated_at ON public.pb_finmodel_inputs;
CREATE TRIGGER pb_finmodel_inputs_updated_at
  BEFORE UPDATE ON public.pb_finmodel_inputs
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ─── RLS ────────────────────────────────────────────────────────────────────
ALTER TABLE public.pb_finmodel_inputs ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.pb_finmodel_inputs FROM PUBLIC, anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.pb_finmodel_inputs FROM authenticated;
GRANT SELECT ON public.pb_finmodel_inputs TO authenticated;
GRANT ALL ON public.pb_finmodel_inputs TO service_role;

DROP POLICY IF EXISTS pb_finmodel_inputs_company_read ON public.pb_finmodel_inputs;
CREATE POLICY pb_finmodel_inputs_company_read ON public.pb_finmodel_inputs FOR SELECT TO authenticated
  USING (public.can_read_company(company_id));

NOTIFY pgrst, 'reload schema';
