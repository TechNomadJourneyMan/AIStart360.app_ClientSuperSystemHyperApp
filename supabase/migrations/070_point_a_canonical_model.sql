-- Canonical Point A fact model.
--
-- `public.metrics` remains a numeric projection for charts and realtime.
-- The tables below preserve every source candidate, manual corrections,
-- confirmation decisions, conflicts and immutable history.

BEGIN;

ALTER TABLE public.documents
  ADD COLUMN IF NOT EXISTS content_hash TEXT,
  ADD COLUMN IF NOT EXISTS processing_started_at TIMESTAMPTZ;

CREATE UNIQUE INDEX IF NOT EXISTS documents_owner_content_hash_uidx
  ON public.documents(user_id, content_hash)
  WHERE content_hash IS NOT NULL;

ALTER TABLE public.metrics
  ADD COLUMN IF NOT EXISTS period_month INTEGER
    CHECK (period_month IS NULL OR period_month BETWEEN 1 AND 12),
  ADD COLUMN IF NOT EXISTS scenario TEXT NOT NULL DEFAULT 'fact'
    CHECK (scenario IN ('fact', 'plan', 'forecast'));

-- Legacy uniqueness treated NULL periods as always distinct, so repeated
-- materialization could leave several rows for the same logical projection.
-- Keep the newest row before installing the canonical PG15+ conflict target.
WITH ranked_metrics AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY
        company_id, metric_key, period_year, period_quarter,
        period_month, scenario, source
      ORDER BY COALESCE(computed_at, recorded_at) DESC, id DESC
    ) AS duplicate_rank
  FROM public.metrics
)
DELETE FROM public.metrics metric
USING ranked_metrics ranked
WHERE metric.id = ranked.id
  AND ranked.duplicate_rank > 1;

DROP INDEX IF EXISTS public.metrics_unique_idx;
CREATE UNIQUE INDEX metrics_unique_idx
  ON public.metrics(
    company_id, metric_key, period_year, period_quarter,
    period_month, scenario, source
  )
  NULLS NOT DISTINCT;

