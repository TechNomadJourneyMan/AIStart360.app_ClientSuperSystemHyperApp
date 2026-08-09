-- Persist bounded, server-verified public MyHonor catalog snapshots.
--
-- The caller cannot write the tables directly. The service-only RPC validates
-- the fixed MyHonor shape and binds every row to the configured owner/company.

CREATE OR REPLACE FUNCTION public.sync_myhonor_ecommerce_catalog(
  p_user_id UUID,
  p_company_id TEXT,
  p_products JSONB
)
RETURNS TABLE (
  upserted_count INTEGER,
  latest_synced_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_source CONSTANT TEXT := 'myhonor.shop';
  v_product JSONB;
  v_external_id TEXT;
  v_sku TEXT;
  v_name TEXT;
  v_url TEXT;
  v_image_url TEXT;
  v_brand TEXT;
  v_description TEXT;
  v_price NUMERIC(18,2);
  v_availability TEXT;
  v_source_hash TEXT;
  v_synced_at TIMESTAMPTZ;
  v_count INTEGER := 0;
  v_latest TIMESTAMPTZ := NULL;
BEGIN
  IF p_user_id IS NULL
     OR NOT EXISTS (
       SELECT 1 FROM public.profiles WHERE id = p_user_id
     ) THEN
    RAISE EXCEPTION 'invalid catalog owner binding'
      USING ERRCODE = '22023';
  END IF;
  IF p_company_id IS NULL
     OR length(btrim(p_company_id)) NOT BETWEEN 1 AND 200
     OR NOT EXISTS (
       SELECT 1
         FROM public.companies
        WHERE id::TEXT = btrim(p_company_id)
          AND user_id = p_user_id
     ) THEN
    RAISE EXCEPTION 'invalid catalog company binding'
      USING ERRCODE = '22023';
  END IF;
  IF p_products IS NULL
     OR jsonb_typeof(p_products) <> 'array'
     OR jsonb_array_length(p_products) NOT BETWEEN 1 AND 24
     OR pg_column_size(p_products) > 262144 THEN
    RAISE EXCEPTION 'invalid catalog payload shape'
      USING ERRCODE = '22023';
  END IF;

  FOR v_product IN SELECT value FROM jsonb_array_elements(p_products)
  LOOP
    IF jsonb_typeof(v_product) <> 'object'
       OR v_product - ARRAY[
         'external_id', 'sku', 'name', 'url', 'image_url', 'brand',
         'description', 'price', 'currency', 'availability', 'source_hash',
         'synced_at'
       ]::TEXT[] <> '{}'::JSONB THEN
      RAISE EXCEPTION 'invalid catalog product shape'
        USING ERRCODE = '22023';
    END IF;

    BEGIN
      v_external_id := btrim(v_product->>'external_id');
      v_sku := btrim(v_product->>'sku');
      v_name := btrim(v_product->>'name');
      v_url := v_product->>'url';
      v_image_url := v_product->>'image_url';
      v_brand := nullif(btrim(v_product->>'brand'), '');
      v_description := nullif(btrim(v_product->>'description'), '');
      v_price := (v_product->>'price')::NUMERIC(18,2);
      v_availability := v_product->>'availability';
      v_source_hash := v_product->>'source_hash';
      v_synced_at := (v_product->>'synced_at')::TIMESTAMPTZ;
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'invalid catalog product values'
        USING ERRCODE = '22023';
    END;

    IF v_external_id IS NULL
       OR v_external_id !~ '^myhonor:[a-f0-9]{64}$'
       OR v_sku IS NULL OR length(v_sku) NOT BETWEEN 1 AND 160
       OR v_name IS NULL OR length(v_name) NOT BETWEEN 1 AND 300
       OR v_url IS NULL
       OR length(v_url) > 1000
       OR v_url !~ '^https://myhonor[.]shop/product/[a-z0-9-]+/?$'
       OR (
         v_image_url IS NOT NULL
         AND (
           length(v_image_url) > 1000
           OR v_image_url NOT LIKE 'https://%'
         )
       )
       OR (
         v_brand IS NOT NULL
         AND length(v_brand) NOT BETWEEN 1 AND 160
       )
       OR (
         v_description IS NOT NULL
         AND length(v_description) NOT BETWEEN 1 AND 2000
       )
       OR v_price IS NULL OR v_price < 0
       OR v_product->>'currency' IS DISTINCT FROM 'KZT'
       OR v_availability NOT IN (
         'in_stock', 'out_of_stock', 'preorder', 'discontinued', 'unknown'
       )
       OR v_source_hash IS NULL
       OR v_source_hash !~ '^[a-f0-9]{64}$'
       OR v_synced_at IS NULL
       OR NOT isfinite(v_synced_at)
       OR v_synced_at > clock_timestamp() + INTERVAL '5 minutes' THEN
      RAISE EXCEPTION 'invalid catalog product'
        USING ERRCODE = '22023';
    END IF;

    INSERT INTO public.ecommerce_products (
      user_id, company_id, source, external_id, sku, name, url, image_url,
      brand, description, price, currency, availability, source_hash, synced_at,
      catalog_synced_at, catalog_active
    ) VALUES (
      p_user_id, btrim(p_company_id), v_source, v_external_id, v_sku, v_name,
      v_url, v_image_url, v_brand, v_description, v_price, 'KZT',
      v_availability, v_source_hash, v_synced_at, v_synced_at, TRUE
    )
    ON CONFLICT (user_id, source, external_id) DO UPDATE SET
      company_id = EXCLUDED.company_id,
      sku = EXCLUDED.sku,
      name = EXCLUDED.name,
      url = EXCLUDED.url,
      image_url = EXCLUDED.image_url,
      brand = EXCLUDED.brand,
      description = EXCLUDED.description,
      price = EXCLUDED.price,
      currency = EXCLUDED.currency,
      availability = EXCLUDED.availability,
      source_hash = EXCLUDED.source_hash,
      synced_at = EXCLUDED.synced_at,
      catalog_synced_at = EXCLUDED.catalog_synced_at,
      catalog_active = TRUE;

    v_count := v_count + 1;
    IF v_latest IS NULL OR v_synced_at > v_latest THEN
      v_latest := v_synced_at;
    END IF;
  END LOOP;

  RETURN QUERY SELECT v_count, v_latest;
END;
$$;

REVOKE ALL ON FUNCTION public.sync_myhonor_ecommerce_catalog(
  UUID, TEXT, JSONB
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sync_myhonor_ecommerce_catalog(
  UUID, TEXT, JSONB
) TO service_role;
