-- Atomic mutation boundary for the canonical Point A model.
--
-- The functions in this migration deliberately run as SECURITY DEFINER:
-- recomputing one canonical field must update the resolution, append history
-- and replace its numeric metrics projection in one PostgreSQL transaction.
-- Likewise, deleting a document must retract its canonical source before the
-- authoritative documents row disappears.  Every public entry point performs
-- the same JWT user/company check before touching rows; no broad DELETE RLS
-- policies are added to documents or metrics.

BEGIN;

-- Production drift had RLS disabled on several tenant-bearing tables even
-- though earlier migrations had created policies. Re-enable the boundary
-- before installing SECURITY DEFINER mutation entry points.
ALTER TABLE public.companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.survey_answers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.diagnostics ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.document_summaries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.document_chunks ENABLE ROW LEVEL SECURITY;

-- Diagnostics had no owner UPDATE policy in the original onboarding schema.
-- Recreate the complete client read/write set and a non-recursive staff read.
DROP POLICY IF EXISTS diagnostics_select_own ON public.diagnostics;
DROP POLICY IF EXISTS diagnostics_insert_own ON public.diagnostics;
DROP POLICY IF EXISTS diagnostics_update_own ON public.diagnostics;
DROP POLICY IF EXISTS diagnostics_admin_select ON public.diagnostics;

CREATE POLICY diagnostics_select_own
  ON public.diagnostics
  FOR SELECT TO authenticated
  USING (user_id::TEXT = auth.uid()::TEXT);

CREATE POLICY diagnostics_insert_own
  ON public.diagnostics
  FOR INSERT TO authenticated
  WITH CHECK (user_id::TEXT = auth.uid()::TEXT);

CREATE POLICY diagnostics_update_own
  ON public.diagnostics
  FOR UPDATE TO authenticated
  USING (user_id::TEXT = auth.uid()::TEXT)
  WITH CHECK (user_id::TEXT = auth.uid()::TEXT);

CREATE POLICY diagnostics_admin_select
  ON public.diagnostics
  FOR SELECT TO authenticated
  USING (
    public.current_user_role() IN
      ('super_admin', 'admin', 'manager', 'analyst', 'expert')
  );

-- document_summaries/chunks intentionally receive no client policies.
-- Their bounded retrieval RPC is revoked from anon/authenticated in 054/069;
-- service_role continues to bypass RLS for indexing and server-side retrieval.

CREATE OR REPLACE FUNCTION public.point_a_assert_mutation_scope(
  p_user_id TEXT,
  p_company_id TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_auth_user TEXT := auth.uid()::TEXT;
  v_jwt_role TEXT := COALESCE(
    NULLIF(auth.role(), ''),
    NULLIF(current_setting('request.jwt.claim.role', TRUE), ''),
    ''
  );
  v_staff BOOLEAN := COALESCE(
    public.current_user_role() IN
      ('super_admin', 'admin', 'manager', 'analyst', 'expert'),
    FALSE
  );
BEGIN
  IF NULLIF(BTRIM(p_user_id), '') IS NULL
     OR NULLIF(BTRIM(p_company_id), '') IS NULL THEN
    RAISE EXCEPTION 'point_a_user_and_company_required'
      USING ERRCODE = '22023';
  END IF;

  IF v_jwt_role <> 'service_role'
     AND NOT v_staff
     AND v_auth_user IS DISTINCT FROM p_user_id THEN
    RAISE EXCEPTION 'point_a_mutation_forbidden'
      USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM public.companies company
     WHERE company.id::TEXT = p_company_id
       AND company.user_id::TEXT = p_user_id
  ) THEN
    RAISE EXCEPTION 'point_a_company_not_owned'
      USING ERRCODE = '42501';
  END IF;
END;
$$;

COMMENT ON FUNCTION public.point_a_assert_mutation_scope(TEXT, TEXT) IS
  'Internal guard used by Point A SECURITY DEFINER RPCs. Validates JWT authority and the exact user/company ownership pair.';

CREATE OR REPLACE FUNCTION public.point_a_expected_resolution_version(
  p_expected_versions JSONB,
  p_field_key TEXT,
  p_period_key TEXT,
  p_scenario TEXT
)
RETURNS INTEGER
LANGUAGE plpgsql
IMMUTABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_match JSONB;
BEGIN
  IF p_expected_versions IS NULL THEN
    RETURN NULL;
  END IF;
  IF JSONB_TYPEOF(p_expected_versions) <> 'array' THEN
    RAISE EXCEPTION 'point_a_expected_versions_must_be_array'
      USING ERRCODE = '22023';
  END IF;

  SELECT item
    INTO v_match
    FROM JSONB_ARRAY_ELEMENTS(p_expected_versions) item
   WHERE item->>'field_key' = p_field_key
     AND COALESCE(item->>'period_key', '') = COALESCE(p_period_key, '')
     AND COALESCE(item->>'scenario', 'fact') = COALESCE(p_scenario, 'fact')
   LIMIT 1;

  IF v_match IS NULL OR NOT (v_match ? 'version') THEN
    RAISE EXCEPTION
      'point_a_expected_version_missing for %.%/%',
      p_field_key, COALESCE(p_period_key, ''), p_scenario
      USING ERRCODE = '22023';
  END IF;

  BEGIN
    RETURN (v_match->>'version')::INTEGER;
  EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
    RAISE EXCEPTION 'point_a_expected_version_invalid'
      USING ERRCODE = '22023';
  END;
END;
$$;

COMMENT ON FUNCTION public.point_a_expected_resolution_version(JSONB, TEXT, TEXT, TEXT) IS
  'Reads a required CAS version from [{"field_key", "period_key", "scenario", "version"}]. NULL disables CAS.';

CREATE OR REPLACE FUNCTION public.point_a_recompute_field_atomic(
  p_user_id TEXT,
  p_company_id TEXT,
  p_field_key TEXT,
  p_period_key TEXT DEFAULT '',
  p_scenario TEXT DEFAULT 'fact',
  p_actor_id TEXT DEFAULT NULL,
  p_reason TEXT DEFAULT NULL,
  p_expected_version INTEGER DEFAULT NULL
)
RETURNS public.point_a_resolutions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_previous public.point_a_resolutions%ROWTYPE;
  v_result public.point_a_resolutions%ROWTYPE;
  v_selected public.point_a_values%ROWTYPE;
  v_previous_selected public.point_a_values%ROWTYPE;
  v_current_version INTEGER := 0;
  v_resolution_status TEXT := 'empty';
  v_has_conflict BOOLEAN := FALSE;
  v_actor TEXT := COALESCE(auth.uid()::TEXT, p_actor_id, p_user_id);
  v_resolution_key TEXT;
