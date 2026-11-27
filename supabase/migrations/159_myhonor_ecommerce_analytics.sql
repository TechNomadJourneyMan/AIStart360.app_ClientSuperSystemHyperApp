-- Normalized, owner-readable ecommerce analytics for myhonor.shop.
--
-- Writes are available only through the service-role-only transactional RPC.
-- The webhook cannot choose user_id/company_id; the server supplies its
-- configured binding. No raw customer email, phone, address, or name is stored.

CREATE TABLE IF NOT EXISTS public.ecommerce_products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  company_id TEXT NOT NULL CHECK (length(btrim(company_id)) BETWEEN 1 AND 200),
  source TEXT NOT NULL DEFAULT 'myhonor.shop'
    CHECK (source = 'myhonor.shop'),
  external_id TEXT NOT NULL
    CHECK (
      external_id ~ '^myhonor:[a-f0-9]{64}$'
    ),
  sku TEXT NOT NULL CHECK (length(btrim(sku)) BETWEEN 1 AND 160),
  name TEXT NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 300),
  url TEXT CHECK (
    url IS NULL
    OR (length(url) <= 1000 AND url LIKE 'https://%')
  ),
  image_url TEXT CHECK (
    image_url IS NULL
    OR (length(image_url) <= 1000 AND image_url LIKE 'https://%')
  ),
  brand TEXT CHECK (
    brand IS NULL OR length(btrim(brand)) BETWEEN 1 AND 160
  ),
  description TEXT CHECK (
    description IS NULL OR length(btrim(description)) BETWEEN 1 AND 2000
  ),
  price NUMERIC(18,2) NOT NULL CHECK (price >= 0),
  currency TEXT NOT NULL DEFAULT 'KZT' CHECK (currency = 'KZT'),
  availability TEXT NOT NULL DEFAULT 'unknown'
    CHECK (
      availability IN (
        'in_stock', 'out_of_stock', 'preorder', 'discontinued', 'unknown'
      )
    ),
  source_hash TEXT NOT NULL CHECK (source_hash ~ '^[a-f0-9]{64}$'),
  synced_at TIMESTAMPTZ NOT NULL DEFAULT now() CHECK (isfinite(synced_at)),
  -- Non-null only after the public catalog crawler verified this product.
  catalog_synced_at TIMESTAMPTZ
    CHECK (catalog_synced_at IS NULL OR isfinite(catalog_synced_at)),
  catalog_active BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, source, external_id)
);

CREATE TABLE IF NOT EXISTS public.ecommerce_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  company_id TEXT NOT NULL CHECK (length(btrim(company_id)) BETWEEN 1 AND 200),
  source TEXT NOT NULL DEFAULT 'myhonor.shop'
    CHECK (source = 'myhonor.shop'),
  external_id TEXT NOT NULL
    CHECK (
      length(btrim(external_id)) BETWEEN 1 AND 200
      AND external_id ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]*$'
    ),
  order_number TEXT NOT NULL
    CHECK (length(btrim(order_number)) BETWEEN 1 AND 100),
  status TEXT NOT NULL
    CHECK (
      status IN (
        'pending', 'confirmed', 'paid', 'processing', 'shipped', 'delivered',
        'cancelled', 'partially_refunded', 'refunded'
      )
    ),
  status_version INTEGER NOT NULL
    CHECK (status_version BETWEEN 1 AND 1000000000),
  placed_at TIMESTAMPTZ NOT NULL CHECK (isfinite(placed_at)),
  paid_at TIMESTAMPTZ CHECK (paid_at IS NULL OR isfinite(paid_at)),
  cancelled_at TIMESTAMPTZ
    CHECK (cancelled_at IS NULL OR isfinite(cancelled_at)),
  -- Source-system update time. This deliberately is not an audit trigger time.
  updated_at TIMESTAMPTZ NOT NULL CHECK (isfinite(updated_at)),
  currency TEXT NOT NULL DEFAULT 'KZT' CHECK (currency = 'KZT'),
  gross_amount NUMERIC(18,2) NOT NULL CHECK (gross_amount >= 0),
  discount_amount NUMERIC(18,2) NOT NULL
    CHECK (discount_amount >= 0 AND discount_amount <= gross_amount),
  shipping_amount NUMERIC(18,2) NOT NULL CHECK (shipping_amount >= 0),
  refund_amount NUMERIC(18,2) NOT NULL CHECK (refund_amount >= 0),
  net_paid_amount NUMERIC(18,2) NOT NULL CHECK (net_paid_amount >= 0),
  -- Stable salted SHA-256 pseudonym supplied by MyHonor; never raw PII.
  customer_hash TEXT NOT NULL CHECK (customer_hash ~ '^[a-f0-9]{64}$'),
  source_hash TEXT NOT NULL CHECK (source_hash ~ '^[a-f0-9]{64}$'),
  current_event_id TEXT NOT NULL
    CHECK (
      length(current_event_id) BETWEEN 12 AND 200
      AND current_event_id ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]*$'
    ),
  synced_at TIMESTAMPTZ NOT NULL DEFAULT now() CHECK (isfinite(synced_at)),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, source, external_id),
  CONSTRAINT ecommerce_orders_timestamp_order CHECK (
    updated_at >= placed_at
    AND (paid_at IS NULL OR paid_at >= placed_at)
    AND (cancelled_at IS NULL OR cancelled_at >= placed_at)
  ),
  CONSTRAINT ecommerce_orders_refund_bound CHECK (
    refund_amount <= gross_amount - discount_amount + shipping_amount
  ),
  CONSTRAINT ecommerce_orders_payment_semantics CHECK (
    (
      status = 'pending'
      AND paid_at IS NULL
      AND cancelled_at IS NULL
      AND refund_amount = 0
      AND net_paid_amount = 0
    )
    OR (
      status = 'confirmed'
      AND cancelled_at IS NULL
      AND refund_amount = 0
      AND net_paid_amount = CASE
        WHEN paid_at IS NULL THEN 0
        ELSE gross_amount - discount_amount + shipping_amount
      END
    )
    OR (
      status IN ('paid', 'processing', 'shipped', 'delivered')
      AND paid_at IS NOT NULL
      AND cancelled_at IS NULL
      AND refund_amount = 0
      AND net_paid_amount = gross_amount - discount_amount + shipping_amount
    )
    OR (
      status = 'cancelled'
      AND cancelled_at IS NOT NULL
      AND net_paid_amount = 0
      AND refund_amount = CASE
        WHEN paid_at IS NULL THEN 0
        ELSE gross_amount - discount_amount + shipping_amount
      END
    )
    OR (
      status = 'partially_refunded'
      AND paid_at IS NOT NULL
      AND cancelled_at IS NULL
      AND refund_amount > 0
      AND refund_amount < gross_amount - discount_amount + shipping_amount
      AND net_paid_amount =
        gross_amount - discount_amount + shipping_amount - refund_amount
    )
    OR (
      status = 'refunded'
      AND paid_at IS NOT NULL
      AND cancelled_at IS NULL
      AND refund_amount = gross_amount - discount_amount + shipping_amount
      AND net_paid_amount = 0
    )
  )
);

