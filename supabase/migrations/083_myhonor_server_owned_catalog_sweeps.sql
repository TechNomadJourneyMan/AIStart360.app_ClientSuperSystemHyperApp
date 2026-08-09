-- Server-owned, fenced MyHonor catalog sweeps.
--
-- Migrations 079-082 (numbered 075-078 before the AIStart360 merge) are already
-- deployed in production under their old file names. This additive
-- migration replaces the timestamp/count completion protocol with a durable
-- database-owned sweep, a frozen ordered manifest, and an exact-set finalize.

CREATE TABLE IF NOT EXISTS public.ecommerce_catalog_sweeps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  company_id TEXT NOT NULL CHECK (length(btrim(company_id)) BETWEEN 1 AND 200),
  source TEXT NOT NULL DEFAULT 'myhonor.shop'
    CHECK (source = 'myhonor.shop'),
  generation BIGINT NOT NULL CHECK (generation >= 1),
  status TEXT NOT NULL DEFAULT 'in_progress'
    CHECK (status IN ('in_progress', 'completed', 'failed', 'superseded')),
  manifest_hash TEXT NOT NULL CHECK (manifest_hash ~ '^[a-f0-9]{64}$'),
  expected_product_count INTEGER NOT NULL
    CHECK (expected_product_count BETWEEN 0 AND 500),
  page_size INTEGER NOT NULL CHECK (page_size BETWEEN 1 AND 24),
  next_offset INTEGER NOT NULL DEFAULT 0
    CHECK (next_offset BETWEEN 0 AND 500),
  seen_product_count INTEGER NOT NULL DEFAULT 0
    CHECK (seen_product_count BETWEEN 0 AND 500),
  active_product_count INTEGER NOT NULL DEFAULT 0
    CHECK (active_product_count BETWEEN 0 AND 500),
  tombstoned_product_count INTEGER NOT NULL DEFAULT 0
    CHECK (tombstoned_product_count >= 0),
  failure_code TEXT CHECK (
    failure_code IS NULL OR failure_code ~ '^[a-z][a-z0-9_]{0,63}$'
  ),
  started_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
    CHECK (isfinite(started_at)),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
    CHECK (isfinite(updated_at)),
  completed_at TIMESTAMPTZ
    CHECK (completed_at IS NULL OR isfinite(completed_at)),
  failed_at TIMESTAMPTZ
    CHECK (failed_at IS NULL OR isfinite(failed_at)),
  UNIQUE (user_id, source, generation),
  CONSTRAINT ecommerce_catalog_sweep_cursor_bounds CHECK (
    seen_product_count <= next_offset
    AND next_offset <= expected_product_count
  ),
  CONSTRAINT ecommerce_catalog_sweep_terminal_times CHECK (
    (status = 'in_progress' AND completed_at IS NULL AND failed_at IS NULL)
    OR (status = 'completed' AND completed_at IS NOT NULL AND failed_at IS NULL)
    OR (
      status IN ('failed', 'superseded')
      AND completed_at IS NULL
      AND failed_at IS NOT NULL
      AND failure_code IS NOT NULL
    )
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS
  idx_ecommerce_catalog_sweeps_one_in_progress
  ON public.ecommerce_catalog_sweeps (user_id, source)
  WHERE status = 'in_progress';

CREATE INDEX IF NOT EXISTS idx_ecommerce_catalog_sweeps_owner_generation
  ON public.ecommerce_catalog_sweeps (user_id, source, generation DESC);

CREATE TABLE IF NOT EXISTS public.ecommerce_catalog_sweep_manifest (
  sweep_id UUID NOT NULL
    REFERENCES public.ecommerce_catalog_sweeps(id) ON DELETE CASCADE,
  ordinal INTEGER NOT NULL CHECK (ordinal BETWEEN 0 AND 499),
  product_external_id TEXT NOT NULL
    CHECK (product_external_id ~ '^myhonor:[a-f0-9]{64}$'),
  seen_at TIMESTAMPTZ CHECK (seen_at IS NULL OR isfinite(seen_at)),
  PRIMARY KEY (sweep_id, ordinal),
  UNIQUE (sweep_id, product_external_id)
);

CREATE INDEX IF NOT EXISTS idx_ecommerce_catalog_sweep_manifest_unseen
  ON public.ecommerce_catalog_sweep_manifest (sweep_id, ordinal)
  WHERE seen_at IS NULL;

ALTER TABLE public.ecommerce_catalog_sweeps ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ecommerce_catalog_sweep_manifest ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.ecommerce_catalog_sweeps
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.ecommerce_catalog_sweep_manifest
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.ecommerce_catalog_sweeps TO authenticated;

DROP POLICY IF EXISTS ecommerce_catalog_sweeps_owner_read
  ON public.ecommerce_catalog_sweeps;
CREATE POLICY ecommerce_catalog_sweeps_owner_read
  ON public.ecommerce_catalog_sweeps
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

COMMENT ON TABLE public.ecommerce_catalog_sweeps IS
  'Durable server-owned MyHonor catalog import state with generation fencing.';
COMMENT ON TABLE public.ecommerce_catalog_sweep_manifest IS
  'Frozen ordered canonical product ids for an exact-set catalog finalize.';

CREATE OR REPLACE FUNCTION public.begin_myhonor_ecommerce_catalog_sweep(
  p_user_id UUID,
  p_company_id TEXT,
  p_manifest_hash TEXT,
  p_manifest_product_ids JSONB,
  p_page_size INTEGER
)
RETURNS TABLE (
  sweep_id UUID,
  sweep_status TEXT,
  generation BIGINT,
  manifest_hash TEXT,
  expected_product_count INTEGER,
  page_size INTEGER,
  next_offset INTEGER,
  seen_product_count INTEGER,
  active_product_count INTEGER,
  tombstoned_product_count INTEGER,
  failure_code TEXT,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  failed_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_source CONSTANT TEXT := 'myhonor.shop';
  v_expected INTEGER;
  v_computed_hash TEXT;
  v_generation BIGINT;
  v_sweep public.ecommerce_catalog_sweeps%ROWTYPE;
BEGIN
  IF p_user_id IS NULL
     OR p_company_id IS NULL
     OR length(btrim(p_company_id)) NOT BETWEEN 1 AND 200
     OR NOT EXISTS (
       SELECT 1
         FROM public.companies
        WHERE id::TEXT = btrim(p_company_id)
          AND user_id = p_user_id
     )
     OR p_manifest_hash IS NULL
     OR p_manifest_hash !~ '^[a-f0-9]{64}$'
     OR p_manifest_product_ids IS NULL
     OR jsonb_typeof(p_manifest_product_ids) <> 'array'
     OR jsonb_array_length(p_manifest_product_ids) > 500
     OR pg_column_size(p_manifest_product_ids) > 65536
     OR p_page_size IS NULL
     OR p_page_size NOT BETWEEN 1 AND 24 THEN
    RAISE EXCEPTION 'invalid catalog sweep binding or manifest'
      USING ERRCODE = '22023';
  END IF;

  v_expected := jsonb_array_length(p_manifest_product_ids);

  IF EXISTS (
    SELECT 1
      FROM jsonb_array_elements(p_manifest_product_ids) AS item(value)
     WHERE jsonb_typeof(item.value) <> 'string'
        OR item.value #>> '{}' !~ '^myhonor:[a-f0-9]{64}$'
  )
  OR (
    SELECT count(DISTINCT item.value #>> '{}')
      FROM jsonb_array_elements(p_manifest_product_ids) AS item(value)
  ) <> v_expected THEN
    RAISE EXCEPTION 'invalid catalog sweep product ids'
      USING ERRCODE = '22023';
  END IF;

  SELECT encode(sha256(convert_to(COALESCE(
           string_agg(item.value #>> '{}', E'\n' ORDER BY item.ordinality),
           ''
         ), 'UTF8')), 'hex')
    INTO v_computed_hash
    FROM jsonb_array_elements(p_manifest_product_ids)
      WITH ORDINALITY AS item(value, ordinality);

  IF v_computed_hash IS DISTINCT FROM p_manifest_hash THEN
    RAISE EXCEPTION 'catalog manifest hash mismatch'
      USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(
    p_user_id::TEXT || ':' || v_source || ':catalog-sweep',
    0
  ));

  UPDATE public.ecommerce_catalog_sweeps
     SET status = 'superseded',
         failure_code = 'superseded_by_new_sweep',
         failed_at = clock_timestamp(),
         updated_at = clock_timestamp()
   WHERE user_id = p_user_id
     AND source = v_source
     AND status = 'in_progress';

  SELECT COALESCE(max(s.generation), 0) + 1
    INTO v_generation
    FROM public.ecommerce_catalog_sweeps AS s
   WHERE s.user_id = p_user_id
     AND s.source = v_source;

  INSERT INTO public.ecommerce_catalog_sweeps (
    user_id, company_id, source, generation, manifest_hash,
    expected_product_count, page_size
  ) VALUES (
    p_user_id, btrim(p_company_id), v_source, v_generation, p_manifest_hash,
    v_expected, p_page_size
  )
  RETURNING * INTO v_sweep;

  INSERT INTO public.ecommerce_catalog_sweep_manifest (
    sweep_id, ordinal, product_external_id
  )
  SELECT
    v_sweep.id,
    (item.ordinality - 1)::INTEGER,
    item.value #>> '{}'
  FROM jsonb_array_elements(p_manifest_product_ids)
    WITH ORDINALITY AS item(value, ordinality);

  RETURN QUERY SELECT
    v_sweep.id, v_sweep.status, v_sweep.generation, v_sweep.manifest_hash,
    v_sweep.expected_product_count, v_sweep.page_size, v_sweep.next_offset,
    v_sweep.seen_product_count, v_sweep.active_product_count,
    v_sweep.tombstoned_product_count, v_sweep.failure_code,
    v_sweep.started_at, v_sweep.completed_at, v_sweep.failed_at;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_myhonor_ecommerce_catalog_sweep(
  p_user_id UUID,
  p_company_id TEXT,
  p_sweep_id UUID
)
RETURNS TABLE (
  sweep_id UUID,
  sweep_status TEXT,
  generation BIGINT,
  manifest_hash TEXT,
  expected_product_count INTEGER,
  page_size INTEGER,
  next_offset INTEGER,
  seen_product_count INTEGER,
  active_product_count INTEGER,
  tombstoned_product_count INTEGER,
  failure_code TEXT,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  failed_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_source CONSTANT TEXT := 'myhonor.shop';
BEGIN
  IF p_user_id IS NULL
     OR p_company_id IS NULL
     OR NOT EXISTS (
       SELECT 1
         FROM public.companies
        WHERE id::TEXT = btrim(p_company_id)
          AND user_id = p_user_id
     ) THEN
    RAISE EXCEPTION 'invalid catalog sweep binding'
      USING ERRCODE = '22023';
  END IF;

  IF p_sweep_id IS NULL THEN
    RETURN QUERY
    SELECT
      s.id, s.status, s.generation, s.manifest_hash,
      s.expected_product_count, s.page_size, s.next_offset,
      s.seen_product_count, s.active_product_count,
      s.tombstoned_product_count, s.failure_code, s.started_at,
      s.completed_at, s.failed_at
    FROM public.ecommerce_catalog_sweeps AS s
    WHERE s.user_id = p_user_id
      AND s.company_id = btrim(p_company_id)
      AND s.source = v_source
      AND s.status = 'in_progress'
    ORDER BY s.generation DESC
    LIMIT 1;
  ELSE
    RETURN QUERY
    SELECT
      s.id, s.status, s.generation, s.manifest_hash,
      s.expected_product_count, s.page_size, s.next_offset,
      s.seen_product_count, s.active_product_count,
      s.tombstoned_product_count, s.failure_code, s.started_at,
      s.completed_at, s.failed_at
    FROM public.ecommerce_catalog_sweeps AS s
    WHERE s.id = p_sweep_id
      AND s.user_id = p_user_id
      AND s.company_id = btrim(p_company_id)
      AND s.source = v_source
    LIMIT 1;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.record_myhonor_ecommerce_catalog_sweep_page(
  p_user_id UUID,
  p_company_id TEXT,
  p_sweep_id UUID,
  p_manifest_hash TEXT,
  p_offset INTEGER,
  p_product_external_ids JSONB
)
RETURNS TABLE (
  accepted BOOLEAN,
  reason TEXT,
  sweep_id UUID,
  sweep_status TEXT,
  generation BIGINT,
  manifest_hash TEXT,
  expected_product_count INTEGER,
  page_size INTEGER,
  next_offset INTEGER,
  seen_product_count INTEGER,
  active_product_count INTEGER,
  tombstoned_product_count INTEGER,
  failure_code TEXT,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  failed_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_source CONSTANT TEXT := 'myhonor.shop';
  v_now TIMESTAMPTZ := clock_timestamp();
  v_sweep public.ecommerce_catalog_sweeps%ROWTYPE;
  v_expected_page_count INTEGER;
  v_page_ids JSONB;
  v_manifest_page JSONB;
  v_persisted_count INTEGER;
  v_unseen_count INTEGER;
  v_active_count INTEGER := 0;
  v_tombstoned_count INTEGER := 0;
BEGIN
  IF p_user_id IS NULL
     OR p_company_id IS NULL
     OR p_sweep_id IS NULL
     OR p_manifest_hash IS NULL
     OR p_manifest_hash !~ '^[a-f0-9]{64}$'
     OR p_offset IS NULL
     OR p_offset NOT BETWEEN 0 AND 500
     OR p_product_external_ids IS NULL
     OR jsonb_typeof(p_product_external_ids) <> 'array'
     OR jsonb_array_length(p_product_external_ids) > 24
     OR pg_column_size(p_product_external_ids) > 8192
     OR NOT EXISTS (
       SELECT 1
         FROM public.companies
        WHERE id::TEXT = btrim(p_company_id)
          AND user_id = p_user_id
     ) THEN
    RAISE EXCEPTION 'invalid catalog sweep page'
      USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(
    p_user_id::TEXT || ':' || v_source || ':catalog-sweep',
    0
  ));

  SELECT *
    INTO v_sweep
    FROM public.ecommerce_catalog_sweeps AS s
   WHERE s.id = p_sweep_id
     AND s.user_id = p_user_id
     AND s.company_id = btrim(p_company_id)
     AND s.source = v_source
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'catalog sweep not found'
      USING ERRCODE = '22023';
  END IF;

  IF v_sweep.status <> 'in_progress' THEN
    RETURN QUERY SELECT
      FALSE, 'sweep_not_in_progress', v_sweep.id, v_sweep.status,
      v_sweep.generation, v_sweep.manifest_hash,
      v_sweep.expected_product_count, v_sweep.page_size,
      v_sweep.next_offset, v_sweep.seen_product_count,
      v_sweep.active_product_count, v_sweep.tombstoned_product_count,
      v_sweep.failure_code, v_sweep.started_at, v_sweep.completed_at,
      v_sweep.failed_at;
    RETURN;
  END IF;

  IF p_offset <> v_sweep.next_offset THEN
    RETURN QUERY SELECT
      FALSE, 'offset_mismatch', v_sweep.id, v_sweep.status,
      v_sweep.generation, v_sweep.manifest_hash,
      v_sweep.expected_product_count, v_sweep.page_size,
      v_sweep.next_offset, v_sweep.seen_product_count,
      v_sweep.active_product_count, v_sweep.tombstoned_product_count,
      v_sweep.failure_code, v_sweep.started_at, v_sweep.completed_at,
      v_sweep.failed_at;
    RETURN;
  END IF;

  IF p_manifest_hash IS DISTINCT FROM v_sweep.manifest_hash THEN
    UPDATE public.ecommerce_catalog_sweeps
       SET status = 'failed',
           failure_code = 'manifest_changed',
           failed_at = v_now,
           updated_at = v_now
     WHERE id = v_sweep.id
     RETURNING * INTO v_sweep;
    RETURN QUERY SELECT
      FALSE, 'manifest_changed', v_sweep.id, v_sweep.status,
      v_sweep.generation, v_sweep.manifest_hash,
      v_sweep.expected_product_count, v_sweep.page_size,
      v_sweep.next_offset, v_sweep.seen_product_count,
      v_sweep.active_product_count, v_sweep.tombstoned_product_count,
      v_sweep.failure_code, v_sweep.started_at, v_sweep.completed_at,
      v_sweep.failed_at;
    RETURN;
  END IF;

  v_expected_page_count := LEAST(
    v_sweep.page_size,
    v_sweep.expected_product_count - v_sweep.next_offset
  );
  v_page_ids := p_product_external_ids;

  SELECT COALESCE(
           jsonb_agg(m.product_external_id ORDER BY m.ordinal),
           '[]'::JSONB
         )
    INTO v_manifest_page
    FROM public.ecommerce_catalog_sweep_manifest AS m
   WHERE m.sweep_id = v_sweep.id
     AND m.ordinal >= v_sweep.next_offset
     AND m.ordinal < v_sweep.next_offset + v_expected_page_count;

  IF v_expected_page_count <= 0
     OR jsonb_array_length(v_page_ids) <> v_expected_page_count
     OR v_page_ids IS DISTINCT FROM v_manifest_page
     OR EXISTS (
       SELECT 1
         FROM jsonb_array_elements(v_page_ids) AS item(value)
        WHERE jsonb_typeof(item.value) <> 'string'
           OR item.value #>> '{}' !~ '^myhonor:[a-f0-9]{64}$'
     ) THEN
    UPDATE public.ecommerce_catalog_sweeps
       SET status = 'failed',
           failure_code = 'page_manifest_mismatch',
           failed_at = v_now,
           updated_at = v_now
     WHERE id = v_sweep.id
     RETURNING * INTO v_sweep;
    RETURN QUERY SELECT
      FALSE, 'page_manifest_mismatch', v_sweep.id, v_sweep.status,
      v_sweep.generation, v_sweep.manifest_hash,
      v_sweep.expected_product_count, v_sweep.page_size,
      v_sweep.next_offset, v_sweep.seen_product_count,
      v_sweep.active_product_count, v_sweep.tombstoned_product_count,
      v_sweep.failure_code, v_sweep.started_at, v_sweep.completed_at,
      v_sweep.failed_at;
    RETURN;
  END IF;

  SELECT count(*)::INTEGER
    INTO v_persisted_count
    FROM public.ecommerce_products AS p
    JOIN jsonb_array_elements_text(v_page_ids) AS item(external_id)
      ON item.external_id = p.external_id
   WHERE p.user_id = p_user_id
     AND p.company_id = btrim(p_company_id)
     AND p.source = v_source
     AND p.catalog_synced_at >= v_sweep.started_at;

  IF v_persisted_count <> v_expected_page_count THEN
    UPDATE public.ecommerce_catalog_sweeps
       SET status = 'failed',
           failure_code = 'page_not_persisted',
           failed_at = v_now,
           updated_at = v_now
     WHERE id = v_sweep.id
     RETURNING * INTO v_sweep;
    RETURN QUERY SELECT
      FALSE, 'page_not_persisted', v_sweep.id, v_sweep.status,
      v_sweep.generation, v_sweep.manifest_hash,
      v_sweep.expected_product_count, v_sweep.page_size,
      v_sweep.next_offset, v_sweep.seen_product_count,
      v_sweep.active_product_count, v_sweep.tombstoned_product_count,
      v_sweep.failure_code, v_sweep.started_at, v_sweep.completed_at,
      v_sweep.failed_at;
    RETURN;
  END IF;

  UPDATE public.ecommerce_catalog_sweep_manifest AS m
     SET seen_at = COALESCE(m.seen_at, v_now)
   WHERE m.sweep_id = v_sweep.id
     AND m.ordinal >= v_sweep.next_offset
     AND m.ordinal < v_sweep.next_offset + v_expected_page_count;

  UPDATE public.ecommerce_catalog_sweeps AS s
     SET next_offset = s.next_offset + v_expected_page_count,
         seen_product_count = s.seen_product_count + v_expected_page_count,
         updated_at = v_now
   WHERE s.id = v_sweep.id
   RETURNING * INTO v_sweep;

  IF v_sweep.next_offset = v_sweep.expected_product_count THEN
    SELECT count(*)::INTEGER
      INTO v_unseen_count
      FROM public.ecommerce_catalog_sweep_manifest AS m
     WHERE m.sweep_id = v_sweep.id
       AND m.seen_at IS NULL;

    SELECT count(*)::INTEGER
      INTO v_persisted_count
      FROM public.ecommerce_catalog_sweep_manifest AS m
      JOIN public.ecommerce_products AS p
        ON p.user_id = p_user_id
       AND p.source = v_source
       AND p.external_id = m.product_external_id
       AND p.catalog_synced_at >= v_sweep.started_at
     WHERE m.sweep_id = v_sweep.id;

    IF v_sweep.expected_product_count = 0
       OR v_unseen_count <> 0
       OR v_persisted_count <> v_sweep.expected_product_count THEN
      UPDATE public.ecommerce_catalog_sweeps
         SET status = 'failed',
             failure_code = 'incomplete_manifest',
             failed_at = v_now,
             updated_at = v_now
       WHERE id = v_sweep.id
       RETURNING * INTO v_sweep;
      RETURN QUERY SELECT
        FALSE, 'incomplete_manifest', v_sweep.id, v_sweep.status,
        v_sweep.generation, v_sweep.manifest_hash,
        v_sweep.expected_product_count, v_sweep.page_size,
        v_sweep.next_offset, v_sweep.seen_product_count,
        v_sweep.active_product_count, v_sweep.tombstoned_product_count,
        v_sweep.failure_code, v_sweep.started_at, v_sweep.completed_at,
        v_sweep.failed_at;
      RETURN;
    END IF;

    UPDATE public.ecommerce_products AS p
       SET catalog_active = FALSE,
           availability = 'discontinued'
     WHERE p.user_id = p_user_id
       AND p.source = v_source
       AND p.catalog_active = TRUE
       AND NOT EXISTS (
         SELECT 1
           FROM public.ecommerce_catalog_sweep_manifest AS m
          WHERE m.sweep_id = v_sweep.id
            AND m.product_external_id = p.external_id
       );
    GET DIAGNOSTICS v_tombstoned_count = ROW_COUNT;

    UPDATE public.ecommerce_products AS p
       SET catalog_active = TRUE
     WHERE p.user_id = p_user_id
       AND p.source = v_source
       AND EXISTS (
         SELECT 1
           FROM public.ecommerce_catalog_sweep_manifest AS m
          WHERE m.sweep_id = v_sweep.id
            AND m.product_external_id = p.external_id
       );

    SELECT count(*)::INTEGER
      INTO v_active_count
      FROM public.ecommerce_products AS p
     WHERE p.user_id = p_user_id
       AND p.source = v_source
       AND p.catalog_active = TRUE;

    IF v_active_count <> v_sweep.expected_product_count THEN
      RAISE EXCEPTION 'catalog exact-set finalization invariant failed'
        USING ERRCODE = '23514';
    END IF;

    UPDATE public.ecommerce_catalog_sweeps
       SET status = 'completed',
           active_product_count = v_active_count,
           tombstoned_product_count = v_tombstoned_count,
           completed_at = v_now,
           updated_at = v_now
     WHERE id = v_sweep.id
       AND status = 'in_progress'
     RETURNING * INTO v_sweep;

    INSERT INTO public.ecommerce_catalog_sync_state (
      user_id, company_id, source, expected_product_count,
      active_product_count, last_sweep_started_at, last_completed_at,
      tombstoned_product_count
    ) VALUES (
      p_user_id, btrim(p_company_id), v_source,
      v_sweep.expected_product_count, v_active_count, v_sweep.started_at,
      v_now, v_tombstoned_count
    )
    ON CONFLICT (user_id, source) DO UPDATE SET
      company_id = EXCLUDED.company_id,
      expected_product_count = EXCLUDED.expected_product_count,
      active_product_count = EXCLUDED.active_product_count,
      last_sweep_started_at = EXCLUDED.last_sweep_started_at,
      last_completed_at = EXCLUDED.last_completed_at,
      tombstoned_product_count = EXCLUDED.tombstoned_product_count;
  END IF;

  RETURN QUERY SELECT
    TRUE, NULL::TEXT, v_sweep.id, v_sweep.status, v_sweep.generation,
    v_sweep.manifest_hash, v_sweep.expected_product_count, v_sweep.page_size,
    v_sweep.next_offset, v_sweep.seen_product_count,
    v_sweep.active_product_count, v_sweep.tombstoned_product_count,
    v_sweep.failure_code, v_sweep.started_at, v_sweep.completed_at,
    v_sweep.failed_at;
END;
$$;

CREATE OR REPLACE FUNCTION public.fail_myhonor_ecommerce_catalog_sweep(
  p_user_id UUID,
  p_company_id TEXT,
  p_sweep_id UUID,
  p_failure_code TEXT
)
RETURNS TABLE (
  sweep_id UUID,
  sweep_status TEXT,
  generation BIGINT,
  manifest_hash TEXT,
  expected_product_count INTEGER,
  page_size INTEGER,
  next_offset INTEGER,
  seen_product_count INTEGER,
  active_product_count INTEGER,
  tombstoned_product_count INTEGER,
  failure_code TEXT,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  failed_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_source CONSTANT TEXT := 'myhonor.shop';
  v_sweep public.ecommerce_catalog_sweeps%ROWTYPE;
BEGIN
  IF p_user_id IS NULL
     OR p_company_id IS NULL
     OR p_sweep_id IS NULL
     OR p_failure_code IS NULL
     OR p_failure_code !~ '^[a-z][a-z0-9_]{0,63}$'
     OR NOT EXISTS (
       SELECT 1
         FROM public.companies
        WHERE id::TEXT = btrim(p_company_id)
          AND user_id = p_user_id
     ) THEN
    RAISE EXCEPTION 'invalid catalog sweep failure'
      USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(
    p_user_id::TEXT || ':' || v_source || ':catalog-sweep',
    0
  ));

  UPDATE public.ecommerce_catalog_sweeps
     SET status = 'failed',
         failure_code = p_failure_code,
         failed_at = clock_timestamp(),
         updated_at = clock_timestamp()
   WHERE id = p_sweep_id
     AND user_id = p_user_id
     AND company_id = btrim(p_company_id)
     AND source = v_source
     AND status = 'in_progress';

  SELECT *
    INTO v_sweep
    FROM public.ecommerce_catalog_sweeps AS s
   WHERE s.id = p_sweep_id
     AND s.user_id = p_user_id
     AND s.company_id = btrim(p_company_id)
     AND s.source = v_source;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'catalog sweep not found'
      USING ERRCODE = '22023';
  END IF;

  RETURN QUERY SELECT
    v_sweep.id, v_sweep.status, v_sweep.generation, v_sweep.manifest_hash,
    v_sweep.expected_product_count, v_sweep.page_size, v_sweep.next_offset,
    v_sweep.seen_product_count, v_sweep.active_product_count,
    v_sweep.tombstoned_product_count, v_sweep.failure_code,
    v_sweep.started_at, v_sweep.completed_at, v_sweep.failed_at;
END;
$$;

REVOKE ALL ON FUNCTION public.begin_myhonor_ecommerce_catalog_sweep(
  UUID, TEXT, TEXT, JSONB, INTEGER
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_myhonor_ecommerce_catalog_sweep(
  UUID, TEXT, UUID
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.record_myhonor_ecommerce_catalog_sweep_page(
  UUID, TEXT, UUID, TEXT, INTEGER, JSONB
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fail_myhonor_ecommerce_catalog_sweep(
  UUID, TEXT, UUID, TEXT
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.begin_myhonor_ecommerce_catalog_sweep(
  UUID, TEXT, TEXT, JSONB, INTEGER
) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_myhonor_ecommerce_catalog_sweep(
  UUID, TEXT, UUID
) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_myhonor_ecommerce_catalog_sweep_page(
  UUID, TEXT, UUID, TEXT, INTEGER, JSONB
) TO service_role;
GRANT EXECUTE ON FUNCTION public.fail_myhonor_ecommerce_catalog_sweep(
  UUID, TEXT, UUID, TEXT
) TO service_role;

-- The old function accepted a caller-controlled timestamp and only compared
-- counts. Keep it for migration compatibility, but make it uncallable.
REVOKE ALL ON FUNCTION public.finalize_myhonor_ecommerce_catalog_sweep(
  UUID, TEXT, TIMESTAMPTZ, INTEGER
) FROM PUBLIC, anon, authenticated, service_role;
