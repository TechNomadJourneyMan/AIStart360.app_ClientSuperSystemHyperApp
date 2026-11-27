-- Store Control Center: atomic, idempotent publication of normalized imports.
--
-- The browser never receives write privileges. A trusted route re-parses the
-- source file, derives every ownership/scope field and calls the service-only
-- RPC below. PostgreSQL independently checks the normalized rows before making
-- a new import visible. The function call is one transaction, so reference
-- upserts, facts, supersession and publication either all commit or all roll
-- back.

-- SECURITY DEFINER functions below never resolve application objects through
-- public. Browser roles must not be able to plant shadow objects there either.
REVOKE CREATE ON SCHEMA public FROM PUBLIC, anon, authenticated;

ALTER FUNCTION public.store_enforce_company_owner()
  SET search_path = pg_catalog, pg_temp;

ALTER TABLE public.store_import_runs
  ADD COLUMN IF NOT EXISTS source_file_name TEXT,
  ADD COLUMN IF NOT EXISTS source_size_bytes INTEGER,
  ADD COLUMN IF NOT EXISTS idempotency_key UUID,
  ADD COLUMN IF NOT EXISTS manifest_sha256 TEXT,
  ADD COLUMN IF NOT EXISTS quarantined_count INTEGER NOT NULL DEFAULT 0;

-- Phase 1 deduplicated only by raw bytes. Publication semantics also include
-- the confirmed snapshot date and normalized configuration in manifest_sha256,
-- so the same reusable inventory template may legitimately be published for a
-- later date. Resolve the legacy constraint by its exact ordered columns; its
-- generated name is not stable across reconciled production schemas.
DO $$
DECLARE
  constraint_name TEXT;
BEGIN
  FOR constraint_name IN
    SELECT constraint_row.conname
      FROM pg_constraint AS constraint_row
     WHERE constraint_row.conrelid = 'public.store_import_runs'::regclass
       AND constraint_row.contype = 'u'
       AND ARRAY(
         SELECT attribute.attname::TEXT
           FROM unnest(constraint_row.conkey)
             WITH ORDINALITY AS constrained_column(attnum, position)
           JOIN pg_attribute AS attribute
             ON attribute.attrelid = constraint_row.conrelid
            AND attribute.attnum = constrained_column.attnum
          ORDER BY constrained_column.position
       ) = ARRAY['user_id', 'company_id', 'import_kind', 'source_sha256']::TEXT[]
  LOOP
    EXECUTE format(
      'ALTER TABLE public.store_import_runs DROP CONSTRAINT %I',
      constraint_name
    );
  END LOOP;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conrelid = 'public.store_import_runs'::regclass
       AND conname = 'store_import_runs_source_file_name'
  ) THEN
    ALTER TABLE public.store_import_runs
      ADD CONSTRAINT store_import_runs_source_file_name CHECK (
        source_file_name IS NULL
        OR length(btrim(source_file_name)) BETWEEN 1 AND 255
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conrelid = 'public.store_import_runs'::regclass
       AND conname = 'store_import_runs_source_size_bytes'
  ) THEN
    ALTER TABLE public.store_import_runs
      ADD CONSTRAINT store_import_runs_source_size_bytes CHECK (
        source_size_bytes IS NULL
        OR source_size_bytes BETWEEN 1 AND 10485760
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conrelid = 'public.store_import_runs'::regclass
       AND conname = 'store_import_runs_manifest_sha256'
  ) THEN
    ALTER TABLE public.store_import_runs
      ADD CONSTRAINT store_import_runs_manifest_sha256 CHECK (
        manifest_sha256 IS NULL OR manifest_sha256 ~ '^[a-f0-9]{64}$'
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conrelid = 'public.store_import_runs'::regclass
       AND conname = 'store_import_runs_quarantined_count'
  ) THEN
    ALTER TABLE public.store_import_runs
      ADD CONSTRAINT store_import_runs_quarantined_count CHECK (
        quarantined_count >= 0
      );
  END IF;
END;
$$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_store_import_runs_owner_idempotency
  ON public.store_import_runs (user_id, company_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_store_import_runs_owner_manifest
  ON public.store_import_runs (user_id, company_id, manifest_sha256)
  WHERE manifest_sha256 IS NOT NULL;

-- Variant identity is based on the complete normalized product name, not the
-- source SKU. HONOR price files can synthesize an SKU while inventory files
-- provide a supplier article for the same size/color variant.
CREATE UNIQUE INDEX IF NOT EXISTS idx_store_variants_owner_variant_key
  ON public.store_product_variants (user_id, company_id, variant_key);

CREATE TABLE IF NOT EXISTS public.store_import_variant_mappings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  import_run_id UUID NOT NULL,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  company_id TEXT NOT NULL CHECK (length(btrim(company_id)) BETWEEN 1 AND 200),
  source_sku TEXT NOT NULL CHECK (length(btrim(source_sku)) BETWEEN 1 AND 160),
  source_name TEXT NOT NULL CHECK (length(btrim(source_name)) BETWEEN 1 AND 300),
  source_variant_key TEXT NOT NULL CHECK (
    source_variant_key ~ '^name-v1:[a-f0-9]{64}$'
  ),
  variant_id UUID NOT NULL,
  resolution_method TEXT NOT NULL CHECK (
    resolution_method IN ('existing', 'created')
  ),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now() CHECK (isfinite(created_at)),
  FOREIGN KEY (import_run_id, user_id, company_id)
    REFERENCES public.store_import_runs(id, user_id, company_id) ON DELETE CASCADE,
  FOREIGN KEY (variant_id, user_id, company_id)
    REFERENCES public.store_product_variants(id, user_id, company_id) ON DELETE RESTRICT,
  UNIQUE (import_run_id, source_sku, source_variant_key)
);

