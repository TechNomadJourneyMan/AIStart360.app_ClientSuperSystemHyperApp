-- Store financial analytics: owner-scoped monthly management-accounting facts.
--
-- Financial periods are intentionally separate from operational sales lines.
-- Only normalized values and a non-identifying hashed source label are stored;
-- the raw workbook, customer data and free-form source filename are not kept.

REVOKE CREATE ON SCHEMA public FROM PUBLIC, anon, authenticated;

-- Every Store insert holds the matching company row through commit. This
-- closes the race where a company could be deleted or transferred after an
-- unlocked owner EXISTS check but before the fact insert commits.
CREATE OR REPLACE FUNCTION public.store_enforce_company_owner()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  PERFORM company.id
    FROM public.companies AS company
   WHERE company.id::TEXT = btrim(NEW.company_id)
     AND company.user_id = NEW.user_id
   FOR SHARE OF company;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'invalid store company binding' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.store_enforce_company_owner()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE TABLE IF NOT EXISTS public.store_financial_imports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  company_id TEXT NOT NULL CHECK (length(btrim(company_id)) BETWEEN 1 AND 200),
  source_sha256 TEXT NOT NULL CHECK (source_sha256 ~ '^[a-f0-9]{64}$'),
  source_file_label TEXT NOT NULL CHECK (
    source_file_label ~ '^store-import-[a-f0-9]{12}\.(xls|xlsx|csv)$'
  ),
  source_size_bytes INTEGER NOT NULL CHECK (
    source_size_bytes BETWEEN 1 AND 10485760
  ),
  schema_version INTEGER NOT NULL CHECK (schema_version BETWEEN 1 AND 1000),
  idempotency_key UUID NOT NULL,
  manifest_sha256 TEXT NOT NULL CHECK (manifest_sha256 ~ '^[a-f0-9]{64}$'),
  rows_fingerprint_md5 TEXT NOT NULL CHECK (rows_fingerprint_md5 ~ '^[a-f0-9]{32}$'),
  scope_key TEXT NOT NULL CHECK (length(btrim(scope_key)) BETWEEN 1 AND 160),
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  row_count INTEGER NOT NULL CHECK (row_count BETWEEN 1 AND 10000),
  warning_count INTEGER NOT NULL DEFAULT 0 CHECK (warning_count BETWEEN 0 AND 10000),
  quarantined_count INTEGER NOT NULL DEFAULT 0 CHECK (quarantined_count BETWEEN 0 AND 10000),
  status TEXT NOT NULL DEFAULT 'validated' CHECK (
    status IN ('validated', 'published', 'failed')
  ),
  published_at TIMESTAMPTZ CHECK (
    published_at IS NULL OR isfinite(published_at)
  ),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now() CHECK (isfinite(created_at)),
  UNIQUE (id, user_id, company_id),
  UNIQUE (user_id, company_id, idempotency_key),
  UNIQUE (user_id, company_id, manifest_sha256),
  CONSTRAINT store_financial_imports_period_order CHECK (period_end >= period_start),
  CONSTRAINT store_financial_imports_publish_state CHECK (
    (status = 'published' AND published_at IS NOT NULL)
    OR (status <> 'published' AND published_at IS NULL)
  )
);