CREATE TABLE IF NOT EXISTS public.point_a_sources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  company_id TEXT REFERENCES public.companies(id) ON DELETE CASCADE,
  source_type TEXT NOT NULL
    CHECK (source_type IN (
      'survey', 'manual', 'document', 'computed', 'prisma', 'external'
    )),
  native_source_id TEXT,
  content_hash TEXT,
  source_name TEXT,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'processing', 'ready', 'error', 'deleted')),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,
  CHECK (
    (status = 'deleted' AND deleted_at IS NOT NULL)
    OR (status <> 'deleted' AND deleted_at IS NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS point_a_sources_native_uidx
  ON public.point_a_sources(
    user_id,
    COALESCE(company_id, ''),
    source_type,
    native_source_id
  )
  WHERE native_source_id IS NOT NULL AND deleted_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS point_a_sources_hash_uidx
  ON public.point_a_sources(
    user_id,
    COALESCE(company_id, ''),
    source_type,
    content_hash
  )
  WHERE content_hash IS NOT NULL AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS point_a_sources_company_idx
  ON public.point_a_sources(company_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS public.point_a_values (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  company_id TEXT REFERENCES public.companies(id) ON DELETE CASCADE,
  source_id UUID NOT NULL REFERENCES public.point_a_sources(id) ON DELETE CASCADE,
  candidate_key TEXT NOT NULL,
  field_key TEXT NOT NULL,
  raw_value JSONB,
  normalized_value JSONB,
  value_type TEXT NOT NULL
    CHECK (value_type IN ('number', 'text', 'boolean', 'date', 'list', 'object')),
  unit TEXT,
  currency TEXT,
  period_key TEXT NOT NULL DEFAULT '',
  period_start DATE,
  period_end DATE,
  period_year INTEGER,
  period_quarter TEXT
    CHECK (period_quarter IS NULL OR period_quarter IN ('Q1', 'Q2', 'Q3', 'Q4')),
  period_month INTEGER
    CHECK (period_month IS NULL OR period_month BETWEEN 1 AND 12),
  scenario TEXT NOT NULL DEFAULT 'fact'
    CHECK (scenario IN ('fact', 'plan', 'forecast')),
  extraction_kind TEXT NOT NULL
    CHECK (extraction_kind IN (
      'confirmed', 'manual', 'survey', 'table', 'text', 'ocr',
      'computed', 'prisma', 'external', 'inferred'
    )),
  source_fragment TEXT,
  source_locator JSONB NOT NULL DEFAULT '{}'::jsonb,
  confidence NUMERIC(5,4)
    CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
  status TEXT NOT NULL DEFAULT 'detected'
    CHECK (status IN (
      'detected', 'needs_confirmation', 'confirmed', 'rejected',
      'superseded', 'retracted'
    )),
  supersedes_value_id UUID REFERENCES public.point_a_values(id) ON DELETE SET NULL,
  confirmed_by TEXT,
  confirmed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (status <> 'confirmed' OR confirmed_at IS NOT NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS point_a_values_active_candidate_uidx
  ON public.point_a_values(source_id, candidate_key)
  WHERE status NOT IN ('rejected', 'superseded', 'retracted');

CREATE INDEX IF NOT EXISTS point_a_values_resolution_idx
  ON public.point_a_values(
    company_id, field_key, period_key, scenario, status, updated_at DESC
  );

CREATE INDEX IF NOT EXISTS point_a_values_source_idx
  ON public.point_a_values(source_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS public.point_a_resolutions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  company_id TEXT NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  field_key TEXT NOT NULL,
  period_key TEXT NOT NULL DEFAULT '',
  scenario TEXT NOT NULL DEFAULT 'fact'
    CHECK (scenario IN ('fact', 'plan', 'forecast')),
  selected_value_id UUID REFERENCES public.point_a_values(id) ON DELETE SET NULL,
  resolution_status TEXT NOT NULL DEFAULT 'empty'
    CHECK (resolution_status IN ('resolved', 'conflict', 'needs_confirmation', 'empty')),
  decided_by TEXT,
  decided_at TIMESTAMPTZ,
  decision_reason TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(company_id, field_key, period_key, scenario)
);

CREATE INDEX IF NOT EXISTS point_a_resolutions_user_idx
  ON public.point_a_resolutions(user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS public.point_a_value_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  company_id TEXT REFERENCES public.companies(id) ON DELETE CASCADE,
  field_key TEXT NOT NULL,
  event_type TEXT NOT NULL
    CHECK (event_type IN (
      'created', 'corrected', 'confirmed', 'rejected',
      'conflict_detected', 'conflict_resolved', 'source_retracted'
    )),
  actor_id TEXT,
  old_value_id UUID REFERENCES public.point_a_values(id) ON DELETE SET NULL,
  new_value_id UUID REFERENCES public.point_a_values(id) ON DELETE SET NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS point_a_value_events_history_idx
  ON public.point_a_value_events(company_id, field_key, created_at DESC);

CREATE OR REPLACE FUNCTION public.point_a_validate_company_owner()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  IF NEW.company_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
      FROM public.companies c
     WHERE c.id = NEW.company_id
       AND c.user_id::text = NEW.user_id::text
  ) THEN
    RAISE EXCEPTION 'company_id does not belong to user_id';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS point_a_sources_company_owner ON public.point_a_sources;
CREATE TRIGGER point_a_sources_company_owner
  BEFORE INSERT OR UPDATE OF user_id, company_id ON public.point_a_sources
  FOR EACH ROW EXECUTE FUNCTION public.point_a_validate_company_owner();

DROP TRIGGER IF EXISTS point_a_values_company_owner ON public.point_a_values;
CREATE TRIGGER point_a_values_company_owner
  BEFORE INSERT OR UPDATE OF user_id, company_id ON public.point_a_values
  FOR EACH ROW EXECUTE FUNCTION public.point_a_validate_company_owner();

DROP TRIGGER IF EXISTS point_a_resolutions_company_owner ON public.point_a_resolutions;
CREATE TRIGGER point_a_resolutions_company_owner
  BEFORE INSERT OR UPDATE OF user_id, company_id ON public.point_a_resolutions
  FOR EACH ROW EXECUTE FUNCTION public.point_a_validate_company_owner();

DROP TRIGGER IF EXISTS point_a_events_company_owner ON public.point_a_value_events;
CREATE TRIGGER point_a_events_company_owner
  BEFORE INSERT OR UPDATE OF user_id, company_id ON public.point_a_value_events
  FOR EACH ROW EXECUTE FUNCTION public.point_a_validate_company_owner();

CREATE OR REPLACE FUNCTION public.point_a_validate_value_source()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM public.point_a_sources source
     WHERE source.id = NEW.source_id
       AND source.user_id = NEW.user_id
       AND source.company_id IS NOT DISTINCT FROM NEW.company_id
       AND source.status <> 'deleted'
       AND source.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'source_id is inactive or does not belong to the value user/company';
  END IF;

  IF NEW.supersedes_value_id IS NOT NULL AND (
    NEW.supersedes_value_id = NEW.id
    OR NOT EXISTS (
      SELECT 1
        FROM public.point_a_values previous
       WHERE previous.id = NEW.supersedes_value_id
         AND previous.user_id = NEW.user_id
         AND previous.company_id IS NOT DISTINCT FROM NEW.company_id
         AND previous.source_id = NEW.source_id
         AND previous.candidate_key = NEW.candidate_key
         AND previous.field_key = NEW.field_key
         AND previous.period_key = NEW.period_key
         AND previous.scenario = NEW.scenario
    )
  ) THEN
    RAISE EXCEPTION 'supersedes_value_id does not belong to the candidate history';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS point_a_values_source_owner ON public.point_a_values;
CREATE TRIGGER point_a_values_source_owner
  BEFORE INSERT OR UPDATE OF
    user_id, company_id, source_id, candidate_key, field_key,
    period_key, scenario, supersedes_value_id
  ON public.point_a_values
  FOR EACH ROW EXECUTE FUNCTION public.point_a_validate_value_source();

CREATE OR REPLACE FUNCTION public.point_a_validate_resolution_value()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  IF NEW.selected_value_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
      FROM public.point_a_values value
     WHERE value.id = NEW.selected_value_id
       AND value.user_id = NEW.user_id
       AND value.company_id = NEW.company_id
       AND value.field_key = NEW.field_key
       AND value.period_key = NEW.period_key
       AND value.scenario = NEW.scenario
       AND value.status NOT IN ('rejected', 'superseded', 'retracted')
  ) THEN
    RAISE EXCEPTION 'selected_value_id does not belong to the resolution key';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS point_a_resolutions_selected_value
  ON public.point_a_resolutions;
CREATE TRIGGER point_a_resolutions_selected_value
  BEFORE INSERT OR UPDATE OF
    user_id, company_id, field_key, period_key, scenario, selected_value_id
  ON public.point_a_resolutions
  FOR EACH ROW EXECUTE FUNCTION public.point_a_validate_resolution_value();

CREATE OR REPLACE FUNCTION public.point_a_validate_event_values()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  IF NEW.old_value_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
      FROM public.point_a_values value
     WHERE value.id = NEW.old_value_id
       AND value.user_id = NEW.user_id
       AND value.company_id IS NOT DISTINCT FROM NEW.company_id
       AND value.field_key = NEW.field_key
  ) THEN
    RAISE EXCEPTION 'old_value_id does not belong to the event user/company/field';
  END IF;

  IF NEW.new_value_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
      FROM public.point_a_values value
     WHERE value.id = NEW.new_value_id
       AND value.user_id = NEW.user_id
       AND value.company_id IS NOT DISTINCT FROM NEW.company_id
       AND value.field_key = NEW.field_key
  ) THEN
    RAISE EXCEPTION 'new_value_id does not belong to the event user/company/field';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS point_a_events_values
  ON public.point_a_value_events;
CREATE TRIGGER point_a_events_values
  BEFORE INSERT OR UPDATE OF
    user_id, company_id, field_key, old_value_id, new_value_id
  ON public.point_a_value_events
  FOR EACH ROW EXECUTE FUNCTION public.point_a_validate_event_values();

DROP TRIGGER IF EXISTS point_a_sources_updated_at ON public.point_a_sources;
CREATE TRIGGER point_a_sources_updated_at
  BEFORE UPDATE ON public.point_a_sources
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS point_a_values_updated_at ON public.point_a_values;
CREATE TRIGGER point_a_values_updated_at
  BEFORE UPDATE ON public.point_a_values
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS point_a_resolutions_updated_at ON public.point_a_resolutions;
CREATE TRIGGER point_a_resolutions_updated_at
  BEFORE UPDATE ON public.point_a_resolutions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.point_a_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.point_a_values ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.point_a_resolutions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.point_a_value_events ENABLE ROW LEVEL SECURITY;

DO $policies$
DECLARE
  v_table_name TEXT;
BEGIN
  FOREACH v_table_name IN ARRAY ARRAY[
    'point_a_sources', 'point_a_values', 'point_a_resolutions'
  ]
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', v_table_name || '_select_own', v_table_name);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', v_table_name || '_insert_own', v_table_name);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', v_table_name || '_update_own', v_table_name);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', v_table_name || '_delete_own', v_table_name);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', v_table_name || '_staff_all', v_table_name);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', v_table_name || '_staff_select', v_table_name);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', v_table_name || '_staff_insert', v_table_name);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', v_table_name || '_staff_update', v_table_name);

    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT USING (user_id = auth.uid()::text)',
      v_table_name || '_select_own', v_table_name
    );
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR INSERT WITH CHECK (user_id = auth.uid()::text)',
      v_table_name || '_insert_own', v_table_name
    );
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR UPDATE USING (user_id = auth.uid()::text) WITH CHECK (user_id = auth.uid()::text)',
      v_table_name || '_update_own', v_table_name
    );
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT USING (
        public.current_user_role() IN
          (''super_admin'', ''admin'', ''manager'', ''analyst'', ''expert'')
      )',
      v_table_name || '_staff_select', v_table_name
    );
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR INSERT WITH CHECK (
        public.current_user_role() IN
          (''super_admin'', ''admin'', ''manager'', ''analyst'', ''expert'')
      )',
      v_table_name || '_staff_insert', v_table_name
    );
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR UPDATE USING (
        public.current_user_role() IN
          (''super_admin'', ''admin'', ''manager'', ''analyst'', ''expert'')
      ) WITH CHECK (
        public.current_user_role() IN
          (''super_admin'', ''admin'', ''manager'', ''analyst'', ''expert'')
      )',
      v_table_name || '_staff_update', v_table_name
    );
  END LOOP;