CREATE INDEX IF NOT EXISTS idx_store_import_variant_mappings_owner_run
  ON public.store_import_variant_mappings (user_id, company_id, import_run_id);

DROP TRIGGER IF EXISTS store_import_variant_mappings_company_owner
  ON public.store_import_variant_mappings;
CREATE TRIGGER store_import_variant_mappings_company_owner
  BEFORE INSERT OR UPDATE ON public.store_import_variant_mappings
  FOR EACH ROW EXECUTE FUNCTION public.store_enforce_company_owner();

ALTER TABLE public.store_import_variant_mappings ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.store_import_variant_mappings
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.store_import_variant_mappings TO authenticated;
GRANT SELECT ON TABLE public.store_import_variant_mappings TO service_role;

DROP POLICY IF EXISTS store_import_variant_mappings_owner_read
  ON public.store_import_variant_mappings;
CREATE POLICY store_import_variant_mappings_owner_read
  ON public.store_import_variant_mappings
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

-- Close a Phase 1 ownership gap: a product link must belong to both the same
-- owner and the same company. Re-run this check when company_id itself changes.
CREATE OR REPLACE FUNCTION public.store_enforce_ecommerce_product_owner()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF NEW.ecommerce_product_id IS NOT NULL
     AND NOT EXISTS (
       SELECT 1
         FROM public.ecommerce_products AS product
        WHERE product.id = NEW.ecommerce_product_id
          AND product.user_id = NEW.user_id
          AND product.company_id = btrim(NEW.company_id)
     ) THEN
    RAISE EXCEPTION 'invalid store ecommerce product binding'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.store_enforce_ecommerce_product_owner()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS store_product_variants_ecommerce_owner
  ON public.store_product_variants;
CREATE TRIGGER store_product_variants_ecommerce_owner
  BEFORE INSERT OR UPDATE OF ecommerce_product_id, user_id, company_id
  ON public.store_product_variants
  FOR EACH ROW EXECUTE FUNCTION public.store_enforce_ecommerce_product_owner();