BEGIN
  PERFORM public.point_a_assert_mutation_scope(p_user_id, p_company_id);

  IF NULLIF(BTRIM(p_field_key), '') IS NULL
     OR p_scenario NOT IN ('fact', 'plan', 'forecast') THEN
    RAISE EXCEPTION 'point_a_resolution_key_invalid'
      USING ERRCODE = '22023';
  END IF;
  p_period_key := COALESCE(p_period_key, '');

  -- Serializes creation as well as updates of the same logical resolution.
  PERFORM pg_advisory_xact_lock(
    hashtextextended(
      CONCAT_WS(CHR(31), 'point-a-resolution', p_company_id,
                p_field_key, p_period_key, p_scenario),
      0
    )
  );

  SELECT *
    INTO v_previous
    FROM public.point_a_resolutions resolution
   WHERE resolution.company_id = p_company_id
     AND resolution.field_key = p_field_key
     AND resolution.period_key = p_period_key
     AND resolution.scenario = p_scenario
   FOR UPDATE;

  IF FOUND THEN
    v_current_version := v_previous.version;
    IF v_previous.selected_value_id IS NOT NULL THEN
      SELECT *
        INTO v_previous_selected
        FROM public.point_a_values
       WHERE id = v_previous.selected_value_id;
    END IF;
  END IF;

  IF p_expected_version IS NOT NULL
     AND p_expected_version <> v_current_version THEN
    RAISE EXCEPTION
      'point_a_resolution_version_conflict expected %, actual %',
      p_expected_version, v_current_version
      USING ERRCODE = '40001',
            DETAIL = JSONB_BUILD_OBJECT(
              'field_key', p_field_key,
              'period_key', p_period_key,
              'scenario', p_scenario,
              'expected_version', p_expected_version,
              'actual_version', v_current_version
            )::TEXT;
  END IF;

  SELECT value.*
    INTO v_selected
    FROM public.point_a_values value
    JOIN public.point_a_sources source ON source.id = value.source_id
   WHERE value.user_id = p_user_id
     AND value.company_id = p_company_id
     AND value.field_key = p_field_key
     AND value.period_key = p_period_key
     AND value.scenario = p_scenario
     AND value.status NOT IN ('rejected', 'superseded', 'retracted')
     AND source.user_id = p_user_id
     AND source.company_id = p_company_id
     AND source.status <> 'deleted'
     AND source.deleted_at IS NULL
   ORDER BY
     CASE
       WHEN value.status = 'confirmed'
         OR value.extraction_kind = 'confirmed' THEN 1000
       WHEN value.extraction_kind = 'manual' THEN 600
       WHEN value.extraction_kind = 'survey' THEN 500
       WHEN value.extraction_kind IN ('table', 'prisma') THEN 400
       WHEN value.extraction_kind = 'text' THEN 300
       WHEN value.extraction_kind = 'ocr' THEN 250
       WHEN value.extraction_kind = 'computed' THEN 200
       WHEN value.extraction_kind = 'external' THEN 150
       WHEN value.extraction_kind = 'inferred' THEN 100
       ELSE 0
     END DESC,
     COALESCE(value.confidence, 0) DESC,
     value.updated_at DESC,
     value.id DESC
   LIMIT 1;

  IF FOUND THEN
    SELECT EXISTS (
      SELECT 1
        FROM public.point_a_values candidate
        JOIN public.point_a_sources source ON source.id = candidate.source_id
       WHERE candidate.user_id = p_user_id
         AND candidate.company_id = p_company_id
         AND candidate.field_key = p_field_key
         AND candidate.period_key = p_period_key
         AND candidate.scenario = p_scenario
         AND candidate.id <> v_selected.id
         AND candidate.status NOT IN ('rejected', 'superseded', 'retracted')
         AND source.status <> 'deleted'
         AND source.deleted_at IS NULL
         AND (
           CASE
             WHEN JSONB_TYPEOF(candidate.normalized_value) = 'number'
              AND JSONB_TYPEOF(v_selected.normalized_value) = 'number'
             THEN ABS(
                    (candidate.normalized_value #>> '{}')::NUMERIC
                    - (v_selected.normalized_value #>> '{}')::NUMERIC
                  ) > (
                    0.0001 * GREATEST(
                      1,
                      ABS((candidate.normalized_value #>> '{}')::NUMERIC),
                      ABS((v_selected.normalized_value #>> '{}')::NUMERIC)
                    )
                  )
             ELSE candidate.normalized_value IS DISTINCT FROM
                  v_selected.normalized_value
           END
         )
    ) INTO v_has_conflict;

    v_resolution_status := CASE
      WHEN v_selected.status = 'confirmed'
        OR v_selected.extraction_kind = 'confirmed' THEN 'resolved'
      WHEN v_has_conflict THEN 'conflict'
      WHEN v_selected.status = 'needs_confirmation'
        OR COALESCE(v_selected.confidence, 0) < 0.65
        THEN 'needs_confirmation'
      ELSE 'resolved'
    END;
  END IF;

  INSERT INTO public.point_a_resolutions (
    user_id, company_id, field_key, period_key, scenario,
    selected_value_id, resolution_status,
    decided_by, decided_at, decision_reason, version
  )
  VALUES (
    p_user_id, p_company_id, p_field_key, p_period_key, p_scenario,
    CASE WHEN v_selected.id IS NULL THEN NULL ELSE v_selected.id END,
    v_resolution_status,
    CASE WHEN p_actor_id IS NULL AND p_reason IS NULL THEN NULL ELSE v_actor END,
    CASE WHEN p_actor_id IS NULL AND p_reason IS NULL THEN NULL ELSE NOW() END,
    p_reason,
    v_current_version + 1
  )
  ON CONFLICT (company_id, field_key, period_key, scenario)
  DO UPDATE SET
    user_id = EXCLUDED.user_id,
    selected_value_id = EXCLUDED.selected_value_id,
    resolution_status = EXCLUDED.resolution_status,
    decided_by = EXCLUDED.decided_by,
    decided_at = EXCLUDED.decided_at,
    decision_reason = EXCLUDED.decision_reason,
    version = EXCLUDED.version
  RETURNING * INTO v_result;

  v_resolution_key := CONCAT_WS(CHR(31), p_company_id, p_field_key,
                                p_period_key, p_scenario);

  -- Remove both tagged projections and the legacy projection at the previous
  -- selected value's exact period. This prevents a period change from leaving
  -- an orphaned calculated metric.
  DELETE FROM public.metrics metric
   WHERE metric.company_id::TEXT = p_company_id
     AND metric.metric_key = p_field_key
     AND metric.scenario = p_scenario
     AND metric.source = 'calculated'
     AND (
       metric.provenance->>'point_a_resolution_key' = v_resolution_key
       OR metric.provenance->>'canonical_value_id' IN (
         SELECT value.id::TEXT
           FROM public.point_a_values value
          WHERE value.company_id = p_company_id
            AND value.field_key = p_field_key
            AND value.period_key = p_period_key
            AND value.scenario = p_scenario
       )
       OR (
         v_previous_selected.id IS NOT NULL
         AND metric.period_year IS NOT DISTINCT FROM v_previous_selected.period_year
         AND metric.period_quarter IS NOT DISTINCT FROM v_previous_selected.period_quarter
         AND metric.period_month IS NOT DISTINCT FROM v_previous_selected.period_month
       )
       OR (
         v_selected.id IS NOT NULL
         AND metric.period_year IS NOT DISTINCT FROM v_selected.period_year
         AND metric.period_quarter IS NOT DISTINCT FROM v_selected.period_quarter
         AND metric.period_month IS NOT DISTINCT FROM v_selected.period_month
       )
     );

  IF v_selected.id IS NOT NULL
     AND v_selected.value_type = 'number'
     AND JSONB_TYPEOF(v_selected.normalized_value) = 'number' THEN
    INSERT INTO public.metrics (
      company_id, metric_key, metric_value, metric_unit,
      period_year, period_quarter, period_month, scenario,
      source, confidence, provenance, computed_at
    )
    VALUES (
      p_company_id, p_field_key,
      (v_selected.normalized_value #>> '{}')::NUMERIC,
      COALESCE(v_selected.currency, v_selected.unit),
      v_selected.period_year, v_selected.period_quarter,
      v_selected.period_month, v_selected.scenario,
      'calculated', v_selected.confidence,
      JSONB_BUILD_OBJECT(
        'canonical_value_id', v_selected.id,
        'source_id', v_selected.source_id,
        'source_fragment', v_selected.source_fragment,
        'source_locator', v_selected.source_locator,
        'extraction_kind', v_selected.extraction_kind,
        'status', v_selected.status,
        'raw_value', v_selected.raw_value,
        'point_a_period_key', p_period_key,
        'point_a_resolution_key', v_resolution_key,
        'point_a_resolution_version', v_result.version
      ),
      NOW()
    )
    ON CONFLICT (
      company_id, metric_key, period_year, period_quarter,
      period_month, scenario, source
    )
    DO UPDATE SET
      metric_value = EXCLUDED.metric_value,
      metric_unit = EXCLUDED.metric_unit,
      confidence = EXCLUDED.confidence,
      provenance = EXCLUDED.provenance,
      computed_at = EXCLUDED.computed_at;
  END IF;

  IF v_resolution_status = 'conflict'
     AND COALESCE(v_previous.resolution_status, 'empty') <> 'conflict' THEN
    INSERT INTO public.point_a_value_events (
      user_id, company_id, field_key, event_type, actor_id,
      old_value_id, new_value_id, metadata
    )
    SELECT
      p_user_id, p_company_id, p_field_key, 'conflict_detected', v_actor,
      v_previous.selected_value_id, v_selected.id,
      JSONB_BUILD_OBJECT(
        'period_key', p_period_key,
        'scenario', p_scenario,
        'resolution_version', v_result.version,
        'candidate_ids', COALESCE(
          JSONB_AGG(value.id ORDER BY value.id), '[]'::JSONB
        )
      )
      FROM public.point_a_values value
      JOIN public.point_a_sources source ON source.id = value.source_id
     WHERE value.company_id = p_company_id
       AND value.field_key = p_field_key
       AND value.period_key = p_period_key
       AND value.scenario = p_scenario
       AND value.status NOT IN ('rejected', 'superseded', 'retracted')
       AND source.status <> 'deleted'
       AND source.deleted_at IS NULL;
  ELSIF v_resolution_status <> 'conflict'
        AND v_previous.resolution_status = 'conflict' THEN
    INSERT INTO public.point_a_value_events (
      user_id, company_id, field_key, event_type, actor_id,
      old_value_id, new_value_id, metadata
    )
    VALUES (
      p_user_id, p_company_id, p_field_key, 'conflict_resolved', v_actor,
      v_previous.selected_value_id,
      CASE WHEN v_selected.id IS NULL THEN NULL ELSE v_selected.id END,
      JSONB_BUILD_OBJECT(
        'period_key', p_period_key,
        'scenario', p_scenario,
        'reason', p_reason,
        'resolution_version', v_result.version
      )
    );
  END IF;

  RETURN v_result;
END;
$$;

COMMENT ON FUNCTION public.point_a_recompute_field_atomic(
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, INTEGER
) IS
  'Atomically resolves one Point A key, applies optional CAS, projects its numeric value to metrics, and appends conflict transition history.';

CREATE OR REPLACE FUNCTION public.point_a_ensure_source_atomic(
  p_user_id TEXT,
  p_company_id TEXT,
  p_source_type TEXT,
  p_native_source_id TEXT,
  p_source_name TEXT DEFAULT NULL,
  p_content_hash TEXT DEFAULT NULL,
  p_status TEXT DEFAULT 'ready',
  p_metadata JSONB DEFAULT '{}'::JSONB
)
RETURNS public.point_a_sources
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_source public.point_a_sources%ROWTYPE;
BEGIN
  PERFORM public.point_a_assert_mutation_scope(p_user_id, p_company_id);

  IF p_source_type NOT IN
       ('survey', 'manual', 'document', 'computed', 'prisma', 'external')
     OR NULLIF(BTRIM(p_native_source_id), '') IS NULL
     OR p_status NOT IN ('active', 'processing', 'ready', 'error')
     OR COALESCE(JSONB_TYPEOF(p_metadata), 'null') <> 'object' THEN
    RAISE EXCEPTION 'point_a_source_input_invalid'
      USING ERRCODE = '22023';
  END IF;

  -- Document existence and lock synchronize parse/ingest with atomic delete.
  IF p_source_type = 'document' THEN
    PERFORM 1
      FROM public.documents document
     WHERE document.id::TEXT = p_native_source_id
       AND document.user_id::TEXT = p_user_id
       AND document.company_id::TEXT = p_company_id
     FOR SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'point_a_document_not_found'
        USING ERRCODE = 'P0002';
    END IF;
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(
      CONCAT_WS(CHR(31), 'point-a-source', p_user_id, p_company_id,
                p_source_type, p_native_source_id),
      0
    )
  );

  SELECT *
    INTO v_source
    FROM public.point_a_sources source
   WHERE source.user_id = p_user_id
     AND source.company_id = p_company_id
     AND source.source_type = p_source_type
     AND source.native_source_id = p_native_source_id
     AND source.deleted_at IS NULL
   FOR UPDATE;

  IF FOUND THEN
    UPDATE public.point_a_sources
       SET source_name = p_source_name,
           content_hash = p_content_hash,
           status = p_status,
           metadata = COALESCE(p_metadata, '{}'::JSONB),
           deleted_at = NULL
     WHERE id = v_source.id
     RETURNING * INTO v_source;
  ELSE
    INSERT INTO public.point_a_sources (
      user_id, company_id, source_type, native_source_id,
      source_name, content_hash, status, metadata
    )
    VALUES (
      p_user_id, p_company_id, p_source_type, p_native_source_id,
      p_source_name, p_content_hash, p_status,
      COALESCE(p_metadata, '{}'::JSONB)
    )
    RETURNING * INTO v_source;
  END IF;

  RETURN v_source;
END;
$$;

COMMENT ON FUNCTION public.point_a_ensure_source_atomic(
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB
) IS
  'Race-safe source create/update. Document sources require and lock an authoritative owned documents row.';

CREATE OR REPLACE FUNCTION public.point_a_ingest_candidates_atomic(
  p_user_id TEXT,
  p_company_id TEXT,
  p_source_id UUID,
  p_candidates JSONB,
  p_actor_id TEXT DEFAULT NULL,
  p_replace_missing BOOLEAN DEFAULT TRUE,
  p_expected_versions JSONB DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_source public.point_a_sources%ROWTYPE;
  v_source_snapshot public.point_a_sources%ROWTYPE;
  v_existing public.point_a_values%ROWTYPE;
  v_inserted public.point_a_values%ROWTYPE;
  v_candidate JSONB;
  v_group RECORD;
  v_resolution public.point_a_resolutions%ROWTYPE;
  v_groups JSONB := '{}'::JSONB;
  v_resolutions JSONB := '[]'::JSONB;
  v_desired_keys TEXT[] := ARRAY[]::TEXT[];
  v_candidate_key TEXT;
  v_field_key TEXT;
  v_period_key TEXT;
  v_scenario TEXT;
  v_value_type TEXT;
  v_extraction_kind TEXT;
  v_status TEXT;
  v_confidence NUMERIC;
  v_created INTEGER := 0;
  v_unchanged INTEGER := 0;
  v_retired INTEGER := 0;
  v_same BOOLEAN;
  v_actor TEXT := COALESCE(auth.uid()::TEXT, p_actor_id, p_user_id);
BEGIN
  PERFORM public.point_a_assert_mutation_scope(p_user_id, p_company_id);

  IF p_candidates IS NULL OR JSONB_TYPEOF(p_candidates) <> 'array' THEN
    RAISE EXCEPTION 'point_a_candidates_must_be_array'
      USING ERRCODE = '22023';
  END IF;
  IF p_expected_versions IS NOT NULL
     AND JSONB_TYPEOF(p_expected_versions) <> 'array' THEN
    RAISE EXCEPTION 'point_a_expected_versions_must_be_array'
      USING ERRCODE = '22023';
  END IF;

  -- Read only enough to establish the global lock order:
  -- authoritative document -> canonical source -> candidate rows.
  SELECT *
    INTO v_source_snapshot
    FROM public.point_a_sources source
   WHERE source.id = p_source_id
     AND source.user_id = p_user_id
     AND source.company_id = p_company_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'point_a_source_not_found'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_source_snapshot.source_type = 'document' THEN
    PERFORM 1
      FROM public.documents document
     WHERE document.id::TEXT = v_source_snapshot.native_source_id
       AND document.user_id::TEXT = p_user_id
       AND document.company_id::TEXT = p_company_id
     FOR SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'point_a_document_not_found'
        USING ERRCODE = 'P0002';
    END IF;
  END IF;

  SELECT *
    INTO v_source
    FROM public.point_a_sources source
   WHERE source.id = p_source_id
     AND source.user_id = p_user_id
     AND source.company_id = p_company_id
   FOR UPDATE;
  IF NOT FOUND OR v_source.status = 'deleted' OR v_source.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'point_a_source_inactive'
      USING ERRCODE = '55000';
  END IF;

  -- Validate all candidate identities before mutating anything. Duplicate keys
  -- in a batch would otherwise silently supersede an earlier batch element.
  IF EXISTS (
    SELECT 1
      FROM JSONB_ARRAY_ELEMENTS(p_candidates) item
     GROUP BY item->>'candidate_key'
    HAVING COUNT(*) > 1
       OR BOOL_OR(
         JSONB_TYPEOF(item) <> 'object'
         OR NULLIF(BTRIM(item->>'candidate_key'), '') IS NULL
         OR NULLIF(BTRIM(item->>'field_key'), '') IS NULL
         OR NOT (item ? 'normalized_value')
       )
  ) THEN
    RAISE EXCEPTION 'point_a_candidate_identity_invalid_or_duplicate'
      USING ERRCODE = '22023';
  END IF;

  SELECT COALESCE(ARRAY_AGG(item->>'candidate_key'), ARRAY[]::TEXT[])
    INTO v_desired_keys
    FROM JSONB_ARRAY_ELEMENTS(p_candidates) item;

  IF p_replace_missing THEN
    FOR v_existing IN
      SELECT *
        FROM public.point_a_values value
       WHERE value.source_id = p_source_id
         AND value.status IN ('detected', 'needs_confirmation', 'confirmed')
         AND NOT (value.candidate_key = ANY(v_desired_keys))
       ORDER BY value.id
       FOR UPDATE
    LOOP
      UPDATE public.point_a_values
         SET status = 'superseded',
             confirmed_by = NULL,
             confirmed_at = NULL
       WHERE id = v_existing.id;

      INSERT INTO public.point_a_value_events (
        user_id, company_id, field_key, event_type, actor_id,
        old_value_id, metadata
      )
      VALUES (
        p_user_id, p_company_id, v_existing.field_key, 'corrected', v_actor,
        v_existing.id,
        JSONB_BUILD_OBJECT(
          'source_id', p_source_id,
          'candidate_key', v_existing.candidate_key,
          'reason', 'mapping_updated'
        )
      );

      v_groups := v_groups || JSONB_BUILD_OBJECT(
        MD5(CONCAT_WS(CHR(31), v_existing.field_key,
                      v_existing.period_key, v_existing.scenario)),
        JSONB_BUILD_OBJECT(
          'field_key', v_existing.field_key,
          'period_key', v_existing.period_key,
          'scenario', v_existing.scenario
        )
      );
      v_retired := v_retired + 1;
    END LOOP;
  END IF;

  FOR v_candidate IN
    SELECT item FROM JSONB_ARRAY_ELEMENTS(p_candidates) item
  LOOP
    v_candidate_key := BTRIM(v_candidate->>'candidate_key');
    v_field_key := BTRIM(v_candidate->>'field_key');
    v_period_key := COALESCE(v_candidate->>'period_key', '');
    v_scenario := COALESCE(v_candidate->>'scenario', 'fact');
    v_value_type := v_candidate->>'value_type';
    v_extraction_kind := v_candidate->>'extraction_kind';

    BEGIN
      v_confidence := NULLIF(v_candidate->>'confidence', '')::NUMERIC;
    EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
      RAISE EXCEPTION 'point_a_candidate_confidence_invalid for %',
        v_candidate_key USING ERRCODE = '22023';
    END;
    v_status := COALESCE(
      v_candidate->>'status',
      CASE WHEN COALESCE(v_confidence, 1) < 0.65
        THEN 'needs_confirmation' ELSE 'detected' END
    );

    IF v_value_type NOT IN ('number', 'text', 'boolean', 'date', 'list', 'object')
       OR v_extraction_kind NOT IN (
         'confirmed', 'manual', 'survey', 'table', 'text', 'ocr',
         'computed', 'prisma', 'external', 'inferred'
       )
       OR v_scenario NOT IN ('fact', 'plan', 'forecast')
       OR v_status NOT IN ('detected', 'needs_confirmation', 'confirmed')
       OR (v_confidence IS NOT NULL AND (v_confidence < 0 OR v_confidence > 1))
    THEN
      RAISE EXCEPTION 'point_a_candidate_shape_invalid for %',
        v_candidate_key USING ERRCODE = '22023';
    END IF;

    PERFORM pg_advisory_xact_lock(
      hashtextextended(
        CONCAT_WS(CHR(31), 'point-a-candidate',
                  p_source_id::TEXT, v_candidate_key),
        0
      )
    );

    v_existing := NULL;
    SELECT *
      INTO v_existing
      FROM public.point_a_values value
     WHERE value.source_id = p_source_id
       AND value.candidate_key = v_candidate_key
       AND value.status IN ('detected', 'needs_confirmation', 'confirmed')
     ORDER BY value.updated_at DESC, value.id DESC
     LIMIT 1
     FOR UPDATE;

    v_same := FOUND
      AND v_existing.field_key = v_field_key
      AND v_existing.value_type = v_value_type
      AND v_existing.unit IS NOT DISTINCT FROM (v_candidate->>'unit')
      AND v_existing.currency IS NOT DISTINCT FROM (v_candidate->>'currency')
      AND v_existing.period_key = v_period_key
      AND v_existing.scenario = v_scenario
      AND v_existing.extraction_kind = v_extraction_kind
      AND (
        CASE
          WHEN JSONB_TYPEOF(v_existing.normalized_value) = 'number'
           AND JSONB_TYPEOF(v_candidate->'normalized_value') = 'number'
          THEN ABS(
                 (v_existing.normalized_value #>> '{}')::NUMERIC
                 - (v_candidate->'normalized_value' #>> '{}')::NUMERIC
               ) <= (
                 0.0001 * GREATEST(
                   1,
                   ABS((v_existing.normalized_value #>> '{}')::NUMERIC),
                   ABS((v_candidate->'normalized_value' #>> '{}')::NUMERIC)
                 )
               )
          ELSE v_existing.normalized_value IS NOT DISTINCT FROM
               v_candidate->'normalized_value'
        END
      );

    IF v_same THEN
      v_unchanged := v_unchanged + 1;
      -- A prior interrupted/legacy write may have a value without resolution.
      IF NOT EXISTS (
        SELECT 1 FROM public.point_a_resolutions resolution
         WHERE resolution.company_id = p_company_id
           AND resolution.field_key = v_field_key
           AND resolution.period_key = v_period_key
           AND resolution.scenario = v_scenario
      ) THEN
        v_groups := v_groups || JSONB_BUILD_OBJECT(
          MD5(CONCAT_WS(CHR(31), v_field_key, v_period_key, v_scenario)),
          JSONB_BUILD_OBJECT(
            'field_key', v_field_key,
            'period_key', v_period_key,
            'scenario', v_scenario
          )
        );
      END IF;
      CONTINUE;
    END IF;

    IF v_existing.id IS NOT NULL THEN
      UPDATE public.point_a_values
         SET status = 'superseded',
             confirmed_by = NULL,
             confirmed_at = NULL
       WHERE id = v_existing.id;

      v_groups := v_groups || JSONB_BUILD_OBJECT(
        MD5(CONCAT_WS(CHR(31), v_existing.field_key,
                      v_existing.period_key, v_existing.scenario)),
        JSONB_BUILD_OBJECT(
          'field_key', v_existing.field_key,
          'period_key', v_existing.period_key,
          'scenario', v_existing.scenario
        )
      );
    END IF;

    BEGIN
      INSERT INTO public.point_a_values (
        user_id, company_id, source_id, candidate_key, field_key,
        raw_value, normalized_value, value_type, unit, currency,
        period_key, period_start, period_end, period_year,
        period_quarter, period_month, scenario, extraction_kind,
        source_fragment, source_locator, confidence, status,
        supersedes_value_id, confirmed_by, confirmed_at
      )
      VALUES (
        p_user_id, p_company_id, p_source_id, v_candidate_key, v_field_key,
        v_candidate->'raw_value', v_candidate->'normalized_value',
        v_value_type, v_candidate->>'unit', v_candidate->>'currency',
        v_period_key,
        NULLIF(v_candidate->>'period_start', '')::DATE,
        NULLIF(v_candidate->>'period_end', '')::DATE,
        NULLIF(v_candidate->>'period_year', '')::INTEGER,
        NULLIF(v_candidate->>'period_quarter', ''),
        NULLIF(v_candidate->>'period_month', '')::INTEGER,
        v_scenario, v_extraction_kind,
        v_candidate->>'source_fragment',
        COALESCE(v_candidate->'source_locator', '{}'::JSONB),
        v_confidence, v_status,
        CASE
          WHEN v_existing.id IS NOT NULL
           AND v_existing.field_key = v_field_key
           AND v_existing.period_key = v_period_key
           AND v_existing.scenario = v_scenario
          THEN v_existing.id
          ELSE NULL
        END,
        CASE WHEN v_status = 'confirmed' THEN v_actor ELSE NULL END,
        CASE WHEN v_status = 'confirmed' THEN NOW() ELSE NULL END
      )
      RETURNING * INTO v_inserted;
    EXCEPTION
      WHEN invalid_text_representation OR numeric_value_out_of_range
           OR check_violation THEN
        RAISE EXCEPTION 'point_a_candidate_shape_invalid for %: %',
          v_candidate_key, SQLERRM USING ERRCODE = '22023';
    END;

    INSERT INTO public.point_a_value_events (
      user_id, company_id, field_key, event_type, actor_id,
      old_value_id, new_value_id, metadata
    )
    VALUES (
      p_user_id, p_company_id, v_field_key,
      CASE WHEN v_existing.id IS NULL THEN 'created' ELSE 'corrected' END,
      v_actor, v_existing.id, v_inserted.id,
      JSONB_BUILD_OBJECT(
        'source_id', p_source_id,
        'candidate_key', v_candidate_key
      )
    );

    v_groups := v_groups || JSONB_BUILD_OBJECT(
      MD5(CONCAT_WS(CHR(31), v_field_key, v_period_key, v_scenario)),
      JSONB_BUILD_OBJECT(
        'field_key', v_field_key,
        'period_key', v_period_key,
        'scenario', v_scenario
      )
    );
    v_created := v_created + 1;
  END LOOP;

  FOR v_group IN
    SELECT entry.value AS group_value
      FROM JSONB_EACH(v_groups) entry
     ORDER BY entry.key
  LOOP
    SELECT *
      INTO v_resolution
      FROM public.point_a_recompute_field_atomic(
        p_user_id,
        p_company_id,
        v_group.group_value->>'field_key',
        COALESCE(v_group.group_value->>'period_key', ''),
        COALESCE(v_group.group_value->>'scenario', 'fact'),
        v_actor,
        'ingest_candidates',
        public.point_a_expected_resolution_version(
          p_expected_versions,
          v_group.group_value->>'field_key',
          COALESCE(v_group.group_value->>'period_key', ''),
          COALESCE(v_group.group_value->>'scenario', 'fact')
        )
      );
    v_resolutions := v_resolutions || JSONB_BUILD_ARRAY(TO_JSONB(v_resolution));
  END LOOP;

  RETURN JSONB_BUILD_OBJECT(
    'source_id', p_source_id,
    'created', v_created,
    'unchanged', v_unchanged,
    'retired', v_retired,
    'groups', JSONB_ARRAY_LENGTH(v_resolutions),
    'resolutions', v_resolutions
  );
END;
$$;

COMMENT ON FUNCTION public.point_a_ingest_candidates_atomic(
  TEXT, TEXT, UUID, JSONB, TEXT, BOOLEAN, JSONB
) IS
  'Atomically replaces one source candidate set, appends created/corrected history and recomputes every affected resolution with optional per-key CAS.';

CREATE OR REPLACE FUNCTION public.point_a_confirm_value_atomic(
  p_user_id TEXT,
  p_company_id TEXT,
  p_value_id UUID,
  p_event_type TEXT DEFAULT 'confirmed',
  p_expected_version INTEGER DEFAULT NULL,
  p_reason TEXT DEFAULT NULL
)
RETURNS public.point_a_resolutions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_value_snapshot public.point_a_values%ROWTYPE;
  v_value public.point_a_values%ROWTYPE;
  v_source public.point_a_sources%ROWTYPE;
  v_previous public.point_a_resolutions%ROWTYPE;
  v_result public.point_a_resolutions%ROWTYPE;
  v_demoted_ids JSONB := '[]'::JSONB;
  v_actor TEXT := COALESCE(auth.uid()::TEXT, p_user_id);
BEGIN
  PERFORM public.point_a_assert_mutation_scope(p_user_id, p_company_id);
  IF p_event_type NOT IN ('confirmed', 'conflict_resolved') THEN
    RAISE EXCEPTION 'point_a_confirmation_event_invalid'
      USING ERRCODE = '22023';
  END IF;

  SELECT *
    INTO v_value_snapshot
    FROM public.point_a_values value
   WHERE value.id = p_value_id
     AND value.user_id = p_user_id
     AND value.company_id = p_company_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'point_a_value_not_found'
      USING ERRCODE = 'P0002';
  END IF;

  SELECT *
    INTO v_source
    FROM public.point_a_sources source
   WHERE source.id = v_value_snapshot.source_id
     AND source.user_id = p_user_id
     AND source.company_id = p_company_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'point_a_source_not_found'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_source.source_type = 'document' THEN
    PERFORM 1
      FROM public.documents document
     WHERE document.id::TEXT = v_source.native_source_id
       AND document.user_id::TEXT = p_user_id
       AND document.company_id::TEXT = p_company_id
     FOR SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'point_a_document_not_found'
        USING ERRCODE = 'P0002';
    END IF;
  END IF;

  SELECT *
    INTO v_source
    FROM public.point_a_sources source
   WHERE source.id = v_value_snapshot.source_id
     AND source.user_id = p_user_id
     AND source.company_id = p_company_id
   FOR SHARE;
  IF v_source.status = 'deleted' OR v_source.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'point_a_source_inactive'
      USING ERRCODE = '55000';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(
      CONCAT_WS(CHR(31), 'point-a-resolution', p_company_id,
                v_value_snapshot.field_key, v_value_snapshot.period_key,
                v_value_snapshot.scenario),
      0
    )
  );

  -- Lock the whole group: exactly one confirmed value is an invariant of the
  -- command even though schema 070 does not yet encode it as a unique index.
  PERFORM 1
    FROM public.point_a_values value
   WHERE value.company_id = p_company_id
     AND value.field_key = v_value_snapshot.field_key
     AND value.period_key = v_value_snapshot.period_key
     AND value.scenario = v_value_snapshot.scenario
     AND value.status NOT IN ('superseded', 'retracted')
   ORDER BY value.id
   FOR UPDATE;

  SELECT *
    INTO v_value
    FROM public.point_a_values value
   WHERE value.id = p_value_id;
  IF v_value.status IN ('rejected', 'superseded', 'retracted') THEN
    RAISE EXCEPTION 'point_a_value_inactive'
      USING ERRCODE = '55000';
  END IF;

  SELECT *
    INTO v_previous
    FROM public.point_a_resolutions resolution
   WHERE resolution.company_id = p_company_id
     AND resolution.field_key = v_value.field_key
     AND resolution.period_key = v_value.period_key
     AND resolution.scenario = v_value.scenario
   FOR UPDATE;

  -- Safe retry after a lost response: no second event/version is produced.
  IF v_value.status = 'confirmed'
     AND v_previous.selected_value_id = p_value_id
     AND v_previous.resolution_status = 'resolved'
     AND NOT EXISTS (
       SELECT 1
         FROM public.point_a_values other
        WHERE other.company_id = p_company_id
          AND other.field_key = v_value.field_key
          AND other.period_key = v_value.period_key
          AND other.scenario = v_value.scenario
          AND other.status = 'confirmed'
          AND other.id <> p_value_id
     ) THEN
    RETURN v_previous;
  END IF;

  IF p_event_type = 'conflict_resolved'
     AND COALESCE(v_previous.resolution_status, 'empty') <> 'conflict' THEN
    RAISE EXCEPTION 'point_a_resolution_is_not_conflicted'
      USING ERRCODE = '55000';
  END IF;

  SELECT COALESCE(JSONB_AGG(value.id ORDER BY value.id), '[]'::JSONB)
    INTO v_demoted_ids
    FROM public.point_a_values value
   WHERE value.company_id = p_company_id
     AND value.field_key = v_value.field_key
     AND value.period_key = v_value.period_key
     AND value.scenario = v_value.scenario
     AND value.status = 'confirmed'
     AND value.id <> p_value_id;

  UPDATE public.point_a_values value
     SET status = 'detected',
         confirmed_by = NULL,
         confirmed_at = NULL
   WHERE value.company_id = p_company_id
     AND value.field_key = v_value.field_key
     AND value.period_key = v_value.period_key
     AND value.scenario = v_value.scenario
     AND value.status = 'confirmed'
     AND value.id <> p_value_id;

  UPDATE public.point_a_values
     SET status = 'confirmed',
         confirmed_by = v_actor,
         confirmed_at = NOW()
   WHERE id = p_value_id
   RETURNING * INTO v_value;

  SELECT *
    INTO v_result
    FROM public.point_a_recompute_field_atomic(
      p_user_id, p_company_id, v_value.field_key, v_value.period_key,
      v_value.scenario, v_actor,
      COALESCE(
        p_reason,
        CASE WHEN p_event_type = 'conflict_resolved'
          THEN 'Пользователь выбрал значение в конфликте'
          ELSE 'Пользователь подтвердил значение'
        END
      ),
      p_expected_version
    );

  -- conflict_resolved is emitted by recompute on the state transition.
  IF p_event_type = 'confirmed' THEN
    INSERT INTO public.point_a_value_events (
      user_id, company_id, field_key, event_type, actor_id,
      old_value_id, new_value_id, metadata
    )
    VALUES (
      p_user_id, p_company_id, v_value.field_key, 'confirmed', v_actor,
      v_previous.selected_value_id, p_value_id,
      JSONB_BUILD_OBJECT(
        'period_key', v_value.period_key,
        'scenario', v_value.scenario,
        'demoted_value_ids', v_demoted_ids,
        'reason', p_reason,
        'resolution_version', v_result.version
      )
    );
  END IF;

  RETURN v_result;
END;
$$;

COMMENT ON FUNCTION public.point_a_confirm_value_atomic(
  TEXT, TEXT, UUID, TEXT, INTEGER, TEXT
) IS
  'Atomically confirms one active value, demotes prior confirmations, appends history and recomputes/projections with CAS. Repeated confirmation is idempotent.';

CREATE OR REPLACE FUNCTION public.point_a_retract_source_atomic(
  p_user_id TEXT,
  p_company_id TEXT,
  p_source_id UUID,
  p_force_confirmed BOOLEAN DEFAULT FALSE,
  p_expected_versions JSONB DEFAULT NULL,
  p_reason TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_source_snapshot public.point_a_sources%ROWTYPE;
  v_source public.point_a_sources%ROWTYPE;
  v_value public.point_a_values%ROWTYPE;
  v_group RECORD;
  v_resolution public.point_a_resolutions%ROWTYPE;
  v_groups JSONB := '{}'::JSONB;
  v_resolutions JSONB := '[]'::JSONB;
  v_retracted INTEGER := 0;
  v_actor TEXT := COALESCE(auth.uid()::TEXT, p_user_id);
BEGIN
  PERFORM public.point_a_assert_mutation_scope(p_user_id, p_company_id);
  IF p_expected_versions IS NOT NULL
     AND JSONB_TYPEOF(p_expected_versions) <> 'array' THEN
    RAISE EXCEPTION 'point_a_expected_versions_must_be_array'
      USING ERRCODE = '22023';
  END IF;

  SELECT *
    INTO v_source_snapshot
    FROM public.point_a_sources source
   WHERE source.id = p_source_id
     AND source.user_id = p_user_id
     AND source.company_id = p_company_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'point_a_source_not_found'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_source_snapshot.source_type = 'document'
     AND v_source_snapshot.status <> 'deleted' THEN
    PERFORM 1
      FROM public.documents document
     WHERE document.id::TEXT = v_source_snapshot.native_source_id
       AND document.user_id::TEXT = p_user_id
       AND document.company_id::TEXT = p_company_id
     FOR SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'point_a_document_not_found'
        USING ERRCODE = 'P0002';
    END IF;
  END IF;

  SELECT *
    INTO v_source
    FROM public.point_a_sources source
   WHERE source.id = p_source_id
     AND source.user_id = p_user_id
     AND source.company_id = p_company_id
   FOR UPDATE;

  IF v_source.status = 'deleted' OR v_source.deleted_at IS NOT NULL THEN
    RETURN JSONB_BUILD_OBJECT(
      'source_id', p_source_id,
      'already_retracted', TRUE,
      'retracted', 0,
      'groups', 0,
      'resolutions', '[]'::JSONB
    );
  END IF;

  PERFORM 1
    FROM public.point_a_values value
   WHERE value.source_id = p_source_id
     AND value.status NOT IN ('superseded', 'retracted')
   ORDER BY value.id
   FOR UPDATE;

  IF NOT p_force_confirmed AND EXISTS (
    SELECT 1
      FROM public.point_a_values value
     WHERE value.source_id = p_source_id
       AND value.status NOT IN ('superseded', 'retracted')
       AND (
         value.status = 'confirmed'
         OR value.extraction_kind = 'confirmed'
       )
  ) THEN
    RAISE EXCEPTION 'point_a_confirmed_values_require_force'
      USING ERRCODE = '55000',
            HINT = 'Retry with p_force_confirmed = true after explicit user confirmation.';
  END IF;

  FOR v_value IN
    SELECT *
      FROM public.point_a_values value
     WHERE value.source_id = p_source_id
       AND value.status NOT IN ('superseded', 'retracted')
     ORDER BY value.id
  LOOP
    INSERT INTO public.point_a_value_events (
      user_id, company_id, field_key, event_type, actor_id,
      old_value_id, metadata
    )
    VALUES (
      p_user_id, p_company_id, v_value.field_key,
      'source_retracted', v_actor, v_value.id,
      JSONB_BUILD_OBJECT(
        'source_id', p_source_id,
        'candidate_key', v_value.candidate_key,
        'was_confirmed',
          v_value.status = 'confirmed'
          OR v_value.extraction_kind = 'confirmed',
        'reason', p_reason
      )
    );

    v_groups := v_groups || JSONB_BUILD_OBJECT(
      MD5(CONCAT_WS(CHR(31), v_value.field_key,
                    v_value.period_key, v_value.scenario)),
      JSONB_BUILD_OBJECT(
        'field_key', v_value.field_key,
        'period_key', v_value.period_key,
        'scenario', v_value.scenario
      )
    );
    v_retracted := v_retracted + 1;
  END LOOP;

  UPDATE public.point_a_values value
     SET status = 'retracted',
         confirmed_by = NULL,
         confirmed_at = NULL
   WHERE value.source_id = p_source_id
     AND value.status NOT IN ('superseded', 'retracted');

  UPDATE public.point_a_sources
     SET status = 'deleted',
         deleted_at = NOW()
   WHERE id = p_source_id;

  FOR v_group IN
    SELECT entry.value AS group_value
      FROM JSONB_EACH(v_groups) entry
     ORDER BY entry.key
  LOOP
    SELECT *
      INTO v_resolution
      FROM public.point_a_recompute_field_atomic(
        p_user_id,
        p_company_id,
        v_group.group_value->>'field_key',
        COALESCE(v_group.group_value->>'period_key', ''),
        COALESCE(v_group.group_value->>'scenario', 'fact'),
        v_actor,
        COALESCE(p_reason, 'source_retracted'),
        public.point_a_expected_resolution_version(
          p_expected_versions,
          v_group.group_value->>'field_key',
          COALESCE(v_group.group_value->>'period_key', ''),
          COALESCE(v_group.group_value->>'scenario', 'fact')
        )
      );
    v_resolutions := v_resolutions || JSONB_BUILD_ARRAY(TO_JSONB(v_resolution));
  END LOOP;

  RETURN JSONB_BUILD_OBJECT(
    'source_id', p_source_id,
    'already_retracted', FALSE,
    'retracted', v_retracted,
    'groups', JSONB_ARRAY_LENGTH(v_resolutions),
    'resolutions', v_resolutions
  );
END;
$$;

COMMENT ON FUNCTION public.point_a_retract_source_atomic(
  TEXT, TEXT, UUID, BOOLEAN, JSONB, TEXT
) IS
  'Atomically retracts a source and its values, refuses confirmed values without force, appends history, and recomputes all affected keys with optional CAS.';

CREATE OR REPLACE FUNCTION public.point_a_delete_document_atomic(
  p_user_id TEXT,
  p_company_id TEXT,
  p_document_id UUID,
  p_force_confirmed BOOLEAN DEFAULT FALSE,
  p_expected_versions JSONB DEFAULT NULL,
  p_reason TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_document public.documents%ROWTYPE;
  v_source_id UUID;
  v_retraction JSONB := JSONB_BUILD_OBJECT(
    'retracted', 0, 'groups', 0, 'resolutions', '[]'::JSONB
  );
BEGIN
  PERFORM public.point_a_assert_mutation_scope(p_user_id, p_company_id);

  SELECT *
    INTO v_document
    FROM public.documents document
   WHERE document.id = p_document_id
     AND document.user_id::TEXT = p_user_id
     AND document.company_id::TEXT = p_company_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'point_a_document_not_found'
      USING ERRCODE = 'P0002';
  END IF;

  SELECT source.id
    INTO v_source_id
    FROM public.point_a_sources source
   WHERE source.user_id = p_user_id
     AND source.company_id = p_company_id
     AND source.source_type = 'document'
     AND source.native_source_id = p_document_id::TEXT
     AND source.deleted_at IS NULL
   FOR UPDATE;

  IF v_source_id IS NOT NULL THEN
    v_retraction := public.point_a_retract_source_atomic(
      p_user_id,
      p_company_id,
      v_source_id,
      p_force_confirmed,
      p_expected_versions,
      COALESCE(p_reason, 'document_deleted')
    );
  END IF;

  DELETE FROM public.documents
   WHERE id = p_document_id;

  RETURN JSONB_BUILD_OBJECT(
    'deleted', TRUE,
    'document_id', p_document_id,
    'file_url', v_document.file_url,
    'parse_status', v_document.parse_status,
    'retraction', v_retraction
  );
END;
$$;

COMMENT ON FUNCTION public.point_a_delete_document_atomic(
  TEXT, TEXT, UUID, BOOLEAN, JSONB, TEXT
) IS
  'Deletes an owned authoritative document and retracts/recomputes its canonical Point A source in the same database transaction. Returns file_url for post-commit storage cleanup.';

-- Internal helpers are not callable through PostgREST. Public mutation RPCs
-- remain inaccessible to anon and perform their own scope check.
REVOKE ALL ON FUNCTION public.point_a_assert_mutation_scope(TEXT, TEXT)
  FROM PUBLIC;
REVOKE ALL ON FUNCTION public.point_a_expected_resolution_version(
  JSONB, TEXT, TEXT, TEXT
) FROM PUBLIC;

REVOKE ALL ON FUNCTION public.point_a_recompute_field_atomic(
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, INTEGER
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.point_a_ensure_source_atomic(
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.point_a_ingest_candidates_atomic(
  TEXT, TEXT, UUID, JSONB, TEXT, BOOLEAN, JSONB
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.point_a_confirm_value_atomic(
  TEXT, TEXT, UUID, TEXT, INTEGER, TEXT
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.point_a_retract_source_atomic(
  TEXT, TEXT, UUID, BOOLEAN, JSONB, TEXT
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.point_a_delete_document_atomic(
  TEXT, TEXT, UUID, BOOLEAN, JSONB, TEXT
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.point_a_recompute_field_atomic(
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, INTEGER
) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.point_a_ensure_source_atomic(
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB
) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.point_a_ingest_candidates_atomic(
  TEXT, TEXT, UUID, JSONB, TEXT, BOOLEAN, JSONB
) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.point_a_confirm_value_atomic(
  TEXT, TEXT, UUID, TEXT, INTEGER, TEXT
) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.point_a_retract_source_atomic(
  TEXT, TEXT, UUID, BOOLEAN, JSONB, TEXT
) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.point_a_delete_document_atomic(
  TEXT, TEXT, UUID, BOOLEAN, JSONB, TEXT
) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
