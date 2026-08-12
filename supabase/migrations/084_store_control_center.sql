-- Store Control Center: normalized operational facts for prices, stock and sales.
--
-- This layer intentionally does not widen the MyHonor-only ecommerce_* tables.
-- Browser roles can read only their own published facts. Future import routes
-- must stage and publish through trusted server-side code; direct client writes
-- are not granted. Raw files, bank details and customer PII do not belong here.

CREATE TABLE IF NOT EXISTS public.store_import_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- companies.id is UUID in clean installs and TEXT/CUID in the reconciled
  -- production schema, so bind through id::TEXT in the owner trigger below.
  company_id TEXT NOT NULL CHECK (length(btrim(company_id)) BETWEEN 1 AND 200),
  import_kind TEXT NOT NULL CHECK (
    import_kind IN ('prices', 'inventory', 'sales')
  ),
  source TEXT NOT NULL DEFAULT 'file_upload' CHECK (
    source IN ('file_upload', 'api', 'manual')
  ),
  scope_key TEXT NOT NULL DEFAULT 'global' CHECK (
    length(btrim(scope_key)) BETWEEN 1 AND 160
  ),
  source_sha256 TEXT NOT NULL CHECK (source_sha256 ~ '^[a-f0-9]{64}$'),
  schema_version INTEGER NOT NULL DEFAULT 1 CHECK (
    schema_version BETWEEN 1 AND 1000
  ),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (
    status IN (
      'draft', 'validating', 'validated', 'approved', 'published',
      'rejected', 'failed', 'superseded'
    )
  ),
  period_start DATE,
  period_end DATE,
  row_count INTEGER NOT NULL DEFAULT 0 CHECK (row_count >= 0),
  warning_count INTEGER NOT NULL DEFAULT 0 CHECK (warning_count >= 0),
  error_count INTEGER NOT NULL DEFAULT 0 CHECK (error_count >= 0),
  source_created_at TIMESTAMPTZ CHECK (
    source_created_at IS NULL OR isfinite(source_created_at)
  ),
  published_at TIMESTAMPTZ CHECK (
    published_at IS NULL OR isfinite(published_at)
  ),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now() CHECK (isfinite(created_at)),
  UNIQUE (user_id, company_id, import_kind, source_sha256),
  UNIQUE (id, user_id, company_id),
  CONSTRAINT store_import_runs_period_order CHECK (
    period_start IS NULL OR period_end IS NULL OR period_end >= period_start
  ),
  CONSTRAINT store_import_runs_publish_state CHECK (
    (status IN ('published', 'superseded') AND published_at IS NOT NULL)
    OR (status NOT IN ('published', 'superseded') AND published_at IS NULL)
  )
);

CREATE TABLE IF NOT EXISTS public.store_warehouses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  company_id TEXT NOT NULL CHECK (length(btrim(company_id)) BETWEEN 1 AND 200),
  code TEXT NOT NULL CHECK (code ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$'),
  name TEXT NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 200),
  warehouse_kind TEXT NOT NULL CHECK (
    warehouse_kind IN ('store', 'warehouse', 'marketplace', 'wholesale', 'other')
  ),
  city TEXT CHECK (city IS NULL OR length(btrim(city)) BETWEEN 1 AND 120),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now() CHECK (isfinite(created_at)),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now() CHECK (isfinite(updated_at)),
  UNIQUE (user_id, company_id, code),
  UNIQUE (id, user_id, company_id)
);

CREATE TABLE IF NOT EXISTS public.store_product_variants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  company_id TEXT NOT NULL CHECK (length(btrim(company_id)) BETWEEN 1 AND 200),
  sku TEXT NOT NULL CHECK (length(btrim(sku)) BETWEEN 1 AND 160),
  name TEXT NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 300),
  normalized_name TEXT NOT NULL CHECK (
    length(btrim(normalized_name)) BETWEEN 1 AND 300
  ),
  barcode TEXT CHECK (
    barcode IS NULL OR barcode ~ '^[A-Za-z0-9._:-]{4,80}$'
  ),
  brand TEXT CHECK (brand IS NULL OR length(btrim(brand)) BETWEEN 1 AND 160),
  category TEXT CHECK (
    category IS NULL OR length(btrim(category)) BETWEEN 1 AND 200
  ),
  size TEXT CHECK (size IS NULL OR length(btrim(size)) BETWEEN 1 AND 80),
  color TEXT CHECK (color IS NULL OR length(btrim(color)) BETWEEN 1 AND 120),
  -- Supplier articles are shared by multiple size/color variants in the HONOR
  -- source files. variant_key keeps those rows distinct and is derived from
  -- the complete normalized variant name when the source has no variant ID.
  variant_key TEXT NOT NULL CHECK (
    length(btrim(variant_key)) BETWEEN 1 AND 200
  ),
  ecommerce_product_id UUID REFERENCES public.ecommerce_products(id) ON DELETE SET NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now() CHECK (isfinite(created_at)),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now() CHECK (isfinite(updated_at)),
  UNIQUE (user_id, company_id, sku, variant_key),
  UNIQUE (id, user_id, company_id)
);