CREATE OR REPLACE FUNCTION public.publish_store_import(
  p_user_id UUID,
  p_company_id TEXT,
  p_source_sha256 TEXT,
  p_source_file_name TEXT,
  p_source_size_bytes INTEGER,
  p_schema_version INTEGER,
  p_idempotency_key UUID,
  p_manifest_sha256 TEXT,
  p_import_kind TEXT,
  p_scope_key TEXT,
  p_effective_date DATE,
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
  v_now TIMESTAMPTZ := clock_timestamp();
  v_row_count INTEGER;
  v_inserted INTEGER;
  v_existing public.store_import_runs%ROWTYPE;
  v_run public.store_import_runs%ROWTYPE;
  v_superseded_run_id UUID;
  v_item JSONB;
  v_field TEXT;
  v_variant_key TEXT;
  v_sku TEXT;
  v_name TEXT;
  v_normalized_name TEXT;
  v_snapshot_date DATE;
  v_occurred_on DATE;
  v_min_date DATE;
  v_max_date DATE;
  v_sales_month TEXT;
  v_row_month TEXT;
  v_warehouse_code TEXT;
  v_normalized_warehouse_code TEXT;
  v_warehouse_name TEXT;
  v_warehouse_kind TEXT;
  v_inventory_warehouse_code TEXT;
  v_inventory_warehouse_name TEXT;
  v_inventory_warehouse_kind TEXT;
  v_channel TEXT;
  v_external_line_id TEXT;
  v_number NUMERIC;
  v_quantity NUMERIC;
  v_list_amount NUMERIC;
  v_net_revenue NUMERIC;
  v_cost_amount NUMERIC;
  v_discount_amount NUMERIC;
  v_has_price BOOLEAN;
BEGIN
  -- Validate the small envelope before touching any business table.
  IF p_user_id IS NULL
     OR p_company_id IS NULL
     OR length(v_company_id) NOT BETWEEN 1 AND 200
     OR p_source_sha256 IS NULL
     OR p_source_sha256 !~ '^[a-f0-9]{64}$'
     OR p_source_file_name IS NULL
     OR length(btrim(p_source_file_name)) NOT BETWEEN 1 AND 255
     OR strpos(p_source_file_name, '/') > 0
     OR strpos(p_source_file_name, chr(92)) > 0
     OR p_source_file_name ~ '[[:cntrl:]]'
     OR p_source_size_bytes IS NULL
     OR p_source_size_bytes NOT BETWEEN 1 AND 10485760
     OR p_schema_version IS DISTINCT FROM 1
     OR p_idempotency_key IS NULL
     OR p_idempotency_key::TEXT !~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     OR p_manifest_sha256 IS NULL
     OR p_manifest_sha256 !~ '^[a-f0-9]{64}$'
     OR p_import_kind IS NULL
     OR p_import_kind NOT IN ('prices', 'inventory', 'sales')
     OR p_scope_key IS NULL
     OR length(btrim(p_scope_key)) NOT BETWEEN 1 AND 160
     OR p_warning_count IS NULL
     OR p_warning_count NOT BETWEEN 0 AND 10000
     OR p_quarantined_count IS NULL
     OR p_quarantined_count NOT BETWEEN 0 AND 10000
     OR p_rows IS NULL
     OR jsonb_typeof(p_rows) <> 'array'
     OR pg_column_size(p_rows) > 16777216 THEN
    RAISE EXCEPTION 'invalid store publication envelope'
      USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM public.companies AS company
     WHERE company.id::TEXT = v_company_id
       AND company.user_id = p_user_id
  ) THEN
    RAISE EXCEPTION 'invalid store publication owner binding'
      USING ERRCODE = '42501';
  END IF;

  v_row_count := jsonb_array_length(p_rows);
  IF v_row_count NOT BETWEEN 1 AND 10000
     OR v_row_count + p_quarantined_count > 10000 THEN
    RAISE EXCEPTION 'invalid store publication row count'
      USING ERRCODE = '22023';
  END IF;

  -- Validate every row before acquiring the publication lock. This is also a
  -- second line of defence if trusted TypeScript normalization regresses.
  FOR v_item IN SELECT item.value FROM jsonb_array_elements(p_rows) AS item(value)
  LOOP
    IF jsonb_typeof(v_item) <> 'object'
       OR NOT (v_item ?& ARRAY['variantKey', 'sku', 'name', 'normalizedName'])
       OR jsonb_typeof(v_item -> 'variantKey') <> 'string'
       OR jsonb_typeof(v_item -> 'sku') <> 'string'
       OR jsonb_typeof(v_item -> 'name') <> 'string'
       OR jsonb_typeof(v_item -> 'normalizedName') <> 'string' THEN
      RAISE EXCEPTION 'invalid store publication variant row'
        USING ERRCODE = '22023';
    END IF;

    v_variant_key := v_item ->> 'variantKey';
    v_sku := v_item ->> 'sku';
    v_name := v_item ->> 'name';
    v_normalized_name := v_item ->> 'normalizedName';

    IF v_variant_key !~ '^name-v1:[a-f0-9]{64}$'
       OR v_variant_key IS DISTINCT FROM (
         'name-v1:' || encode(sha256(convert_to(v_normalized_name, 'UTF8')), 'hex')
       )
       OR length(btrim(v_sku)) NOT BETWEEN 1 AND 160
       OR length(btrim(v_name)) NOT BETWEEN 1 AND 300
       OR length(btrim(v_normalized_name)) NOT BETWEEN 1 AND 300
       OR v_sku IS DISTINCT FROM btrim(v_sku)
       OR v_name IS DISTINCT FROM btrim(v_name)
       OR v_normalized_name IS DISTINCT FROM btrim(v_normalized_name) THEN
      RAISE EXCEPTION 'invalid store publication variant identity'
        USING ERRCODE = '22023';
    END IF;

    IF p_import_kind = 'prices' THEN
      IF NOT (v_item ?& ARRAY[
           'snapshotDate', 'purchasePrice', 'retailPrice',
           'consignmentPrice', 'wholesale25Price', 'wholesale30Price'
         ])
         OR EXISTS (
           SELECT 1
             FROM jsonb_object_keys(v_item) AS field(key)
            WHERE NOT (field.key = ANY (ARRAY[
              'variantKey', 'sku', 'name', 'normalizedName', 'snapshotDate',
              'purchasePrice', 'retailPrice', 'consignmentPrice',
              'wholesale25Price', 'wholesale30Price'
            ]))
         )
         OR jsonb_typeof(v_item -> 'snapshotDate') <> 'string' THEN
        RAISE EXCEPTION 'invalid price publication row shape'
          USING ERRCODE = '22023';
      END IF;

      BEGIN
        v_snapshot_date := (v_item ->> 'snapshotDate')::DATE;
      EXCEPTION WHEN OTHERS THEN
        RAISE EXCEPTION 'invalid price snapshot date'
          USING ERRCODE = '22023';
      END;
      IF v_snapshot_date::TEXT IS DISTINCT FROM (v_item ->> 'snapshotDate')
         OR v_snapshot_date IS DISTINCT FROM p_effective_date THEN
        RAISE EXCEPTION 'price snapshot date mismatch'
          USING ERRCODE = '22023';
      END IF;

      v_has_price := FALSE;
      FOREACH v_field IN ARRAY ARRAY[
        'purchasePrice', 'retailPrice', 'consignmentPrice',
        'wholesale25Price', 'wholesale30Price'
      ] LOOP
        IF jsonb_typeof(v_item -> v_field) NOT IN ('number', 'null') THEN
          RAISE EXCEPTION 'invalid price value type'
            USING ERRCODE = '22023';
        END IF;
        IF jsonb_typeof(v_item -> v_field) = 'number' THEN
          v_number := (v_item ->> v_field)::NUMERIC;
          IF v_number < 0
             OR v_number > 9999999999999999.99
             OR v_number IS DISTINCT FROM trunc(v_number, 2) THEN
            RAISE EXCEPTION 'invalid price value'
              USING ERRCODE = '22023';
          END IF;
          v_has_price := TRUE;
        END IF;
      END LOOP;
      IF NOT v_has_price THEN
        RAISE EXCEPTION 'price row has no price'
          USING ERRCODE = '22023';
      END IF;

    ELSIF p_import_kind = 'inventory' THEN
      IF NOT (v_item ?& ARRAY[
           'snapshotDate', 'warehouseCode', 'warehouseName', 'warehouseKind',
           'quantityAvailable', 'quantityReserved'
         ])
         OR EXISTS (
           SELECT 1
             FROM jsonb_object_keys(v_item) AS field(key)
            WHERE NOT (field.key = ANY (ARRAY[
              'variantKey', 'sku', 'name', 'normalizedName', 'snapshotDate',
              'warehouseCode', 'warehouseName', 'warehouseKind',
              'quantityAvailable', 'quantityReserved'
            ]))
         )
         OR jsonb_typeof(v_item -> 'snapshotDate') <> 'string'
         OR jsonb_typeof(v_item -> 'warehouseCode') <> 'string'
         OR jsonb_typeof(v_item -> 'warehouseName') <> 'string'
         OR jsonb_typeof(v_item -> 'warehouseKind') <> 'string'
         OR jsonb_typeof(v_item -> 'quantityAvailable') <> 'number'
         OR jsonb_typeof(v_item -> 'quantityReserved') <> 'number' THEN
        RAISE EXCEPTION 'invalid inventory publication row shape'
          USING ERRCODE = '22023';
      END IF;

      BEGIN
        v_snapshot_date := (v_item ->> 'snapshotDate')::DATE;
      EXCEPTION WHEN OTHERS THEN
        RAISE EXCEPTION 'invalid inventory snapshot date'
          USING ERRCODE = '22023';
      END;
      IF v_snapshot_date::TEXT IS DISTINCT FROM (v_item ->> 'snapshotDate')
         OR v_snapshot_date IS DISTINCT FROM p_effective_date THEN
        RAISE EXCEPTION 'inventory snapshot date mismatch'
          USING ERRCODE = '22023';
      END IF;

      v_warehouse_code := v_item ->> 'warehouseCode';
      v_normalized_warehouse_code := lower(v_warehouse_code);
      v_warehouse_name := v_item ->> 'warehouseName';
      v_warehouse_kind := v_item ->> 'warehouseKind';
      IF v_warehouse_code !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$'
         OR length(btrim(v_warehouse_name)) NOT BETWEEN 1 AND 200
         OR v_warehouse_name IS DISTINCT FROM btrim(v_warehouse_name)
         OR v_warehouse_kind NOT IN (
           'store', 'warehouse', 'marketplace', 'wholesale', 'other'
         ) THEN
        RAISE EXCEPTION 'invalid inventory warehouse'
          USING ERRCODE = '22023';
      END IF;

      IF v_inventory_warehouse_code IS NULL THEN
        v_inventory_warehouse_code := v_normalized_warehouse_code;
        v_inventory_warehouse_name := v_warehouse_name;
        v_inventory_warehouse_kind := v_warehouse_kind;
      ELSIF v_inventory_warehouse_code IS DISTINCT FROM v_normalized_warehouse_code
         OR v_inventory_warehouse_name IS DISTINCT FROM v_warehouse_name
         OR v_inventory_warehouse_kind IS DISTINCT FROM v_warehouse_kind THEN
        RAISE EXCEPTION 'inventory publication must have one warehouse'
          USING ERRCODE = '22023';
      END IF;

      FOREACH v_field IN ARRAY ARRAY['quantityAvailable', 'quantityReserved']
      LOOP
        v_number := (v_item ->> v_field)::NUMERIC;
        IF v_number < 0
           OR v_number > 999999999999999.999
           OR v_number IS DISTINCT FROM trunc(v_number, 3) THEN
          RAISE EXCEPTION 'invalid inventory quantity'
            USING ERRCODE = '22023';
        END IF;
      END LOOP;

    ELSE
      IF NOT (v_item ?& ARRAY[
           'externalLineId', 'warehouseCode', 'warehouseName', 'warehouseKind',
           'channel', 'occurredOn', 'quantity', 'listAmount', 'netRevenue',
           'costAmount', 'discountAmount'
         ])
         OR EXISTS (
           SELECT 1
             FROM jsonb_object_keys(v_item) AS field(key)
            WHERE NOT (field.key = ANY (ARRAY[
              'variantKey', 'sku', 'name', 'normalizedName', 'externalLineId',
              'warehouseCode', 'warehouseName', 'warehouseKind', 'channel',
              'occurredOn', 'quantity', 'listAmount', 'netRevenue',
              'costAmount', 'discountAmount'
            ]))
         )
         OR jsonb_typeof(v_item -> 'externalLineId') <> 'string'
         OR jsonb_typeof(v_item -> 'warehouseCode') <> 'string'
         OR jsonb_typeof(v_item -> 'warehouseName') <> 'string'
         OR jsonb_typeof(v_item -> 'warehouseKind') <> 'string'
         OR jsonb_typeof(v_item -> 'channel') <> 'string'
         OR jsonb_typeof(v_item -> 'occurredOn') <> 'string'
         OR jsonb_typeof(v_item -> 'quantity') <> 'number'
         OR jsonb_typeof(v_item -> 'listAmount') <> 'number'
         OR jsonb_typeof(v_item -> 'netRevenue') <> 'number'
         OR jsonb_typeof(v_item -> 'costAmount') <> 'number'
         OR jsonb_typeof(v_item -> 'discountAmount') <> 'number' THEN
        RAISE EXCEPTION 'invalid sales publication row shape'
          USING ERRCODE = '22023';
      END IF;

      v_external_line_id := v_item ->> 'externalLineId';
      v_warehouse_code := v_item ->> 'warehouseCode';
      v_warehouse_name := v_item ->> 'warehouseName';
      v_warehouse_kind := v_item ->> 'warehouseKind';
      v_channel := v_item ->> 'channel';
      IF length(btrim(v_external_line_id)) NOT BETWEEN 1 AND 200
         OR v_external_line_id IS DISTINCT FROM btrim(v_external_line_id)
         OR v_warehouse_code !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$'
         OR length(btrim(v_warehouse_name)) NOT BETWEEN 1 AND 200
         OR v_warehouse_name IS DISTINCT FROM btrim(v_warehouse_name)
         OR v_warehouse_kind NOT IN (
           'store', 'warehouse', 'marketplace', 'wholesale', 'other'
         )
         OR v_channel NOT IN ('retail_store', 'kaspi', 'wholesale', 'other') THEN
        RAISE EXCEPTION 'invalid sales identity or warehouse'
          USING ERRCODE = '22023';
      END IF;

      BEGIN
        v_occurred_on := (v_item ->> 'occurredOn')::DATE;
      EXCEPTION WHEN OTHERS THEN
        RAISE EXCEPTION 'invalid sales date'
          USING ERRCODE = '22023';
      END;
      IF v_occurred_on::TEXT IS DISTINCT FROM (v_item ->> 'occurredOn') THEN
        RAISE EXCEPTION 'invalid sales calendar date'
          USING ERRCODE = '22023';
      END IF;

      v_row_month := to_char(v_occurred_on, 'YYYY-MM');
      IF v_sales_month IS NULL THEN
        v_sales_month := v_row_month;
      ELSIF v_sales_month IS DISTINCT FROM v_row_month THEN
        RAISE EXCEPTION 'sales publication must have one calendar month'
          USING ERRCODE = '22023';
      END IF;
      v_min_date := LEAST(COALESCE(v_min_date, v_occurred_on), v_occurred_on);
      v_max_date := GREATEST(COALESCE(v_max_date, v_occurred_on), v_occurred_on);

      v_quantity := (v_item ->> 'quantity')::NUMERIC;
      v_list_amount := (v_item ->> 'listAmount')::NUMERIC;
      v_net_revenue := (v_item ->> 'netRevenue')::NUMERIC;
      v_cost_amount := (v_item ->> 'costAmount')::NUMERIC;
      v_discount_amount := (v_item ->> 'discountAmount')::NUMERIC;

      IF v_quantity = 0
         OR abs(v_quantity) > 999999999999999.999
         OR v_quantity IS DISTINCT FROM trunc(v_quantity, 3)
         OR abs(v_list_amount) > 9999999999999999.99
         OR abs(v_net_revenue) > 9999999999999999.99
         OR abs(v_cost_amount) > 9999999999999999.99
         OR abs(v_discount_amount) > 9999999999999999.99
         OR v_list_amount IS DISTINCT FROM trunc(v_list_amount, 2)
         OR v_net_revenue IS DISTINCT FROM trunc(v_net_revenue, 2)
         OR v_cost_amount IS DISTINCT FROM trunc(v_cost_amount, 2)
         OR v_discount_amount IS DISTINCT FROM trunc(v_discount_amount, 2)
         OR (v_quantity > 0 AND (
           v_list_amount < 0 OR v_net_revenue < 0 OR v_cost_amount < 0
         ))
         OR (v_quantity < 0 AND (
           v_list_amount > 0 OR v_net_revenue > 0 OR v_cost_amount > 0
         ))
         OR v_discount_amount IS DISTINCT FROM v_list_amount - v_net_revenue THEN
        RAISE EXCEPTION 'invalid signed sales amounts'
          USING ERRCODE = '22023';
      END IF;
    END IF;
  END LOOP;

  -- The same variant key must never mean two normalized names. Existing
  -- variants are resolved solely by variant_key, independent of source SKU.
  IF EXISTS (
    SELECT 1
      FROM jsonb_to_recordset(p_rows) AS source_row(
        "variantKey" TEXT,
        "normalizedName" TEXT
      )
     GROUP BY source_row."variantKey"
    HAVING count(DISTINCT source_row."normalizedName") <> 1
  ) OR EXISTS (
    SELECT 1
      FROM jsonb_to_recordset(p_rows) AS source_row(
        "variantKey" TEXT,
        "normalizedName" TEXT
      )
      JOIN public.store_product_variants AS variant
        ON variant.user_id = p_user_id
       AND variant.company_id = v_company_id
       AND variant.variant_key = source_row."variantKey"
     WHERE variant.normalized_name IS DISTINCT FROM source_row."normalizedName"
  ) THEN
    RAISE EXCEPTION 'store variant identity conflict'
      USING ERRCODE = '22023';
  END IF;

  IF p_import_kind IN ('prices', 'inventory') THEN
    IF p_effective_date IS NULL
       OR p_period_start IS DISTINCT FROM p_effective_date
       OR p_period_end IS DISTINCT FROM p_effective_date THEN
      RAISE EXCEPTION 'snapshot publication date mismatch'
        USING ERRCODE = '22023';
    END IF;

    IF p_import_kind = 'prices' AND p_scope_key IS DISTINCT FROM 'global' THEN
      RAISE EXCEPTION 'invalid price publication scope'
        USING ERRCODE = '22023';
    END IF;
    IF p_import_kind = 'inventory'
       AND p_scope_key IS DISTINCT FROM (
         'warehouse:' || v_inventory_warehouse_code
       ) THEN
      RAISE EXCEPTION 'invalid inventory publication scope'
        USING ERRCODE = '22023';
    END IF;
  ELSE
    IF p_effective_date IS NOT NULL
       OR p_period_start IS DISTINCT FROM v_min_date
       OR p_period_end IS DISTINCT FROM v_max_date
       OR p_scope_key IS DISTINCT FROM ('month:' || v_sales_month) THEN
      RAISE EXCEPTION 'invalid sales publication period or scope'
        USING ERRCODE = '22023';
    END IF;
  END IF;

  IF p_import_kind IN ('prices', 'inventory') AND (
    SELECT count(DISTINCT source_row."variantKey")
      FROM jsonb_to_recordset(p_rows) AS source_row("variantKey" TEXT)
  ) <> v_row_count THEN
    RAISE EXCEPTION 'duplicate snapshot variant'
      USING ERRCODE = '22023';
  END IF;

  IF p_import_kind = 'sales' AND (
    SELECT count(DISTINCT source_row."externalLineId")
      FROM jsonb_to_recordset(p_rows) AS source_row("externalLineId" TEXT)
  ) <> v_row_count THEN
    RAISE EXCEPTION 'duplicate sales external line id'
      USING ERRCODE = '22023';
  END IF;

  IF p_import_kind = 'sales' AND EXISTS (
    SELECT 1
      FROM jsonb_to_recordset(p_rows) AS source_row(
        "warehouseCode" TEXT,
        "warehouseName" TEXT,
        "warehouseKind" TEXT
      )
     GROUP BY lower(source_row."warehouseCode")
    HAVING count(DISTINCT source_row."warehouseName") <> 1
        OR count(DISTINCT source_row."warehouseKind") <> 1
  ) THEN
    RAISE EXCEPTION 'conflicting sales warehouse identity'
      USING ERRCODE = '22023';
  END IF;

  -- Serialize every publication for one owner/company. This is deliberately
  -- broader than a table lock and protects idempotency, cross-kind variant
  -- resolution and one-published-run-per-scope without blocking other owners.
  PERFORM pg_advisory_xact_lock(hashtextextended(
    p_user_id::TEXT || ':' || v_company_id || ':store-publication',
    0
  ));

  -- A repeated idempotency key must describe the exact same semantic request.
  SELECT run.*
    INTO v_existing
    FROM public.store_import_runs AS run
   WHERE run.user_id = p_user_id
     AND run.company_id = v_company_id
     AND run.idempotency_key = p_idempotency_key
   FOR UPDATE;

  IF FOUND THEN
    IF v_existing.source_sha256 IS DISTINCT FROM p_source_sha256
       OR v_existing.manifest_sha256 IS DISTINCT FROM p_manifest_sha256
       OR v_existing.import_kind IS DISTINCT FROM p_import_kind
       OR v_existing.scope_key IS DISTINCT FROM p_scope_key
       OR v_existing.schema_version IS DISTINCT FROM p_schema_version
       OR v_existing.row_count IS DISTINCT FROM v_row_count
       OR v_existing.period_start IS DISTINCT FROM p_period_start
       OR v_existing.period_end IS DISTINCT FROM p_period_end
       OR v_existing.warning_count IS DISTINCT FROM p_warning_count
       OR v_existing.quarantined_count IS DISTINCT FROM p_quarantined_count
       OR v_existing.status IS DISTINCT FROM 'published' THEN
      RAISE EXCEPTION 'store publication idempotency conflict'
        USING ERRCODE = 'P0002';
    END IF;

    RETURN QUERY SELECT
      'duplicate'::TEXT,
      v_existing.id,
      v_existing.status,
      v_existing.import_kind,
      v_existing.scope_key,
      v_existing.row_count,
      v_existing.published_at,
      NULL::UUID;
    RETURN;
  END IF;

  SELECT run.*
    INTO v_existing
    FROM public.store_import_runs AS run
   WHERE run.user_id = p_user_id
     AND run.company_id = v_company_id
     AND run.manifest_sha256 = p_manifest_sha256
   FOR UPDATE;

  IF FOUND THEN
    IF v_existing.source_sha256 IS DISTINCT FROM p_source_sha256
       OR v_existing.import_kind IS DISTINCT FROM p_import_kind
       OR v_existing.scope_key IS DISTINCT FROM p_scope_key
       OR v_existing.status IS DISTINCT FROM 'published' THEN
      RAISE EXCEPTION 'store publication manifest conflict'
        USING ERRCODE = 'P0002';
    END IF;

    RETURN QUERY SELECT
      'duplicate'::TEXT,
      v_existing.id,
      v_existing.status,
      v_existing.import_kind,
      v_existing.scope_key,
      v_existing.row_count,
      v_existing.published_at,
      NULL::UUID;
    RETURN;
  END IF;

  INSERT INTO public.store_import_runs (
    user_id,
    company_id,
    import_kind,
    source,
    scope_key,
    source_sha256,
    source_file_name,
    source_size_bytes,
    schema_version,
    idempotency_key,
    manifest_sha256,
    status,
    period_start,
    period_end,
    row_count,
    warning_count,
    error_count,
    quarantined_count
  ) VALUES (
    p_user_id,
    v_company_id,
    p_import_kind,
    'file_upload',
    p_scope_key,
    p_source_sha256,
    btrim(p_source_file_name),
    p_source_size_bytes,
    p_schema_version,
    p_idempotency_key,
    p_manifest_sha256,
    'validated',
    p_period_start,
    p_period_end,
    v_row_count,
    p_warning_count,
    0,
    p_quarantined_count
  )
  RETURNING * INTO v_run;

  IF p_import_kind IN ('inventory', 'sales') THEN
    INSERT INTO public.store_warehouses (
      user_id, company_id, code, name, warehouse_kind, is_active, updated_at
    )
    SELECT DISTINCT ON (lower(source_row."warehouseCode"))
      p_user_id,
      v_company_id,
      lower(source_row."warehouseCode"),
      source_row."warehouseName",
      source_row."warehouseKind",
      TRUE,
      v_now
    FROM jsonb_to_recordset(p_rows) AS source_row(
      "warehouseCode" TEXT,
      "warehouseName" TEXT,
      "warehouseKind" TEXT
    )
    ORDER BY lower(source_row."warehouseCode")
    ON CONFLICT (user_id, company_id, code) DO UPDATE SET
      name = EXCLUDED.name,
      warehouse_kind = EXCLUDED.warehouse_kind,
      is_active = TRUE,
      updated_at = EXCLUDED.updated_at;
  END IF;

  INSERT INTO public.store_product_variants (
    user_id,
    company_id,
    sku,
    name,
    normalized_name,
    variant_key,
    is_active,
    created_at,
    updated_at
  )
  SELECT DISTINCT ON (source_row."variantKey")
    p_user_id,
    v_company_id,
    source_row.sku,
    source_row.name,
    source_row."normalizedName",
    source_row."variantKey",
    TRUE,
    v_now,
    v_now
  FROM jsonb_to_recordset(p_rows) AS source_row(
    "variantKey" TEXT,
    sku TEXT,
    name TEXT,
    "normalizedName" TEXT
  )
  ORDER BY
    source_row."variantKey",
    CASE WHEN source_row.sku LIKE 'name:%' THEN 1 ELSE 0 END,
    source_row.sku
  ON CONFLICT (user_id, company_id, variant_key) DO UPDATE SET
    sku = CASE
      WHEN store_product_variants.sku LIKE 'name:%'
       AND EXCLUDED.sku NOT LIKE 'name:%'
      THEN EXCLUDED.sku
      ELSE store_product_variants.sku
    END,
    is_active = TRUE,
    updated_at = EXCLUDED.updated_at;

  INSERT INTO public.store_import_variant_mappings (
    import_run_id,
    user_id,
    company_id,
    source_sku,
    source_name,
    source_variant_key,
    variant_id,
    resolution_method
  )
  SELECT DISTINCT
    v_run.id,
    p_user_id,
    v_company_id,
    source_row.sku,
    source_row.name,
    source_row."variantKey",
    variant.id,
    CASE WHEN variant.created_at = v_now THEN 'created' ELSE 'existing' END
  FROM jsonb_to_recordset(p_rows) AS source_row(
    "variantKey" TEXT,
    sku TEXT,
    name TEXT
  )
  JOIN public.store_product_variants AS variant
    ON variant.user_id = p_user_id
   AND variant.company_id = v_company_id
   AND variant.variant_key = source_row."variantKey";

  IF p_import_kind = 'prices' THEN
    INSERT INTO public.store_price_snapshots (
      user_id,
      company_id,
      import_run_id,
      variant_id,
      snapshot_date,
      purchase_price,
      retail_price,
      consignment_price,
      wholesale_25_price,
      wholesale_30_price,
      currency
    )
    SELECT
      p_user_id,
      v_company_id,
      v_run.id,
      variant.id,
      source_row."snapshotDate",
      source_row."purchasePrice",
      source_row."retailPrice",
      source_row."consignmentPrice",
      source_row."wholesale25Price",
      source_row."wholesale30Price",
      'KZT'
    FROM jsonb_to_recordset(p_rows) AS source_row(
      "variantKey" TEXT,
      "snapshotDate" DATE,
      "purchasePrice" NUMERIC,
      "retailPrice" NUMERIC,
      "consignmentPrice" NUMERIC,
      "wholesale25Price" NUMERIC,
      "wholesale30Price" NUMERIC
    )
    JOIN public.store_product_variants AS variant
      ON variant.user_id = p_user_id
     AND variant.company_id = v_company_id
     AND variant.variant_key = source_row."variantKey";

  ELSIF p_import_kind = 'inventory' THEN
    INSERT INTO public.store_inventory_snapshots (
      user_id,
      company_id,
      import_run_id,
      variant_id,
      warehouse_id,
      snapshot_date,
      quantity_available,
      quantity_reserved
    )
    SELECT
      p_user_id,
      v_company_id,
      v_run.id,
      variant.id,
      warehouse.id,
      source_row."snapshotDate",
      source_row."quantityAvailable",
      source_row."quantityReserved"
    FROM jsonb_to_recordset(p_rows) AS source_row(
      "variantKey" TEXT,
      "warehouseCode" TEXT,
      "snapshotDate" DATE,
      "quantityAvailable" NUMERIC,
      "quantityReserved" NUMERIC
    )
    JOIN public.store_product_variants AS variant
      ON variant.user_id = p_user_id
     AND variant.company_id = v_company_id
     AND variant.variant_key = source_row."variantKey"
    JOIN public.store_warehouses AS warehouse
      ON warehouse.user_id = p_user_id
     AND warehouse.company_id = v_company_id
     AND warehouse.code = lower(source_row."warehouseCode");

  ELSE
    INSERT INTO public.store_sales_lines (
      user_id,
      company_id,
      import_run_id,
      external_line_id,
      variant_id,
      warehouse_id,
      sku_snapshot,
      name_snapshot,
      channel,
      occurred_on,
      quantity,
      list_amount,
      net_revenue,
      cost_amount,
      discount_amount,
      currency
    )
    SELECT
      p_user_id,
      v_company_id,
      v_run.id,
      source_row."externalLineId",
      variant.id,
      warehouse.id,
      source_row.sku,
      source_row.name,
      source_row.channel,
      source_row."occurredOn",
      source_row.quantity,
      source_row."listAmount",
      source_row."netRevenue",
      source_row."costAmount",
      source_row."discountAmount",
      'KZT'
    FROM jsonb_to_recordset(p_rows) AS source_row(
      "variantKey" TEXT,
      sku TEXT,
      name TEXT,
      "externalLineId" TEXT,
      "warehouseCode" TEXT,
      channel TEXT,
      "occurredOn" DATE,
      quantity NUMERIC,
      "listAmount" NUMERIC,
      "netRevenue" NUMERIC,
      "costAmount" NUMERIC,
      "discountAmount" NUMERIC
    )
    JOIN public.store_product_variants AS variant
      ON variant.user_id = p_user_id
     AND variant.company_id = v_company_id
     AND variant.variant_key = source_row."variantKey"
    JOIN public.store_warehouses AS warehouse
      ON warehouse.user_id = p_user_id
     AND warehouse.company_id = v_company_id
     AND warehouse.code = lower(source_row."warehouseCode");
  END IF;

  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  IF v_inserted IS DISTINCT FROM v_row_count THEN
    RAISE EXCEPTION 'store publication fact count mismatch'
      USING ERRCODE = '23514';
  END IF;

  -- Supersede only after all facts have passed their table constraints. The
  -- unique partial index from 084 guarantees at most one current run.
  UPDATE public.store_import_runs AS previous_run
     SET status = 'superseded'
   WHERE previous_run.user_id = p_user_id
     AND previous_run.company_id = v_company_id
     AND previous_run.import_kind = p_import_kind
     AND previous_run.scope_key = p_scope_key
     AND previous_run.status = 'published'
     AND previous_run.id <> v_run.id
  RETURNING previous_run.id INTO v_superseded_run_id;

  UPDATE public.store_import_runs AS published_run
     SET status = 'published',
         published_at = v_now
   WHERE published_run.id = v_run.id
     AND published_run.user_id = p_user_id
     AND published_run.company_id = v_company_id
     AND published_run.status = 'validated'
  RETURNING published_run.* INTO v_run;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'store publication state transition failed'
      USING ERRCODE = '23514';
  END IF;

  RETURN QUERY SELECT
    'published'::TEXT,
    v_run.id,
    v_run.status,
    v_run.import_kind,
    v_run.scope_key,
    v_run.row_count,
    v_run.published_at,
    v_superseded_run_id;