CREATE TABLE IF NOT EXISTS public.store_financial_periods (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  import_id UUID NOT NULL,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  company_id TEXT NOT NULL CHECK (length(btrim(company_id)) BETWEEN 1 AND 200),
  scope_key TEXT NOT NULL CHECK (scope_key ~ '^month:[0-9]{4}-[0-9]{2}$'),
  period_month DATE NOT NULL CHECK (EXTRACT(DAY FROM period_month) = 1),
  period_end DATE NOT NULL,
  granularity TEXT NOT NULL DEFAULT 'month' CHECK (granularity = 'month'),
  currency TEXT NOT NULL DEFAULT 'KZT' CHECK (currency = 'KZT'),
  revenue_basis TEXT NOT NULL CHECK (revenue_basis = 'net_after_discounts_returns'),
  revenue NUMERIC(18,2) NOT NULL CHECK (revenue >= 0),
  cost_amount NUMERIC(18,2) NOT NULL CHECK (cost_amount >= 0),
  gross_profit NUMERIC(18,2) NOT NULL,
  gross_margin_pct NUMERIC(12,4),
  reported_gross_profit NUMERIC(18,2),
  gross_profit_reconciliation_delta NUMERIC(18,2),
  period_expenses NUMERIC(18,2),
  bonuses NUMERIC(18,2),
  write_offs NUMERIC(18,2),
  ebitda NUMERIC(18,2),
  ebitda_margin_pct NUMERIC(12,4),
  completeness TEXT NOT NULL CHECK (
    completeness IN ('complete', 'partial', 'provisional')
  ),
  note TEXT CHECK (note IS NULL OR length(note) BETWEEN 1 AND 500),
  source_sheet TEXT NOT NULL CHECK (length(btrim(source_sheet)) BETWEEN 1 AND 200),
  source_range TEXT NOT NULL CHECK (length(btrim(source_range)) BETWEEN 1 AND 500),
  published_at TIMESTAMPTZ NOT NULL CHECK (isfinite(published_at)),
  superseded_at TIMESTAMPTZ CHECK (
    superseded_at IS NULL OR isfinite(superseded_at)
  ),
  superseded_by_import_id UUID REFERENCES public.store_financial_imports(id)
    ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now() CHECK (isfinite(created_at)),
  FOREIGN KEY (import_id, user_id, company_id)
    REFERENCES public.store_financial_imports(id, user_id, company_id) ON DELETE CASCADE,
  UNIQUE (import_id, scope_key),
  CONSTRAINT store_financial_periods_month_end CHECK (
    period_end = (period_month + INTERVAL '1 month - 1 day')::DATE
  ),
  CONSTRAINT store_financial_periods_scope_month CHECK (
    scope_key = 'month:' || to_char(period_month, 'YYYY-MM')
  ),
  CONSTRAINT store_financial_periods_gross_profit CHECK (
    gross_profit = revenue - cost_amount
  ),
  CONSTRAINT store_financial_periods_gross_margin CHECK (
    (revenue = 0 AND gross_margin_pct IS NULL)
    OR (revenue <> 0 AND gross_margin_pct = round(gross_profit / revenue * 100, 4))
  ),
  CONSTRAINT store_financial_periods_pnl_bundle CHECK (
    (
      reported_gross_profit IS NULL
      AND gross_profit_reconciliation_delta IS NULL
      AND period_expenses IS NULL
      AND bonuses IS NULL
      AND write_offs IS NULL
      AND ebitda IS NULL
      AND ebitda_margin_pct IS NULL
    )
    OR (
      reported_gross_profit IS NOT NULL
      AND gross_profit_reconciliation_delta IS NOT NULL
      AND abs(gross_profit_reconciliation_delta) <= 1.00
      AND gross_profit_reconciliation_delta = reported_gross_profit - gross_profit
      AND period_expenses IS NOT NULL AND period_expenses >= 0
      AND bonuses IS NOT NULL AND bonuses >= 0 AND bonuses <= period_expenses
      AND write_offs IS NOT NULL AND write_offs >= 0 AND write_offs <= period_expenses
      AND ebitda IS NOT NULL AND ebitda = reported_gross_profit - period_expenses
      AND revenue <> 0
      AND ebitda_margin_pct IS NOT NULL
      AND ebitda_margin_pct = round(ebitda / revenue * 100, 4)
    )
  ),
  CONSTRAINT store_financial_periods_supersession_state CHECK (
    (superseded_at IS NULL AND superseded_by_import_id IS NULL)
    OR (superseded_at IS NOT NULL AND superseded_by_import_id IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_store_financial_imports_owner_published
  ON public.store_financial_imports (user_id, company_id, published_at DESC)
  WHERE status = 'published';
CREATE INDEX IF NOT EXISTS idx_store_financial_periods_owner_month
  ON public.store_financial_periods (user_id, company_id, period_month DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_store_financial_periods_current_scope
  ON public.store_financial_periods (user_id, company_id, scope_key)
  WHERE superseded_at IS NULL;

DROP TRIGGER IF EXISTS store_financial_imports_company_owner
  ON public.store_financial_imports;
CREATE TRIGGER store_financial_imports_company_owner
  BEFORE INSERT OR UPDATE OF user_id, company_id
  ON public.store_financial_imports
  FOR EACH ROW EXECUTE FUNCTION public.store_enforce_company_owner();

DROP TRIGGER IF EXISTS store_financial_periods_company_owner
  ON public.store_financial_periods;
CREATE TRIGGER store_financial_periods_company_owner
  BEFORE INSERT OR UPDATE OF user_id, company_id
  ON public.store_financial_periods
  FOR EACH ROW EXECUTE FUNCTION public.store_enforce_company_owner();

ALTER TABLE public.store_financial_imports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.store_financial_periods ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.store_financial_imports
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.store_financial_periods
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.store_financial_imports TO authenticated, service_role;
GRANT SELECT ON TABLE public.store_financial_periods TO authenticated, service_role;

DROP POLICY IF EXISTS store_financial_imports_owner_published_read
  ON public.store_financial_imports;
CREATE POLICY store_financial_imports_owner_published_read
  ON public.store_financial_imports
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id AND status = 'published');

DROP POLICY IF EXISTS store_financial_periods_owner_current_read
  ON public.store_financial_periods;
CREATE POLICY store_financial_periods_owner_current_read
  ON public.store_financial_periods
  FOR SELECT TO authenticated
  USING (
    auth.uid() = user_id
    AND superseded_at IS NULL
    AND EXISTS (
      SELECT 1
       FROM public.store_financial_imports AS financial_import
       WHERE financial_import.id = store_financial_periods.import_id
         AND financial_import.user_id = store_financial_periods.user_id
         AND financial_import.company_id = store_financial_periods.company_id
         AND financial_import.status = 'published'
    )
  );

CREATE OR REPLACE FUNCTION public.publish_store_financial_import(
  p_user_id UUID,
  p_company_id TEXT,
  p_source_sha256 TEXT,
  p_source_file_name TEXT,
  p_source_size_bytes INTEGER,
  p_schema_version INTEGER,
  p_idempotency_key UUID,
  p_manifest_sha256 TEXT,
  p_scope_key TEXT,
  p_period_start DATE,
  p_period_end DATE,
  p_warning_count INTEGER,
  p_quarantined_count INTEGER,
  p_rows JSONB
)
RETURNS TABLE (
  outcome TEXT,
  import_run_id UUID,
  status TEXT,
  import_kind TEXT,
  scope_key TEXT,
  row_count INTEGER,
  published_at TIMESTAMPTZ,
  superseded_run_id UUID
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_company_id TEXT := btrim(p_company_id);
  v_now TIMESTAMPTZ;
  v_row_count INTEGER;
  v_item JSONB;
  v_field TEXT;
  v_period_month DATE;
  v_period_end DATE;
  v_min_month DATE;
  v_max_end DATE;
  v_revenue NUMERIC;
  v_cost NUMERIC;
  v_gross NUMERIC;
  v_gross_margin NUMERIC;
  v_reported_gross NUMERIC;
  v_reconciliation_delta NUMERIC;
  v_expenses NUMERIC;
  v_bonuses NUMERIC;
  v_write_offs NUMERIC;
  v_ebitda NUMERIC;
  v_ebitda_margin NUMERIC;
  v_run public.store_financial_imports%ROWTYPE;
  v_existing public.store_financial_imports%ROWTYPE;
  v_rows_fingerprint TEXT;
  v_superseded_ids UUID[];
  v_superseded_run_id UUID;
  v_inserted INTEGER;
  v_current_period_count INTEGER;
BEGIN
  IF p_user_id IS NULL
     OR p_company_id IS NULL
     OR length(v_company_id) NOT BETWEEN 1 AND 200
     OR p_source_sha256 IS NULL OR p_source_sha256 !~ '^[a-f0-9]{64}$'
     OR p_source_file_name IS NULL
     OR p_source_file_name !~ '^store-import-[a-f0-9]{12}\.(xls|xlsx|csv)$'
     OR p_source_size_bytes IS NULL OR p_source_size_bytes NOT BETWEEN 1 AND 10485760
     OR p_schema_version IS DISTINCT FROM 1
     OR p_idempotency_key IS NULL
     OR p_idempotency_key::TEXT !~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     OR p_manifest_sha256 IS NULL OR p_manifest_sha256 !~ '^[a-f0-9]{64}$'
     OR p_scope_key IS NULL OR length(btrim(p_scope_key)) NOT BETWEEN 1 AND 160
     OR p_period_start IS NULL OR p_period_end IS NULL OR p_period_end < p_period_start
     OR p_warning_count IS NULL OR p_warning_count NOT BETWEEN 0 AND 10000
     OR p_quarantined_count IS NULL OR p_quarantined_count NOT BETWEEN 0 AND 10000
     OR p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array'
     OR pg_column_size(p_rows) > 16777216 THEN
    RAISE EXCEPTION 'invalid store financial publication envelope'
      USING ERRCODE = '22023';
  END IF;

  v_row_count := jsonb_array_length(p_rows);
  v_rows_fingerprint := md5(p_rows::TEXT);
  IF v_row_count NOT BETWEEN 1 AND 10000
     OR v_row_count + p_quarantined_count > 10000 THEN
    RAISE EXCEPTION 'invalid store financial publication row count'
      USING ERRCODE = '22023';
  END IF;

  FOR v_item IN SELECT item.value FROM jsonb_array_elements(p_rows) AS item(value)
  LOOP
    IF jsonb_typeof(v_item) <> 'object'
       OR NOT (v_item ?& ARRAY[
         'scopeKey', 'periodStart', 'periodEnd', 'granularity', 'currency',
         'revenueBasis', 'revenue', 'costAmount', 'grossProfit', 'grossMarginPct',
         'reportedGrossProfit', 'grossProfitReconciliationDelta', 'periodExpenses',
         'bonuses', 'writeOffs', 'ebitda', 'ebitdaMarginPct', 'completeness',
         'note', 'sourceSheet', 'sourceRange'
       ])
       OR EXISTS (
         SELECT 1 FROM jsonb_object_keys(v_item) AS field(key)
          WHERE NOT (field.key = ANY (ARRAY[
            'scopeKey', 'periodStart', 'periodEnd', 'granularity', 'currency',
            'revenueBasis', 'revenue', 'costAmount', 'grossProfit', 'grossMarginPct',
            'reportedGrossProfit', 'grossProfitReconciliationDelta', 'periodExpenses',
            'bonuses', 'writeOffs', 'ebitda', 'ebitdaMarginPct', 'completeness',
            'note', 'sourceSheet', 'sourceRange'
          ]))
       ) THEN
      RAISE EXCEPTION 'invalid store financial row shape' USING ERRCODE = '22023';
    END IF;

    FOREACH v_field IN ARRAY ARRAY[
      'scopeKey', 'periodStart', 'periodEnd', 'granularity', 'currency',
      'revenueBasis', 'completeness', 'sourceSheet', 'sourceRange'
    ] LOOP
      IF jsonb_typeof(v_item -> v_field) <> 'string' THEN
        RAISE EXCEPTION 'invalid store financial text field' USING ERRCODE = '22023';
      END IF;
    END LOOP;
    IF jsonb_typeof(v_item -> 'note') NOT IN ('string', 'null') THEN
      RAISE EXCEPTION 'invalid store financial note' USING ERRCODE = '22023';
    END IF;

    BEGIN
      v_period_month := (v_item ->> 'periodStart')::DATE;
      v_period_end := (v_item ->> 'periodEnd')::DATE;
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'invalid store financial period date' USING ERRCODE = '22023';
    END;
    IF v_period_month::TEXT IS DISTINCT FROM (v_item ->> 'periodStart')
       OR v_period_end::TEXT IS DISTINCT FROM (v_item ->> 'periodEnd')
       OR EXTRACT(DAY FROM v_period_month) <> 1
       OR v_period_end IS DISTINCT FROM (v_period_month + INTERVAL '1 month - 1 day')::DATE
       OR (v_item ->> 'scopeKey') IS DISTINCT FROM 'month:' || to_char(v_period_month, 'YYYY-MM')
       OR (v_item ->> 'granularity') IS DISTINCT FROM 'month'
       OR (v_item ->> 'currency') IS DISTINCT FROM 'KZT'
       OR (v_item ->> 'revenueBasis') IS DISTINCT FROM 'net_after_discounts_returns'
       OR (v_item ->> 'completeness') NOT IN ('complete', 'partial', 'provisional')
       OR length(v_item ->> 'sourceSheet') NOT BETWEEN 1 AND 200
       OR (v_item ->> 'sourceSheet') IS DISTINCT FROM btrim(v_item ->> 'sourceSheet')
       OR length(v_item ->> 'sourceRange') NOT BETWEEN 1 AND 500
       OR (v_item ->> 'sourceRange') IS DISTINCT FROM btrim(v_item ->> 'sourceRange')
       OR (
         jsonb_typeof(v_item -> 'note') = 'string'
         AND length(v_item ->> 'note') NOT BETWEEN 1 AND 500
       ) THEN
      RAISE EXCEPTION 'invalid store financial period identity' USING ERRCODE = '22023';
    END IF;

    FOREACH v_field IN ARRAY ARRAY['revenue', 'costAmount', 'grossProfit']
    LOOP
      IF jsonb_typeof(v_item -> v_field) <> 'number' THEN
        RAISE EXCEPTION 'invalid store financial amount type' USING ERRCODE = '22023';
      END IF;
      IF (v_item ->> v_field)::NUMERIC IS DISTINCT FROM trunc((v_item ->> v_field)::NUMERIC, 2)
         OR abs((v_item ->> v_field)::NUMERIC) > 9999999999999999.99 THEN
        RAISE EXCEPTION 'invalid store financial amount precision' USING ERRCODE = '22023';
      END IF;
    END LOOP;
    v_revenue := (v_item ->> 'revenue')::NUMERIC;
    v_cost := (v_item ->> 'costAmount')::NUMERIC;
    v_gross := (v_item ->> 'grossProfit')::NUMERIC;
    IF v_revenue < 0 OR v_cost < 0 OR v_gross IS DISTINCT FROM v_revenue - v_cost THEN
      RAISE EXCEPTION 'invalid store financial gross profit' USING ERRCODE = '22023';
    END IF;

    IF v_revenue = 0 THEN
      IF jsonb_typeof(v_item -> 'grossMarginPct') <> 'null' THEN
        RAISE EXCEPTION 'invalid zero-revenue gross margin' USING ERRCODE = '22023';
      END IF;
    ELSE
      IF jsonb_typeof(v_item -> 'grossMarginPct') <> 'number' THEN
        RAISE EXCEPTION 'invalid gross margin type' USING ERRCODE = '22023';
      END IF;
      v_gross_margin := (v_item ->> 'grossMarginPct')::NUMERIC;
      IF v_gross_margin IS DISTINCT FROM trunc(v_gross_margin, 4)
         OR v_gross_margin IS DISTINCT FROM round(v_gross / v_revenue * 100, 4) THEN
        RAISE EXCEPTION 'invalid store financial gross margin' USING ERRCODE = '22023';
      END IF;
    END IF;

    IF jsonb_typeof(v_item -> 'reportedGrossProfit') = 'null' THEN
      FOREACH v_field IN ARRAY ARRAY[
        'grossProfitReconciliationDelta', 'periodExpenses', 'bonuses',
        'writeOffs', 'ebitda', 'ebitdaMarginPct'
      ] LOOP
        IF jsonb_typeof(v_item -> v_field) <> 'null' THEN
          RAISE EXCEPTION 'partial store financial P&L bundle' USING ERRCODE = '22023';
        END IF;
      END LOOP;
    ELSE
      FOREACH v_field IN ARRAY ARRAY[
        'reportedGrossProfit', 'grossProfitReconciliationDelta', 'periodExpenses',
        'bonuses', 'writeOffs', 'ebitda'
      ] LOOP
        IF jsonb_typeof(v_item -> v_field) <> 'number'
           OR (v_item ->> v_field)::NUMERIC IS DISTINCT FROM trunc((v_item ->> v_field)::NUMERIC, 2)
           OR abs((v_item ->> v_field)::NUMERIC) > 9999999999999999.99 THEN
          RAISE EXCEPTION 'invalid store financial P&L amount' USING ERRCODE = '22023';
        END IF;
      END LOOP;
      IF jsonb_typeof(v_item -> 'ebitdaMarginPct') <> 'number' OR v_revenue = 0 THEN
        RAISE EXCEPTION 'invalid store financial EBITDA margin' USING ERRCODE = '22023';
      END IF;

      v_reported_gross := (v_item ->> 'reportedGrossProfit')::NUMERIC;
      v_reconciliation_delta := (v_item ->> 'grossProfitReconciliationDelta')::NUMERIC;
      v_expenses := (v_item ->> 'periodExpenses')::NUMERIC;
      v_bonuses := (v_item ->> 'bonuses')::NUMERIC;
      v_write_offs := (v_item ->> 'writeOffs')::NUMERIC;
      v_ebitda := (v_item ->> 'ebitda')::NUMERIC;
      v_ebitda_margin := (v_item ->> 'ebitdaMarginPct')::NUMERIC;
      IF v_reconciliation_delta IS DISTINCT FROM v_reported_gross - v_gross
         OR abs(v_reconciliation_delta) > 1.00
         OR v_expenses < 0 OR v_bonuses < 0 OR v_write_offs < 0
         OR v_bonuses > v_expenses OR v_write_offs > v_expenses
         OR v_ebitda IS DISTINCT FROM v_reported_gross - v_expenses
         OR v_ebitda_margin IS DISTINCT FROM trunc(v_ebitda_margin, 4)
         OR v_ebitda_margin IS DISTINCT FROM round(v_ebitda / v_revenue * 100, 4) THEN
        RAISE EXCEPTION 'inconsistent store financial P&L' USING ERRCODE = '22023';
      END IF;
    END IF;
  END LOOP;

  IF (
    SELECT count(DISTINCT item.value ->> 'scopeKey')
      FROM jsonb_array_elements(p_rows) AS item(value)
  ) IS DISTINCT FROM v_row_count THEN
    RAISE EXCEPTION 'duplicate store financial month' USING ERRCODE = '22023';
  END IF;

  SELECT min((item.value ->> 'periodStart')::DATE),
         max((item.value ->> 'periodEnd')::DATE)
    INTO v_min_month, v_max_end
    FROM jsonb_array_elements(p_rows) AS item(value);
  IF p_period_start IS DISTINCT FROM v_min_month
     OR p_period_end IS DISTINCT FROM v_max_end
     OR v_row_count IS DISTINCT FROM (
       SELECT count(*)::INTEGER
         FROM generate_series(
           v_min_month,
           date_trunc('month', v_max_end)::DATE,
           INTERVAL '1 month'
         )
     )
     OR p_scope_key IS DISTINCT FROM (
       'management_period:' || to_char(v_min_month, 'YYYY-MM') || ':' ||
       to_char(v_max_end, 'YYYY-MM')
     ) THEN
    RAISE EXCEPTION 'invalid store financial publication scope' USING ERRCODE = '22023';
  END IF;

  -- Lock before taking the publication advisory lock. Company DELETE/owner
  -- UPDATE obtains the same row lock first, keeping lock order deterministic.
  PERFORM company.id
    FROM public.companies AS company
   WHERE company.id::TEXT = v_company_id
     AND company.user_id = p_user_id
   FOR SHARE OF company;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'invalid store financial owner binding'
      USING ERRCODE = '42501';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(
    p_user_id::TEXT || ':' || v_company_id || ':store-financial-publication', 0
  ));
  -- Publication time is captured only after serialization. This guarantees a
  -- superseding import can never receive an older timestamp than the import it
  -- replaces merely because its validation started earlier.
  v_now := clock_timestamp();

  SELECT financial_import.* INTO v_existing
    FROM public.store_financial_imports AS financial_import
   WHERE financial_import.user_id = p_user_id
     AND financial_import.company_id = v_company_id
     AND (
       financial_import.idempotency_key = p_idempotency_key
       OR financial_import.manifest_sha256 = p_manifest_sha256
     )
   ORDER BY (financial_import.idempotency_key = p_idempotency_key) DESC
   LIMIT 1
   FOR UPDATE;
  IF FOUND THEN
    IF v_existing.source_sha256 IS DISTINCT FROM p_source_sha256
       OR v_existing.source_file_label IS DISTINCT FROM p_source_file_name
       OR v_existing.source_size_bytes IS DISTINCT FROM p_source_size_bytes
       OR v_existing.schema_version IS DISTINCT FROM p_schema_version
       OR v_existing.manifest_sha256 IS DISTINCT FROM p_manifest_sha256
       OR v_existing.rows_fingerprint_md5 IS DISTINCT FROM v_rows_fingerprint
       OR v_existing.scope_key IS DISTINCT FROM p_scope_key
       OR v_existing.period_start IS DISTINCT FROM p_period_start
       OR v_existing.period_end IS DISTINCT FROM p_period_end
       OR v_existing.row_count IS DISTINCT FROM v_row_count
       OR v_existing.warning_count IS DISTINCT FROM p_warning_count
       OR v_existing.quarantined_count IS DISTINCT FROM p_quarantined_count
       OR v_existing.status IS DISTINCT FROM 'published'
       OR v_existing.published_at IS NULL THEN
      RAISE EXCEPTION 'store financial idempotency conflict' USING ERRCODE = 'P0002';
    END IF;
    SELECT count(*)::INTEGER
      INTO v_current_period_count
      FROM public.store_financial_periods AS period
     WHERE period.import_id = v_existing.id
       AND period.user_id = p_user_id
       AND period.company_id = v_company_id
       AND period.superseded_at IS NULL;
    IF v_current_period_count IS DISTINCT FROM v_existing.row_count THEN
      -- A previously superseded manifest is an audit-history fact, not a
      -- current snapshot. Restoring it requires a separately reviewed source
      -- release with a new semantic manifest; never claim it is current.
      RAISE EXCEPTION 'store financial manifest is superseded; publish a new audited release'
        USING ERRCODE = 'P0002';
    END IF;
    RETURN QUERY SELECT
      'duplicate'::TEXT, v_existing.id, v_existing.status,
      'management_period'::TEXT, v_existing.scope_key, v_existing.row_count,
      v_existing.published_at, NULL::UUID;
    RETURN;
  END IF;

  INSERT INTO public.store_financial_imports (
    user_id, company_id, source_sha256, source_file_label, source_size_bytes,
    schema_version, idempotency_key, manifest_sha256, rows_fingerprint_md5,
    scope_key, period_start, period_end, row_count, warning_count,
    quarantined_count, status
  ) VALUES (
    p_user_id, v_company_id, p_source_sha256, p_source_file_name,
    p_source_size_bytes, p_schema_version, p_idempotency_key, p_manifest_sha256,
    v_rows_fingerprint, p_scope_key, p_period_start, p_period_end, v_row_count,
    p_warning_count, p_quarantined_count, 'validated'
  ) RETURNING * INTO v_run;

  SELECT array_agg(DISTINCT period.import_id)
    INTO v_superseded_ids
    FROM public.store_financial_periods AS period
   WHERE period.user_id = p_user_id
     AND period.company_id = v_company_id
     AND period.superseded_at IS NULL
     AND period.scope_key IN (
       SELECT item.value ->> 'scopeKey'
         FROM jsonb_array_elements(p_rows) AS item(value)
     );
  IF cardinality(v_superseded_ids) = 1 THEN
    v_superseded_run_id := v_superseded_ids[1];
  END IF;

  UPDATE public.store_financial_periods AS period
     SET superseded_at = v_now,
         superseded_by_import_id = v_run.id
   WHERE period.user_id = p_user_id
     AND period.company_id = v_company_id
     AND period.superseded_at IS NULL
     AND period.scope_key IN (
       SELECT item.value ->> 'scopeKey'
         FROM jsonb_array_elements(p_rows) AS item(value)
     );

  INSERT INTO public.store_financial_periods (
    import_id, user_id, company_id, scope_key, period_month, period_end,
    granularity, currency, revenue_basis, revenue, cost_amount, gross_profit,
    gross_margin_pct, reported_gross_profit, gross_profit_reconciliation_delta,
    period_expenses, bonuses, write_offs, ebitda, ebitda_margin_pct,
    completeness, note, source_sheet, source_range, published_at
  )
  SELECT
    v_run.id, p_user_id, v_company_id,
    item.value ->> 'scopeKey', (item.value ->> 'periodStart')::DATE,
    (item.value ->> 'periodEnd')::DATE, item.value ->> 'granularity',
    item.value ->> 'currency', item.value ->> 'revenueBasis',
    (item.value ->> 'revenue')::NUMERIC,
    (item.value ->> 'costAmount')::NUMERIC,
    (item.value ->> 'grossProfit')::NUMERIC,
    NULLIF(item.value ->> 'grossMarginPct', '')::NUMERIC,
    NULLIF(item.value ->> 'reportedGrossProfit', '')::NUMERIC,
    NULLIF(item.value ->> 'grossProfitReconciliationDelta', '')::NUMERIC,
    NULLIF(item.value ->> 'periodExpenses', '')::NUMERIC,
    NULLIF(item.value ->> 'bonuses', '')::NUMERIC,
    NULLIF(item.value ->> 'writeOffs', '')::NUMERIC,
    NULLIF(item.value ->> 'ebitda', '')::NUMERIC,
    NULLIF(item.value ->> 'ebitdaMarginPct', '')::NUMERIC,
    item.value ->> 'completeness', NULLIF(item.value ->> 'note', ''),
    item.value ->> 'sourceSheet', item.value ->> 'sourceRange', v_now
  FROM jsonb_array_elements(p_rows) AS item(value);
  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  IF v_inserted IS DISTINCT FROM v_row_count THEN
    RAISE EXCEPTION 'store financial fact count mismatch' USING ERRCODE = '22023';
  END IF;

  UPDATE public.store_financial_imports
     SET status = 'published', published_at = v_now
   WHERE id = v_run.id
   RETURNING * INTO v_run;

  RETURN QUERY SELECT
    'published'::TEXT, v_run.id, v_run.status, 'management_period'::TEXT,
    v_run.scope_key, v_run.row_count, v_run.published_at, v_superseded_run_id;
END;
$$;

REVOKE ALL ON FUNCTION public.publish_store_financial_import(
  UUID, TEXT, TEXT, TEXT, INTEGER, INTEGER, UUID, TEXT, TEXT, DATE, DATE,
  INTEGER, INTEGER, JSONB
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.publish_store_financial_import(
  UUID, TEXT, TEXT, TEXT, INTEGER, INTEGER, UUID, TEXT, TEXT, DATE, DATE,
  INTEGER, INTEGER, JSONB
) TO service_role;

CREATE OR REPLACE FUNCTION public.store_cleanup_financial_company()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_company_id TEXT := btrim(OLD.id::TEXT);
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(
    OLD.user_id::TEXT || ':' || v_company_id || ':store-financial-publication', 0
  ));

  -- Delete periods explicitly before imports. This is deterministic even
  -- when historical rows reference a newer superseding import.
  DELETE FROM public.store_financial_periods AS period
   WHERE period.user_id = OLD.user_id
     AND period.company_id = v_company_id;

  DELETE FROM public.store_financial_imports AS financial_import
   WHERE financial_import.user_id = OLD.user_id
     AND financial_import.company_id = v_company_id;
  RETURN OLD;
END;
$$;

REVOKE ALL ON FUNCTION public.store_cleanup_financial_company()
  FROM PUBLIC, anon, authenticated, service_role;
DROP TRIGGER IF EXISTS store_cleanup_financial_company_before_delete
  ON public.companies;
CREATE TRIGGER store_cleanup_financial_company_before_delete
  BEFORE DELETE ON public.companies
  FOR EACH ROW EXECUTE FUNCTION public.store_cleanup_financial_company();

-- Moving an existing company to another owner/id would invalidate the
-- portable TEXT owner binding. Require an explicit export/delete/re-import
-- instead of silently orphaning financial history.
CREATE OR REPLACE FUNCTION public.store_guard_financial_company_identity()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_company_id TEXT := btrim(OLD.id::TEXT);
BEGIN
  IF NEW.id::TEXT IS DISTINCT FROM OLD.id::TEXT
     OR NEW.user_id IS DISTINCT FROM OLD.user_id THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(
      OLD.user_id::TEXT || ':' || v_company_id || ':store-financial-publication', 0
    ));
    IF EXISTS (
      SELECT 1
        FROM public.store_financial_imports AS financial_import
       WHERE financial_import.user_id = OLD.user_id
         AND financial_import.company_id = v_company_id
    ) THEN
      RAISE EXCEPTION 'cannot change company identity while Store financial history exists'
        USING ERRCODE = '23503';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.store_guard_financial_company_identity()
  FROM PUBLIC, anon, authenticated, service_role;
DROP TRIGGER IF EXISTS store_guard_financial_company_identity_before_update
  ON public.companies;
CREATE TRIGGER store_guard_financial_company_identity_before_update
  BEFORE UPDATE OF id, user_id ON public.companies
  FOR EACH ROW EXECUTE FUNCTION public.store_guard_financial_company_identity();