CREATE TABLE IF NOT EXISTS public.store_price_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  company_id TEXT NOT NULL CHECK (length(btrim(company_id)) BETWEEN 1 AND 200),
  import_run_id UUID NOT NULL,
  variant_id UUID NOT NULL,
  snapshot_date DATE NOT NULL,
  purchase_price NUMERIC(18,2) CHECK (
    purchase_price IS NULL OR purchase_price >= 0
  ),
  retail_price NUMERIC(18,2) CHECK (retail_price IS NULL OR retail_price >= 0),
  consignment_price NUMERIC(18,2) CHECK (
    consignment_price IS NULL OR consignment_price >= 0
  ),
  wholesale_25_price NUMERIC(18,2) CHECK (
    wholesale_25_price IS NULL OR wholesale_25_price >= 0
  ),
  wholesale_30_price NUMERIC(18,2) CHECK (
    wholesale_30_price IS NULL OR wholesale_30_price >= 0
  ),
  currency TEXT NOT NULL DEFAULT 'KZT' CHECK (currency = 'KZT'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now() CHECK (isfinite(created_at)),
  FOREIGN KEY (import_run_id, user_id, company_id)
    REFERENCES public.store_import_runs(id, user_id, company_id) ON DELETE CASCADE,
  FOREIGN KEY (variant_id, user_id, company_id)
    REFERENCES public.store_product_variants(id, user_id, company_id) ON DELETE CASCADE,
  UNIQUE (import_run_id, variant_id),
  CONSTRAINT store_price_snapshots_has_price CHECK (
    purchase_price IS NOT NULL
    OR retail_price IS NOT NULL
    OR consignment_price IS NOT NULL
    OR wholesale_25_price IS NOT NULL
    OR wholesale_30_price IS NOT NULL
  )
);

CREATE TABLE IF NOT EXISTS public.store_inventory_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  company_id TEXT NOT NULL CHECK (length(btrim(company_id)) BETWEEN 1 AND 200),
  import_run_id UUID NOT NULL,
  variant_id UUID NOT NULL,
  warehouse_id UUID NOT NULL,
  snapshot_date DATE NOT NULL,
  quantity_available NUMERIC(18,3) NOT NULL CHECK (quantity_available >= 0),
  quantity_reserved NUMERIC(18,3) NOT NULL DEFAULT 0 CHECK (quantity_reserved >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now() CHECK (isfinite(created_at)),
  FOREIGN KEY (import_run_id, user_id, company_id)
    REFERENCES public.store_import_runs(id, user_id, company_id) ON DELETE CASCADE,
  FOREIGN KEY (variant_id, user_id, company_id)
    REFERENCES public.store_product_variants(id, user_id, company_id) ON DELETE CASCADE,
  FOREIGN KEY (warehouse_id, user_id, company_id)
    REFERENCES public.store_warehouses(id, user_id, company_id) ON DELETE CASCADE,
  UNIQUE (import_run_id, variant_id, warehouse_id)
);