CREATE TABLE IF NOT EXISTS public.ecommerce_order_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL
    REFERENCES public.ecommerce_orders(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  source TEXT NOT NULL DEFAULT 'myhonor.shop'
    CHECK (source = 'myhonor.shop'),
  external_line_id TEXT NOT NULL
    CHECK (
      length(btrim(external_line_id)) BETWEEN 1 AND 200
      AND external_line_id ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]*$'
    ),
  product_external_id TEXT NOT NULL
    CHECK (
      product_external_id ~ '^myhonor:[a-f0-9]{64}$'
    ),
  sku TEXT NOT NULL CHECK (length(btrim(sku)) BETWEEN 1 AND 160),
  name TEXT NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 300),
  quantity INTEGER NOT NULL CHECK (quantity BETWEEN 1 AND 100000),
  unit_price NUMERIC(18,2) NOT NULL CHECK (unit_price >= 0),
  line_total NUMERIC(18,2) NOT NULL CHECK (
    line_total >= 0 AND line_total = unit_price * quantity
  ),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (order_id, external_line_id)
);

CREATE TABLE IF NOT EXISTS public.ecommerce_order_ingest_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  company_id TEXT NOT NULL CHECK (length(btrim(company_id)) BETWEEN 1 AND 200),
  source TEXT NOT NULL DEFAULT 'myhonor.shop'
    CHECK (source = 'myhonor.shop'),
  event_id TEXT NOT NULL
    CHECK (
      length(event_id) BETWEEN 12 AND 200
      AND event_id ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]*$'
    ),
  event_hash TEXT NOT NULL CHECK (event_hash ~ '^[a-f0-9]{64}$'),
  order_id UUID NOT NULL
    REFERENCES public.ecommerce_orders(id) ON DELETE CASCADE,
  order_external_id TEXT NOT NULL,
  status_version INTEGER NOT NULL
    CHECK (status_version BETWEEN 1 AND 1000000000),
  occurred_at TIMESTAMPTZ NOT NULL CHECK (isfinite(occurred_at)),
  result TEXT NOT NULL
    CHECK (
      result IN ('applied', 'out_of_order', 'duplicate_version', 'conflict')
    ),
  received_at TIMESTAMPTZ NOT NULL DEFAULT now() CHECK (isfinite(received_at)),
  UNIQUE (user_id, source, event_id)
);