END;
$$;

REVOKE ALL ON FUNCTION public.publish_store_import(
  UUID, TEXT, TEXT, TEXT, INTEGER, INTEGER, UUID, TEXT, TEXT, TEXT,
  DATE, DATE, DATE, INTEGER, INTEGER, JSONB
) FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.publish_store_import(
  UUID, TEXT, TEXT, TEXT, INTEGER, INTEGER, UUID, TEXT, TEXT, TEXT,
  DATE, DATE, DATE, INTEGER, INTEGER, JSONB
) TO service_role;

-- SECURITY DEFINER publication is now the only application write path.
REVOKE INSERT, UPDATE, DELETE ON TABLE public.store_import_runs
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.store_warehouses
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.store_product_variants
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.store_price_snapshots
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.store_inventory_snapshots
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.store_sales_lines
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.store_import_variant_mappings
  FROM PUBLIC, anon, authenticated, service_role;

-- companies.id is UUID in clean installs and TEXT in the reconciled
-- production schema, so a portable declarative FK cannot target it from the
-- TEXT company_id columns above. Prevent orphan Store data when a user deletes
-- only the company (auth.users deletion is already covered by ON DELETE
-- CASCADE). Facts/mappings cascade from import runs; remaining references are
-- then removed explicitly under the same owner/company pair.
CREATE OR REPLACE FUNCTION public.store_cleanup_deleted_company()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_company_id TEXT := btrim(OLD.id::TEXT);
BEGIN
  DELETE FROM public.store_import_runs AS import_run
   WHERE import_run.user_id = OLD.user_id
     AND import_run.company_id = v_company_id;

  DELETE FROM public.store_product_variants AS variant
   WHERE variant.user_id = OLD.user_id
     AND variant.company_id = v_company_id;

  DELETE FROM public.store_warehouses AS warehouse
   WHERE warehouse.user_id = OLD.user_id
     AND warehouse.company_id = v_company_id;

  RETURN OLD;
END;
$$;

REVOKE ALL ON FUNCTION public.store_cleanup_deleted_company()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS store_company_cleanup
  ON public.companies;
CREATE TRIGGER store_company_cleanup
  BEFORE DELETE ON public.companies
  FOR EACH ROW EXECUTE FUNCTION public.store_cleanup_deleted_company();

COMMENT ON FUNCTION public.publish_store_import(
  UUID, TEXT, TEXT, TEXT, INTEGER, INTEGER, UUID, TEXT, TEXT, TEXT,
  DATE, DATE, DATE, INTEGER, INTEGER, JSONB
) IS 'Service-only atomic publication of one validated store price, inventory or monthly sales import.';

COMMENT ON TABLE public.store_import_variant_mappings IS
  'Immutable per-run audit mapping from source SKU/name identity to the canonical owner/company product variant.';

COMMENT ON FUNCTION public.store_cleanup_deleted_company() IS
  'Deletes Store facts and references for the exact owner/company pair before a company row is removed.';