CREATE TABLE IF NOT EXISTS public.store_sales_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  company_id TEXT NOT NULL CHECK (length(btrim(company_id)) BETWEEN 1 AND 200),
  import_run_id UUID NOT NULL,
  external_line_id TEXT NOT NULL CHECK (
    length(btrim(external_line_id)) BETWEEN 1 AND 200
  ),
  variant_id UUID,
  warehouse_id UUID,
  sku_snapshot TEXT CHECK (
    sku_snapshot IS NULL OR length(btrim(sku_snapshot)) BETWEEN 1 AND 160
  ),
  name_snapshot TEXT NOT NULL CHECK (
    length(btrim(name_snapshot)) BETWEEN 1 AND 300
  ),
  channel TEXT NOT NULL CHECK (length(btrim(channel)) BETWEEN 1 AND 160),
  occurred_on DATE NOT NULL,
  -- Signed facts: returns remain negative all the way through aggregation.
  quantity NUMERIC(18,3) NOT NULL CHECK (quantity <> 0),
  list_amount NUMERIC(18,2) NOT NULL,
  net_revenue NUMERIC(18,2) NOT NULL,
  cost_amount NUMERIC(18,2) NOT NULL,
  discount_amount NUMERIC(18,2) NOT NULL,
  currency TEXT NOT NULL DEFAULT 'KZT' CHECK (currency = 'KZT'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now() CHECK (isfinite(created_at)),
  FOREIGN KEY (import_run_id, user_id, company_id)
    REFERENCES public.store_import_runs(id, user_id, company_id) ON DELETE CASCADE,
  FOREIGN KEY (variant_id, user_id, company_id)
    REFERENCES public.store_product_variants(id, user_id, company_id) ON DELETE RESTRICT,
  FOREIGN KEY (warehouse_id, user_id, company_id)
    REFERENCES public.store_warehouses(id, user_id, company_id) ON DELETE RESTRICT,
  UNIQUE (import_run_id, external_line_id),
  CONSTRAINT store_sales_lines_signed_amounts CHECK (
    (quantity > 0 AND list_amount >= 0 AND net_revenue >= 0 AND cost_amount >= 0)
    OR (quantity < 0 AND list_amount <= 0 AND net_revenue <= 0 AND cost_amount <= 0)
  ),
  CONSTRAINT store_sales_lines_discount_math CHECK (
    discount_amount = list_amount - net_revenue
  )
);

CREATE INDEX IF NOT EXISTS idx_store_import_runs_owner_published
  ON public.store_import_runs (user_id, company_id, import_kind, published_at DESC)
  WHERE status = 'published';
CREATE UNIQUE INDEX IF NOT EXISTS idx_store_import_runs_one_published_scope
  ON public.store_import_runs (user_id, company_id, import_kind, scope_key)
  WHERE status = 'published';
CREATE INDEX IF NOT EXISTS idx_store_variants_owner_name
  ON public.store_product_variants (user_id, company_id, normalized_name);
CREATE INDEX IF NOT EXISTS idx_store_prices_owner_date
  ON public.store_price_snapshots (user_id, company_id, snapshot_date DESC);
CREATE INDEX IF NOT EXISTS idx_store_inventory_owner_date
  ON public.store_inventory_snapshots (
    user_id, company_id, snapshot_date DESC, warehouse_id
  );
CREATE INDEX IF NOT EXISTS idx_store_sales_owner_period
  ON public.store_sales_lines (
    user_id, company_id, occurred_on DESC, channel
  );
CREATE INDEX IF NOT EXISTS idx_store_sales_owner_variant
  ON public.store_sales_lines (user_id, company_id, variant_id, occurred_on DESC);

-- Even trusted code cannot accidentally bind a business row to another user's
-- company. This complements (rather than replaces) the composite foreign keys.
CREATE OR REPLACE FUNCTION public.store_enforce_company_owner()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM public.companies
     WHERE id::TEXT = btrim(NEW.company_id)
       AND user_id = NEW.user_id
  ) THEN
    RAISE EXCEPTION 'invalid store company binding' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.store_enforce_company_owner()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.store_enforce_ecommerce_product_owner()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.ecommerce_product_id IS NOT NULL
     AND NOT EXISTS (
       SELECT 1
         FROM public.ecommerce_products
        WHERE id = NEW.ecommerce_product_id
          AND user_id = NEW.user_id
     ) THEN
    RAISE EXCEPTION 'invalid store ecommerce product binding'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.store_enforce_ecommerce_product_owner()
  FROM PUBLIC, anon, authenticated, service_role;