CREATE TABLE IF NOT EXISTS public.ecommerce_order_ingest_state (
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  company_id TEXT NOT NULL CHECK (length(btrim(company_id)) BETWEEN 1 AND 200),
  source TEXT NOT NULL DEFAULT 'myhonor.shop'
    CHECK (source = 'myhonor.shop'),
  last_event_id TEXT,
  last_status_version INTEGER,
  last_received_at TIMESTAMPTZ,
  last_applied_at TIMESTAMPTZ,
  applied_events BIGINT NOT NULL DEFAULT 0 CHECK (applied_events >= 0),
  ignored_events BIGINT NOT NULL DEFAULT 0 CHECK (ignored_events >= 0),
  conflict_events BIGINT NOT NULL DEFAULT 0 CHECK (conflict_events >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, source)
);

CREATE INDEX IF NOT EXISTS idx_ecommerce_orders_owner_placed
  ON public.ecommerce_orders (user_id, source, placed_at DESC);
CREATE INDEX IF NOT EXISTS idx_ecommerce_orders_owner_status
  ON public.ecommerce_orders (user_id, source, status, placed_at DESC);
CREATE INDEX IF NOT EXISTS idx_ecommerce_order_items_owner_product
  ON public.ecommerce_order_items (
    user_id, source, product_external_id, order_id
  );
CREATE INDEX IF NOT EXISTS idx_ecommerce_ingest_events_order
  ON public.ecommerce_order_ingest_events (
    user_id, source, order_external_id, status_version DESC
  );

COMMENT ON TABLE public.ecommerce_orders IS
  'Normalized MyHonor orders. customer_hash is a stable pseudonym; raw customer PII is prohibited.';
COMMENT ON COLUMN public.ecommerce_orders.net_paid_amount IS
  'KZT actually retained after refunds; cancelled/refunded orders retain zero.';
COMMENT ON TABLE public.ecommerce_order_ingest_events IS
  'Immutable idempotency and ordering decisions for signed MyHonor events.';
COMMENT ON TABLE public.ecommerce_order_ingest_state IS
  'Per-owner/source ingest health counters; contains no webhook payload or PII.';

ALTER TABLE public.ecommerce_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ecommerce_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ecommerce_order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ecommerce_order_ingest_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ecommerce_order_ingest_state ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.ecommerce_products
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.ecommerce_orders
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.ecommerce_order_items
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.ecommerce_order_ingest_events
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.ecommerce_order_ingest_state
  FROM PUBLIC, anon, authenticated, service_role;

GRANT SELECT ON TABLE public.ecommerce_products TO authenticated;
GRANT SELECT ON TABLE public.ecommerce_orders TO authenticated;
GRANT SELECT ON TABLE public.ecommerce_order_items TO authenticated;
GRANT SELECT ON TABLE public.ecommerce_order_ingest_events TO authenticated;
GRANT SELECT ON TABLE public.ecommerce_order_ingest_state TO authenticated;

DROP POLICY IF EXISTS ecommerce_products_owner_read
  ON public.ecommerce_products;
CREATE POLICY ecommerce_products_owner_read
  ON public.ecommerce_products
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS ecommerce_orders_owner_read
  ON public.ecommerce_orders;
CREATE POLICY ecommerce_orders_owner_read
  ON public.ecommerce_orders
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS ecommerce_order_items_owner_read
  ON public.ecommerce_order_items;
CREATE POLICY ecommerce_order_items_owner_read
  ON public.ecommerce_order_items
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS ecommerce_order_ingest_events_owner_read
  ON public.ecommerce_order_ingest_events;
CREATE POLICY ecommerce_order_ingest_events_owner_read
  ON public.ecommerce_order_ingest_events
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS ecommerce_order_ingest_state_owner_read
  ON public.ecommerce_order_ingest_state;