END;
$policies$;

-- History is append-only. Authenticated users and staff can read/append events,
-- but no UPDATE/DELETE policy exists. Service-role maintenance remains possible.
DROP POLICY IF EXISTS point_a_value_events_select_own
  ON public.point_a_value_events;
DROP POLICY IF EXISTS point_a_value_events_insert_own
  ON public.point_a_value_events;
DROP POLICY IF EXISTS point_a_value_events_update_own
  ON public.point_a_value_events;
DROP POLICY IF EXISTS point_a_value_events_delete_own
  ON public.point_a_value_events;
DROP POLICY IF EXISTS point_a_value_events_staff_all
  ON public.point_a_value_events;
DROP POLICY IF EXISTS point_a_value_events_staff_select
  ON public.point_a_value_events;
DROP POLICY IF EXISTS point_a_value_events_staff_insert
  ON public.point_a_value_events;
DROP POLICY IF EXISTS point_a_value_events_staff_update
  ON public.point_a_value_events;

CREATE POLICY point_a_value_events_select_own
  ON public.point_a_value_events
  FOR SELECT USING (user_id = auth.uid()::text);

CREATE POLICY point_a_value_events_insert_own
  ON public.point_a_value_events
  FOR INSERT WITH CHECK (user_id = auth.uid()::text);

CREATE POLICY point_a_value_events_staff_select
  ON public.point_a_value_events
  FOR SELECT USING (
    public.current_user_role() IN
      ('super_admin', 'admin', 'manager', 'analyst', 'expert')
  );

CREATE POLICY point_a_value_events_staff_insert
  ON public.point_a_value_events
  FOR INSERT WITH CHECK (
    public.current_user_role() IN
      ('super_admin', 'admin', 'manager', 'analyst', 'expert')
  );

DO $realtime$
DECLARE
  v_table_name TEXT;
BEGIN
  FOREACH v_table_name IN ARRAY ARRAY[
    'point_a_sources', 'point_a_values', 'point_a_resolutions'
  ]
  LOOP
    IF NOT EXISTS (
      SELECT 1
        FROM pg_publication_tables
       WHERE pubname = 'supabase_realtime'
         AND schemaname = 'public'
         AND tablename = v_table_name
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', v_table_name);
    END IF;
    EXECUTE format('ALTER TABLE public.%I REPLICA IDENTITY FULL', v_table_name);
  END LOOP;
END;
$realtime$;

NOTIFY pgrst, 'reload schema';

COMMIT;