DO $$
DECLARE
  table_name TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'store_import_runs',
    'store_warehouses',
    'store_product_variants',
    'store_price_snapshots',
    'store_inventory_snapshots',
    'store_sales_lines'
  ] LOOP
    EXECUTE format(
      'DROP TRIGGER IF EXISTS %I ON public.%I',
      table_name || '_company_owner',
      table_name
    );
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE INSERT OR UPDATE ON public.%I '
      || 'FOR EACH ROW EXECUTE FUNCTION public.store_enforce_company_owner()',
      table_name || '_company_owner',
      table_name
    );
  END LOOP;
END;
$$;

DROP TRIGGER IF EXISTS store_product_variants_ecommerce_owner
  ON public.store_product_variants;
CREATE TRIGGER store_product_variants_ecommerce_owner
  BEFORE INSERT OR UPDATE OF ecommerce_product_id, user_id
  ON public.store_product_variants
  FOR EACH ROW EXECUTE FUNCTION public.store_enforce_ecommerce_product_owner();

ALTER TABLE public.store_import_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.store_warehouses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.store_product_variants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.store_price_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.store_inventory_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.store_sales_lines ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.store_import_runs
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.store_warehouses
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.store_product_variants
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.store_price_snapshots
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.store_inventory_snapshots
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.store_sales_lines
  FROM PUBLIC, anon, authenticated, service_role;

GRANT SELECT ON TABLE public.store_import_runs TO authenticated;
GRANT SELECT ON TABLE public.store_warehouses TO authenticated;
GRANT SELECT ON TABLE public.store_product_variants TO authenticated;
GRANT SELECT ON TABLE public.store_price_snapshots TO authenticated;
GRANT SELECT ON TABLE public.store_inventory_snapshots TO authenticated;
GRANT SELECT ON TABLE public.store_sales_lines TO authenticated;

-- service_role is the only direct writer in Phase 1. Phase 2 will add an
-- atomic publish RPC on top, so the browser can never supply ownership fields.
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.store_import_runs TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.store_warehouses TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.store_product_variants TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.store_price_snapshots TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.store_inventory_snapshots TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.store_sales_lines TO service_role;

DROP POLICY IF EXISTS store_import_runs_owner_read
  ON public.store_import_runs;
CREATE POLICY store_import_runs_owner_read
  ON public.store_import_runs
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS store_warehouses_owner_read
  ON public.store_warehouses;
CREATE POLICY store_warehouses_owner_read
  ON public.store_warehouses
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS store_product_variants_owner_read
  ON public.store_product_variants;
CREATE POLICY store_product_variants_owner_read
  ON public.store_product_variants
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS store_price_snapshots_owner_read
  ON public.store_price_snapshots;
CREATE POLICY store_price_snapshots_owner_read
  ON public.store_price_snapshots
  FOR SELECT TO authenticated
  USING (
    auth.uid() = user_id
    AND EXISTS (
      SELECT 1 FROM public.store_import_runs AS run
       WHERE run.id = import_run_id
         AND run.user_id = auth.uid()
         AND run.status = 'published'
    )
  );

DROP POLICY IF EXISTS store_inventory_snapshots_owner_read
  ON public.store_inventory_snapshots;
CREATE POLICY store_inventory_snapshots_owner_read
  ON public.store_inventory_snapshots
  FOR SELECT TO authenticated
  USING (
    auth.uid() = user_id
    AND EXISTS (
      SELECT 1 FROM public.store_import_runs AS run
       WHERE run.id = import_run_id
         AND run.user_id = auth.uid()
         AND run.status = 'published'
    )
  );

DROP POLICY IF EXISTS store_sales_lines_owner_read
  ON public.store_sales_lines;
CREATE POLICY store_sales_lines_owner_read
  ON public.store_sales_lines
  FOR SELECT TO authenticated
  USING (
    auth.uid() = user_id
    AND EXISTS (
      SELECT 1 FROM public.store_import_runs AS run
       WHERE run.id = import_run_id
         AND run.user_id = auth.uid()
         AND run.status = 'published'
    )
  );

COMMENT ON TABLE public.store_import_runs IS
  'Versioned metadata for normalized price, inventory and sales imports; raw files and PII are prohibited.';
COMMENT ON TABLE public.store_sales_lines IS
  'Published signed operational sales facts. Negative quantities and amounts represent returns.';
COMMENT ON TABLE public.store_inventory_snapshots IS
  'Published point-in-time stock by product variant and warehouse.';
COMMENT ON TABLE public.store_price_snapshots IS
  'Published KZT cost and channel price snapshots by product variant.';