CREATE POLICY ecommerce_order_ingest_state_owner_read
  ON public.ecommerce_order_ingest_state
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.ingest_myhonor_ecommerce_order(
  p_user_id UUID,
  p_company_id TEXT,
  p_event_id TEXT,
  p_event_hash TEXT,
  p_order_hash TEXT,
  p_occurred_at TIMESTAMPTZ,
  p_status_version INTEGER,
  p_order JSONB,
  p_items JSONB
)
RETURNS TABLE (
  order_id UUID,
  event_result TEXT,
  original_result TEXT,
  stored_status_version INTEGER,
  created BOOLEAN,
  applied BOOLEAN,
  conflict BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_source CONSTANT TEXT := 'myhonor.shop';
  v_now TIMESTAMPTZ := clock_timestamp();
  v_event public.ecommerce_order_ingest_events%ROWTYPE;
  v_existing public.ecommerce_orders%ROWTYPE;
  v_order_id UUID;
  v_created BOOLEAN := FALSE;
  v_result TEXT;
  v_external_id TEXT;
  v_order_number TEXT;
  v_status TEXT;
  v_placed_at TIMESTAMPTZ;
  v_paid_at TIMESTAMPTZ;
  v_cancelled_at TIMESTAMPTZ;
  v_updated_at TIMESTAMPTZ;
  v_gross NUMERIC(18,2);
  v_discount NUMERIC(18,2);
  v_shipping NUMERIC(18,2);
  v_refund NUMERIC(18,2);
  v_net_paid NUMERIC(18,2);
  v_payable NUMERIC(18,2);
  v_customer_hash TEXT;
  v_item JSONB;
  v_product JSONB;
  v_line_id TEXT;
  v_product_id TEXT;
  v_sku TEXT;
  v_name TEXT;
  v_quantity INTEGER;
  v_unit_price NUMERIC(18,2);
  v_line_total NUMERIC(18,2);
  v_items_total NUMERIC(18,2) := 0;
  v_product_hash TEXT;
  v_availability TEXT;
  v_line_ids TEXT[] := ARRAY[]::TEXT[];
  v_transition_allowed BOOLEAN;
  v_stored_status_version INTEGER;
BEGIN
  IF p_user_id IS NULL
     OR NOT EXISTS (
       SELECT 1 FROM public.profiles WHERE id = p_user_id
     ) THEN
    RAISE EXCEPTION 'invalid analytics owner binding'
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
    RAISE EXCEPTION 'invalid analytics company binding'
      USING ERRCODE = '22023';
  END IF;
  IF p_event_id IS NULL
     OR length(p_event_id) NOT BETWEEN 12 AND 200
     OR p_event_id !~ '^[A-Za-z0-9][A-Za-z0-9._:/-]*$'
     OR p_event_hash IS NULL OR p_event_hash !~ '^[a-f0-9]{64}$'
     OR p_order_hash IS NULL OR p_order_hash !~ '^[a-f0-9]{64}$'
     OR p_occurred_at IS NULL OR NOT isfinite(p_occurred_at)
     OR p_status_version IS NULL
     OR p_status_version NOT BETWEEN 1 AND 1000000000 THEN
    RAISE EXCEPTION 'invalid analytics event envelope'
      USING ERRCODE = '22023';
  END IF;
  IF p_order IS NULL
     OR jsonb_typeof(p_order) <> 'object'
     OR pg_column_size(p_order) > 32768
     OR p_items IS NULL
     OR jsonb_typeof(p_items) <> 'array'
     OR jsonb_array_length(p_items) NOT BETWEEN 1 AND 250
     OR pg_column_size(p_items) > 229376 THEN
    RAISE EXCEPTION 'invalid analytics payload shape'
      USING ERRCODE = '22023';
  END IF;
  IF p_order - ARRAY[
    'external_id', 'order_number', 'status', 'placed_at', 'paid_at',
    'cancelled_at', 'updated_at', 'currency', 'gross_amount',
    'discount_amount', 'shipping_amount', 'refund_amount',
    'net_paid_amount', 'customer_key'
  ]::TEXT[] <> '{}'::JSONB THEN
    RAISE EXCEPTION 'unknown analytics order fields'
      USING ERRCODE = '22023';
  END IF;

  BEGIN
    v_external_id := btrim(p_order->>'external_id');
    v_order_number := btrim(p_order->>'order_number');
    v_status := p_order->>'status';
    v_placed_at := (p_order->>'placed_at')::TIMESTAMPTZ;
    v_paid_at := (p_order->>'paid_at')::TIMESTAMPTZ;
    v_cancelled_at := (p_order->>'cancelled_at')::TIMESTAMPTZ;
    v_updated_at := (p_order->>'updated_at')::TIMESTAMPTZ;
    v_gross := (p_order->>'gross_amount')::NUMERIC(18,2);
    v_discount := (p_order->>'discount_amount')::NUMERIC(18,2);
    v_shipping := (p_order->>'shipping_amount')::NUMERIC(18,2);
    v_refund := (p_order->>'refund_amount')::NUMERIC(18,2);
    v_net_paid := (p_order->>'net_paid_amount')::NUMERIC(18,2);
    v_customer_hash := p_order->>'customer_key';
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'invalid analytics order values'
      USING ERRCODE = '22023';
  END;

  IF v_external_id IS NULL
     OR length(v_external_id) NOT BETWEEN 1 AND 200
     OR v_external_id !~ '^[A-Za-z0-9][A-Za-z0-9._:/-]*$'
     OR v_order_number IS NULL
     OR length(v_order_number) NOT BETWEEN 1 AND 100
     OR v_status NOT IN (
       'pending', 'confirmed', 'paid', 'processing', 'shipped', 'delivered',
       'cancelled', 'partially_refunded', 'refunded'
     )
     OR p_order->>'currency' IS DISTINCT FROM 'KZT'
     OR v_placed_at IS NULL OR NOT isfinite(v_placed_at)
     OR v_updated_at IS NULL OR NOT isfinite(v_updated_at)
     OR v_updated_at < v_placed_at
     OR (v_paid_at IS NOT NULL AND (
       NOT isfinite(v_paid_at) OR v_paid_at < v_placed_at
     ))
     OR (v_cancelled_at IS NOT NULL AND (
       NOT isfinite(v_cancelled_at) OR v_cancelled_at < v_placed_at
     ))
     OR v_gross IS NULL OR v_gross < 0
     OR v_discount IS NULL OR v_discount < 0 OR v_discount > v_gross
     OR v_shipping IS NULL OR v_shipping < 0
     OR v_refund IS NULL OR v_refund < 0
     OR v_net_paid IS NULL OR v_net_paid < 0
     OR v_customer_hash IS NULL
     OR v_customer_hash !~ '^[a-f0-9]{64}$' THEN
    RAISE EXCEPTION 'invalid analytics order'
      USING ERRCODE = '22023';
  END IF;

  v_payable := v_gross - v_discount + v_shipping;
  IF v_refund > v_payable
     OR NOT (
       (
         v_status = 'pending' AND v_paid_at IS NULL
         AND v_cancelled_at IS NULL AND v_refund = 0 AND v_net_paid = 0
       )
       OR (
         v_status = 'confirmed' AND v_cancelled_at IS NULL
         AND v_refund = 0
         AND v_net_paid = CASE WHEN v_paid_at IS NULL THEN 0 ELSE v_payable END
       )
       OR (
         v_status IN ('paid', 'processing', 'shipped', 'delivered')
         AND v_paid_at IS NOT NULL AND v_cancelled_at IS NULL
         AND v_refund = 0 AND v_net_paid = v_payable
       )
       OR (
         v_status = 'cancelled' AND v_cancelled_at IS NOT NULL
         AND v_net_paid = 0
         AND v_refund = CASE WHEN v_paid_at IS NULL THEN 0 ELSE v_payable END
       )
       OR (
         v_status = 'partially_refunded' AND v_paid_at IS NOT NULL
         AND v_cancelled_at IS NULL
         AND v_refund > 0 AND v_refund < v_payable
         AND v_net_paid = v_payable - v_refund
       )
       OR (
         v_status = 'refunded' AND v_paid_at IS NOT NULL
         AND v_cancelled_at IS NULL
         AND v_refund = v_payable AND v_net_paid = 0
       )
     ) THEN
    RAISE EXCEPTION 'invalid payment, cancellation, or refund semantics'
      USING ERRCODE = '22023';
  END IF;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items)
  LOOP
    IF jsonb_typeof(v_item) <> 'object'
       OR v_item - ARRAY[
         'external_line_id', 'product_external_id', 'sku', 'name',
         'quantity', 'unit_price', 'line_total', 'product',
         'product_source_hash'
       ]::TEXT[] <> '{}'::JSONB THEN
      RAISE EXCEPTION 'invalid analytics item shape'
        USING ERRCODE = '22023';
    END IF;
    BEGIN
      v_line_id := btrim(v_item->>'external_line_id');
      v_product_id := btrim(v_item->>'product_external_id');
      v_sku := btrim(v_item->>'sku');
      v_name := btrim(v_item->>'name');
      v_quantity := (v_item->>'quantity')::INTEGER;
      v_unit_price := (v_item->>'unit_price')::NUMERIC(18,2);
      v_line_total := (v_item->>'line_total')::NUMERIC(18,2);
      v_product := v_item->'product';
      v_product_hash := v_item->>'product_source_hash';
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'invalid analytics item values'
        USING ERRCODE = '22023';
    END;
    IF v_line_id IS NULL
       OR length(v_line_id) NOT BETWEEN 1 AND 200
       OR v_line_id !~ '^[A-Za-z0-9][A-Za-z0-9._:/-]*$'
       OR v_line_id = ANY(v_line_ids)
       OR v_product_id IS NULL
       OR v_product_id !~ '^myhonor:[a-f0-9]{64}$'
       OR v_sku IS NULL OR length(v_sku) NOT BETWEEN 1 AND 160
       OR v_name IS NULL OR length(v_name) NOT BETWEEN 1 AND 300
       OR v_quantity IS NULL OR v_quantity NOT BETWEEN 1 AND 100000
       OR v_unit_price IS NULL OR v_unit_price < 0
       OR v_line_total IS NULL
       OR v_line_total <> v_unit_price * v_quantity
       OR v_product_hash IS NULL
       OR v_product_hash !~ '^[a-f0-9]{64}$'
       OR v_product IS NULL OR jsonb_typeof(v_product) <> 'object'
       OR v_product - ARRAY[
         'url', 'image_url', 'brand', 'description', 'availability'
       ]::TEXT[] <> '{}'::JSONB THEN
      RAISE EXCEPTION 'invalid analytics item'
        USING ERRCODE = '22023';
    END IF;
    v_availability := COALESCE(v_product->>'availability', 'unknown');
    IF v_availability NOT IN (
         'in_stock', 'out_of_stock', 'preorder', 'discontinued', 'unknown'
       )
       OR (
         v_product->>'url' IS NOT NULL
         AND (
           length(v_product->>'url') > 1000
           OR v_product->>'url' NOT LIKE 'https://%'
         )
       )
       OR (
         v_product->>'image_url' IS NOT NULL
         AND (
           length(v_product->>'image_url') > 1000
           OR v_product->>'image_url' NOT LIKE 'https://%'
         )
       )
       OR (
         v_product->>'brand' IS NOT NULL
         AND length(btrim(v_product->>'brand')) NOT BETWEEN 1 AND 160
       )
       OR (
         v_product->>'description' IS NOT NULL
         AND length(btrim(v_product->>'description')) NOT BETWEEN 1 AND 2000
       ) THEN
      RAISE EXCEPTION 'invalid analytics product reference'
        USING ERRCODE = '22023';
    END IF;
    v_line_ids := array_append(v_line_ids, v_line_id);
    v_items_total := v_items_total + v_line_total;
  END LOOP;
  IF v_items_total <> v_gross THEN
    RAISE EXCEPTION 'item totals do not equal gross amount'
      USING ERRCODE = '22023';
  END IF;

  -- Event lock is always acquired before the order lock to avoid deadlocks.
  PERFORM pg_advisory_xact_lock(
    hashtextextended(
      'myhonor:event:' || p_user_id::TEXT || ':' || p_event_id,
      0
    )
  );
  SELECT * INTO v_event
    FROM public.ecommerce_order_ingest_events
   WHERE user_id = p_user_id
     AND source = v_source
     AND event_id = p_event_id
   FOR UPDATE;
  IF FOUND THEN
    INSERT INTO public.ecommerce_order_ingest_state (
      user_id, company_id, source, last_event_id, last_status_version,
      last_received_at, ignored_events, conflict_events, updated_at
    ) VALUES (
      p_user_id, btrim(p_company_id), v_source, p_event_id,
      v_event.status_version, v_now,
      CASE
        WHEN v_event.event_hash = p_event_hash
          AND v_event.result <> 'conflict' THEN 1
        ELSE 0
      END,
      CASE
        WHEN v_event.event_hash <> p_event_hash
          OR v_event.result = 'conflict' THEN 1
        ELSE 0
      END,
      v_now
    )
    ON CONFLICT (user_id, source) DO UPDATE SET
      company_id = EXCLUDED.company_id,
      last_event_id = EXCLUDED.last_event_id,
      last_status_version = EXCLUDED.last_status_version,
      last_received_at = EXCLUDED.last_received_at,
      ignored_events =
        public.ecommerce_order_ingest_state.ignored_events
        + EXCLUDED.ignored_events,
      conflict_events =
        public.ecommerce_order_ingest_state.conflict_events
        + EXCLUDED.conflict_events,
      updated_at = EXCLUDED.updated_at;

    SELECT existing_order.status_version INTO v_stored_status_version
      FROM public.ecommerce_orders AS existing_order
     WHERE id = v_event.order_id;
    RETURN QUERY SELECT
      v_event.order_id,
      CASE
        WHEN v_event.event_hash = p_event_hash THEN 'duplicate'
        ELSE 'conflict'
      END,
      v_event.result,
      v_stored_status_version,
      FALSE,
      FALSE,
      (
        v_event.event_hash <> p_event_hash
        OR v_event.result = 'conflict'
      );
    RETURN;
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(
      'myhonor:order:' || p_user_id::TEXT || ':' || v_external_id,
      0
    )
  );
  SELECT * INTO v_existing
    FROM public.ecommerce_orders
   WHERE user_id = p_user_id
     AND source = v_source
     AND external_id = v_external_id
   FOR UPDATE;

  IF FOUND THEN
    v_order_id := v_existing.id;
    IF p_status_version < v_existing.status_version
       OR (
         p_status_version > v_existing.status_version
         AND v_updated_at < v_existing.updated_at
       ) THEN
      v_result := 'out_of_order';
    ELSIF p_status_version = v_existing.status_version THEN
      v_result := CASE
        WHEN p_order_hash = v_existing.source_hash
          THEN 'duplicate_version'
        ELSE 'conflict'
      END;
    ELSE
      v_transition_allowed := CASE
        WHEN v_existing.status = v_status THEN TRUE
        WHEN v_existing.status IN (
          'pending', 'confirmed', 'paid', 'processing', 'shipped', 'delivered'
        ) AND v_status IN (
          'pending', 'confirmed', 'paid', 'processing', 'shipped', 'delivered'
        ) THEN
          array_position(
            ARRAY[
              'pending', 'confirmed', 'paid', 'processing', 'shipped',
              'delivered'
            ]::TEXT[],
            v_status
          ) >= array_position(
            ARRAY[
              'pending', 'confirmed', 'paid', 'processing', 'shipped',
              'delivered'
            ]::TEXT[],
            v_existing.status
          )
        WHEN v_existing.status IN (
          'pending', 'confirmed', 'paid', 'processing', 'shipped'
        ) AND v_status = 'cancelled' THEN TRUE
        WHEN v_existing.status IN (
          'confirmed', 'paid', 'processing', 'shipped', 'delivered'
        ) AND v_status IN ('partially_refunded', 'refunded') THEN TRUE
        WHEN v_existing.status = 'partially_refunded'
          AND v_status IN (
            'partially_refunded', 'refunded', 'cancelled'
          ) THEN TRUE
        ELSE FALSE
      END;
      IF NOT v_transition_allowed THEN
        v_result := 'conflict';
      END IF;
    END IF;
  ELSE
    v_created := TRUE;
    v_transition_allowed := TRUE;
  END IF;

  IF v_result IS NOT NULL THEN
    INSERT INTO public.ecommerce_order_ingest_events (
      user_id, company_id, source, event_id, event_hash, order_id,
      order_external_id, status_version, occurred_at, result, received_at
    ) VALUES (
      p_user_id, btrim(p_company_id), v_source, p_event_id, p_event_hash,
      v_order_id, v_external_id, p_status_version, p_occurred_at, v_result,
      v_now
    );
    INSERT INTO public.ecommerce_order_ingest_state (
      user_id, company_id, source, last_event_id, last_status_version,
      last_received_at, ignored_events, conflict_events, updated_at
    ) VALUES (
      p_user_id, btrim(p_company_id), v_source, p_event_id,
      v_existing.status_version, v_now,
      CASE WHEN v_result <> 'conflict' THEN 1 ELSE 0 END,
      CASE WHEN v_result = 'conflict' THEN 1 ELSE 0 END,
      v_now
    )
    ON CONFLICT (user_id, source) DO UPDATE SET
      company_id = EXCLUDED.company_id,
      last_event_id = EXCLUDED.last_event_id,
      last_status_version = EXCLUDED.last_status_version,
      last_received_at = EXCLUDED.last_received_at,
      ignored_events =
        public.ecommerce_order_ingest_state.ignored_events
        + EXCLUDED.ignored_events,
      conflict_events =
        public.ecommerce_order_ingest_state.conflict_events
        + EXCLUDED.conflict_events,
      updated_at = EXCLUDED.updated_at;

    RETURN QUERY SELECT
      v_order_id,
      v_result,
      v_result,
      v_existing.status_version,
      FALSE,
      FALSE,
      v_result = 'conflict';
    RETURN;
  END IF;

  IF v_created THEN
    INSERT INTO public.ecommerce_orders (
      user_id, company_id, source, external_id, order_number, status,
      status_version, placed_at, paid_at, cancelled_at, updated_at, currency,
      gross_amount, discount_amount, shipping_amount, refund_amount,
      net_paid_amount, customer_hash, source_hash, current_event_id, synced_at
    ) VALUES (
      p_user_id, btrim(p_company_id), v_source, v_external_id, v_order_number,
      v_status, p_status_version, v_placed_at, v_paid_at, v_cancelled_at,
      v_updated_at, 'KZT', v_gross, v_discount, v_shipping, v_refund,
      v_net_paid, v_customer_hash, p_order_hash, p_event_id, v_now
    )
    RETURNING id INTO v_order_id;
  ELSE
    UPDATE public.ecommerce_orders SET
      company_id = btrim(p_company_id),
      order_number = v_order_number,
      status = v_status,
      status_version = p_status_version,
      placed_at = v_placed_at,
      paid_at = v_paid_at,
      cancelled_at = v_cancelled_at,
      updated_at = v_updated_at,
      currency = 'KZT',
      gross_amount = v_gross,
      discount_amount = v_discount,
      shipping_amount = v_shipping,
      refund_amount = v_refund,
      net_paid_amount = v_net_paid,
      customer_hash = v_customer_hash,
      source_hash = p_order_hash,
      current_event_id = p_event_id,
      synced_at = v_now
    WHERE id = v_order_id;
    DELETE FROM public.ecommerce_order_items AS item
      WHERE item.order_id = v_order_id;
  END IF;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items)
  LOOP
    v_line_id := btrim(v_item->>'external_line_id');
    v_product_id := btrim(v_item->>'product_external_id');
    v_sku := btrim(v_item->>'sku');
    v_name := btrim(v_item->>'name');
    v_quantity := (v_item->>'quantity')::INTEGER;
    v_unit_price := (v_item->>'unit_price')::NUMERIC(18,2);
    v_line_total := (v_item->>'line_total')::NUMERIC(18,2);
    v_product := v_item->'product';
    v_product_hash := v_item->>'product_source_hash';
    v_availability := COALESCE(v_product->>'availability', 'unknown');

    INSERT INTO public.ecommerce_products (
      user_id, company_id, source, external_id, sku, name, url, image_url,
      brand, description, price, currency, availability, source_hash, synced_at
    ) VALUES (
      p_user_id, btrim(p_company_id), v_source, v_product_id, v_sku, v_name,
      v_product->>'url', v_product->>'image_url', v_product->>'brand',
      v_product->>'description', v_unit_price, 'KZT', v_availability,
      v_product_hash, v_now
    )
    ON CONFLICT (user_id, source, external_id) DO UPDATE SET
      company_id = EXCLUDED.company_id,
      -- A public-catalog row has catalog_synced_at and is authoritative for
      -- current merchandising facts. Transaction snapshots must not replace
      -- its current price/availability with an old order-line price.
      sku = CASE
        WHEN public.ecommerce_products.catalog_synced_at IS NULL
          THEN EXCLUDED.sku
        ELSE public.ecommerce_products.sku
      END,
      name = CASE
        WHEN public.ecommerce_products.catalog_synced_at IS NULL
          THEN EXCLUDED.name
        ELSE public.ecommerce_products.name
      END,
      url = CASE
        WHEN public.ecommerce_products.catalog_synced_at IS NULL
          THEN COALESCE(EXCLUDED.url, public.ecommerce_products.url)
        ELSE public.ecommerce_products.url
      END,
      image_url = CASE
        WHEN public.ecommerce_products.catalog_synced_at IS NULL
          THEN COALESCE(
            EXCLUDED.image_url,
            public.ecommerce_products.image_url
          )
        ELSE public.ecommerce_products.image_url
      END,
      brand = CASE
        WHEN public.ecommerce_products.catalog_synced_at IS NULL
          THEN COALESCE(EXCLUDED.brand, public.ecommerce_products.brand)
        ELSE public.ecommerce_products.brand
      END,
      description = CASE
        WHEN public.ecommerce_products.catalog_synced_at IS NULL
          THEN COALESCE(
            EXCLUDED.description,
            public.ecommerce_products.description
          )
        ELSE public.ecommerce_products.description
      END,
      price = CASE
        WHEN public.ecommerce_products.catalog_synced_at IS NULL
          THEN EXCLUDED.price
        ELSE public.ecommerce_products.price
      END,
      currency = 'KZT',
      availability = CASE
        WHEN public.ecommerce_products.catalog_synced_at IS NULL
          THEN EXCLUDED.availability
        ELSE public.ecommerce_products.availability
      END,
      source_hash = CASE
        WHEN public.ecommerce_products.catalog_synced_at IS NULL
          THEN EXCLUDED.source_hash
        ELSE public.ecommerce_products.source_hash
      END,
      synced_at = CASE
        WHEN public.ecommerce_products.catalog_synced_at IS NULL
          THEN EXCLUDED.synced_at
        ELSE public.ecommerce_products.synced_at
      END;

    INSERT INTO public.ecommerce_order_items (
      order_id, user_id, source, external_line_id, product_external_id, sku,
      name, quantity, unit_price, line_total
    ) VALUES (
      v_order_id, p_user_id, v_source, v_line_id, v_product_id, v_sku, v_name,
      v_quantity, v_unit_price, v_line_total
    );
  END LOOP;

  INSERT INTO public.ecommerce_order_ingest_events (
    user_id, company_id, source, event_id, event_hash, order_id,
    order_external_id, status_version, occurred_at, result, received_at
  ) VALUES (
    p_user_id, btrim(p_company_id), v_source, p_event_id, p_event_hash,
    v_order_id, v_external_id, p_status_version, p_occurred_at, 'applied',
    v_now
  );
  INSERT INTO public.ecommerce_order_ingest_state (
    user_id, company_id, source, last_event_id, last_status_version,
    last_received_at, last_applied_at, applied_events, updated_at
  ) VALUES (
    p_user_id, btrim(p_company_id), v_source, p_event_id, p_status_version,
    v_now, v_now, 1, v_now
  )
  ON CONFLICT (user_id, source) DO UPDATE SET
    company_id = EXCLUDED.company_id,
    last_event_id = EXCLUDED.last_event_id,
    last_status_version = EXCLUDED.last_status_version,
    last_received_at = EXCLUDED.last_received_at,
    last_applied_at = EXCLUDED.last_applied_at,
    applied_events =
      public.ecommerce_order_ingest_state.applied_events + 1,
    updated_at = EXCLUDED.updated_at;

  RETURN QUERY SELECT
    v_order_id,
    'applied'::TEXT,
    'applied'::TEXT,
    p_status_version,
    v_created,
    TRUE,
    FALSE;
END;
$$;

REVOKE ALL ON FUNCTION public.ingest_myhonor_ecommerce_order(
  UUID, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ, INTEGER, JSONB, JSONB
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ingest_myhonor_ecommerce_order(
  UUID, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ, INTEGER, JSONB, JSONB
) TO service_role;
