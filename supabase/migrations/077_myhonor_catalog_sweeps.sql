-- Complete-catalog sweep finalization.
--
-- Every bounded import marks verified rows active. Only a complete sweep whose
-- verified row count matches the sitemap may tombstone products that vanished
-- from the public catalog.

ALTER TABLE public.ecommerce_products
  ADD COLUMN IF NOT EXISTS catalog_active BOOLEAN NOT NULL DEFAULT FALSE;

UPDATE public.ecommerce_products
   SET catalog_active = TRUE
 WHERE catalog_synced_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ecommerce_products_active_catalog
  ON public.ecommerce_products (
    user_id, source, catalog_active, catalog_synced_at DESC
  );

CREATE TABLE IF NOT EXISTS public.ecommerce_catalog_sync_state (
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  company_id TEXT NOT NULL CHECK (length(btrim(company_id)) BETWEEN 1 AND 200),
  source TEXT NOT NULL DEFAULT 'myhonor.shop'
    CHECK (source = 'myhonor.shop'),
  expected_product_count INTEGER NOT NULL
    CHECK (expected_product_count BETWEEN 1 AND 500),
  active_product_count INTEGER NOT NULL
    CHECK (active_product_count BETWEEN 0 AND 500),
  last_sweep_started_at TIMESTAMPTZ NOT NULL,
  last_completed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  tombstoned_product_count INTEGER NOT NULL DEFAULT 0
    CHECK (tombstoned_product_count >= 0),
  PRIMARY KEY (user_id, source)
);

ALTER TABLE public.ecommerce_catalog_sync_state ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.ecommerce_catalog_sync_state
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.ecommerce_catalog_sync_state TO authenticated;
DROP POLICY IF EXISTS ecommerce_catalog_sync_state_owner_read
  ON public.ecommerce_catalog_sync_state;
CREATE POLICY ecommerce_catalog_sync_state_owner_read
  ON public.ecommerce_catalog_sync_state
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.finalize_myhonor_ecommerce_catalog_sweep(
  p_user_id UUID,
  p_company_id TEXT,
  p_sweep_started_at TIMESTAMPTZ,
  p_expected_product_count INTEGER
)
RETURNS TABLE (
  completed BOOLEAN,
  active_product_count INTEGER,
  tombstoned_product_count INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_source CONSTANT TEXT := 'myhonor.shop';
  v_verified INTEGER;
  v_tombstoned INTEGER := 0;
BEGIN
  IF p_user_id IS NULL
     OR p_company_id IS NULL
     OR p_sweep_started_at IS NULL
     OR NOT isfinite(p_sweep_started_at)
     OR p_sweep_started_at > clock_timestamp() + INTERVAL '5 minutes'
     OR p_sweep_started_at < clock_timestamp() - INTERVAL '24 hours'
     OR p_expected_product_count NOT BETWEEN 1 AND 500
     OR NOT EXISTS (
       SELECT 1
         FROM public.companies
        WHERE id::TEXT = btrim(p_company_id)
          AND user_id = p_user_id
     ) THEN
    RAISE EXCEPTION 'invalid catalog sweep binding'
      USING ERRCODE = '22023';
  END IF;

  SELECT count(*)::INTEGER INTO v_verified
    FROM public.ecommerce_products
   WHERE user_id = p_user_id
     AND source = v_source
     AND catalog_synced_at >= p_sweep_started_at;

  IF v_verified < p_expected_product_count THEN
    RETURN QUERY SELECT FALSE, v_verified, 0;
    RETURN;
  END IF;

  UPDATE public.ecommerce_products
     SET catalog_active = FALSE,
         availability = 'discontinued'
   WHERE user_id = p_user_id
     AND source = v_source
     AND catalog_active = TRUE
     AND (
       catalog_synced_at IS NULL
       OR catalog_synced_at < p_sweep_started_at
     );
  GET DIAGNOSTICS v_tombstoned = ROW_COUNT;

  UPDATE public.ecommerce_products
     SET catalog_active = TRUE
   WHERE user_id = p_user_id
     AND source = v_source
     AND catalog_synced_at >= p_sweep_started_at;

  INSERT INTO public.ecommerce_catalog_sync_state (
    user_id, company_id, source, expected_product_count,
    active_product_count, last_sweep_started_at, last_completed_at,
    tombstoned_product_count
  ) VALUES (
    p_user_id, btrim(p_company_id), v_source, p_expected_product_count,
    v_verified, p_sweep_started_at, clock_timestamp(), v_tombstoned
  )
  ON CONFLICT (user_id, source) DO UPDATE SET
    company_id = EXCLUDED.company_id,
    expected_product_count = EXCLUDED.expected_product_count,
    active_product_count = EXCLUDED.active_product_count,
    last_sweep_started_at = EXCLUDED.last_sweep_started_at,
    last_completed_at = EXCLUDED.last_completed_at,
    tombstoned_product_count = EXCLUDED.tombstoned_product_count;

  RETURN QUERY SELECT TRUE, v_verified, v_tombstoned;
END;
$$;

REVOKE ALL ON FUNCTION public.finalize_myhonor_ecommerce_catalog_sweep(
  UUID, TEXT, TIMESTAMPTZ, INTEGER
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_myhonor_ecommerce_catalog_sweep(
  UUID, TEXT, TIMESTAMPTZ, INTEGER
) TO service_role;
