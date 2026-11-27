-- Use the same owner, company and approval boundary for direct PostgREST reads
-- as for the portal. The earlier policies still select only published facts.
CREATE OR REPLACE FUNCTION public.store_can_read_own_company(p_user_id uuid, p_company_id text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT p_user_id = auth.uid() AND EXISTS (
    SELECT 1
    FROM public.companies c
    JOIN public.profiles p ON p.id = c.user_id
    WHERE c.id::text = p_company_id
      AND c.user_id = p_user_id
      AND p.status = 'approved'
      AND p.role IN ('client', 'admin', 'super_admin')
  )
$$;

REVOKE ALL ON FUNCTION public.store_can_read_own_company(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.store_can_read_own_company(uuid, text) TO authenticated;

DO $$
DECLARE
  relation text;
BEGIN
  FOREACH relation IN ARRAY ARRAY[
    'store_import_runs', 'store_warehouses', 'store_product_variants',
    'store_price_snapshots', 'store_inventory_snapshots', 'store_sales_lines',
    'store_import_variant_mappings', 'store_financial_imports', 'store_financial_periods',
    'ecommerce_products', 'ecommerce_orders', 'ecommerce_order_ingest_events',
    'ecommerce_order_ingest_state', 'ecommerce_catalog_sync_state', 'ecommerce_catalog_sweeps'
  ]
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS store_company_owner_guard ON public.%I', relation);
    EXECUTE format(
      'CREATE POLICY store_company_owner_guard ON public.%I AS RESTRICTIVE FOR SELECT TO authenticated
       USING (public.store_can_read_own_company(user_id, company_id))',
      relation
    );
  END LOOP;
END $$;

DROP POLICY IF EXISTS store_company_owner_guard ON public.ecommerce_order_items;
CREATE POLICY store_company_owner_guard ON public.ecommerce_order_items
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.ecommerce_orders AS parent
      WHERE parent.id = ecommerce_order_items.order_id
        AND parent.user_id = ecommerce_order_items.user_id
        AND public.store_can_read_own_company(parent.user_id, parent.company_id)
    )
  );
