-- 085_diagnostics_provenance_reports.sql
--
-- Diagnostic sessions, explainable findings and recommendations, metric
-- history and targets, versioned reports (docs/platform/03-database.md, D2/D5).
--
-- Provenance vocabulary used by findings, recommendations and metrics:
--   FACT            value stated by the client or a source system (survey, document, CRM)
--   CALCULATED      deterministic formula over facts (engine/resolver)
--   INFERRED        deterministic rule that interprets facts (e.g. "no CRM ⇒ manual sales")
--   AI_HYPOTHESIS   produced by a model; never shown to the client before review
--   RECOMMENDATION  suggested action
--
-- All tables are company-scoped (company_id TEXT → companies.id), readable via
-- public.can_read_company() (084) and written only by the service role.
--
-- Idempotent. Apply: node scripts/apply-migration.js supabase/migrations/085_diagnostics_provenance_reports.sql

-- ─── Diagnostic sessions ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.diagnostic_sessions (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      TEXT        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  initiated_by    TEXT,                       -- auth uid, 'agent:<key>', 'system'
  kind            TEXT        NOT NULL DEFAULT 'point_a'
                  CHECK (kind IN ('point_a', 'full', 'refresh', 'gri')),
  status          TEXT        NOT NULL DEFAULT 'collecting'
                  CHECK (status IN ('collecting', 'processing', 'ready', 'failed', 'cancelled', 'archived')),
  trigger         TEXT        NOT NULL DEFAULT 'manual'
                  CHECK (trigger IN ('manual', 'event', 'schedule', 'agent')),
  diagnostic_id   UUID        REFERENCES public.diagnostics(id) ON DELETE SET NULL,
  overview        JSONB,                      -- executive overview snapshot at completion
  completeness    NUMERIC(4,3) CHECK (completeness IS NULL OR completeness BETWEEN 0 AND 1),
  sources         JSONB       NOT NULL DEFAULT '{}'::jsonb,   -- counts per source kind
  error           TEXT,
  started_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.diagnostic_sessions IS
  'One diagnostic pass over a company: which inputs were collected, what was produced (085).';
CREATE INDEX IF NOT EXISTS diagnostic_sessions_company_idx
  ON public.diagnostic_sessions (company_id, started_at DESC);
-- At most one in-flight session per company and kind (no double orchestration).
CREATE UNIQUE INDEX IF NOT EXISTS diagnostic_sessions_one_inflight
  ON public.diagnostic_sessions (company_id, kind)
  WHERE status IN ('collecting', 'processing');

DROP TRIGGER IF EXISTS diagnostic_sessions_updated_at ON public.diagnostic_sessions;
CREATE TRIGGER diagnostic_sessions_updated_at
  BEFORE UPDATE ON public.diagnostic_sessions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.diagnostics ADD COLUMN IF NOT EXISTS session_id UUID
  REFERENCES public.diagnostic_sessions(id) ON DELETE SET NULL;
ALTER TABLE public.documents ADD COLUMN IF NOT EXISTS session_id UUID
  REFERENCES public.diagnostic_sessions(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS diagnostics_session_idx ON public.diagnostics (session_id) WHERE session_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS documents_session_idx   ON public.documents (session_id)   WHERE session_id IS NOT NULL;

-- ─── Findings ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.diagnostic_findings (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id       TEXT        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  session_id       UUID        REFERENCES public.diagnostic_sessions(id) ON DELETE SET NULL,
  kind             TEXT        NOT NULL CHECK (kind IN
                     ('risk', 'gap', 'bottleneck', 'opportunity', 'strength', 'data_gap', 'anomaly', 'inconsistency')),
  area             TEXT        NOT NULL,      -- metric category key (lib/metrics/taxonomy.ts)
  title            TEXT        NOT NULL CHECK (length(title) BETWEEN 1 AND 300),
  body             TEXT,
  severity         TEXT        NOT NULL DEFAULT 'medium'
                   CHECK (severity IN ('critical', 'high', 'medium', 'low', 'info')),
  provenance_type  TEXT        NOT NULL CHECK (provenance_type IN
                     ('FACT', 'CALCULATED', 'INFERRED', 'AI_HYPOTHESIS', 'RECOMMENDATION')),
  confidence       NUMERIC(3,2) NOT NULL CHECK (confidence BETWEEN 0 AND 1),
  evidence         JSONB       NOT NULL DEFAULT '[]'::jsonb,  -- [{type, ref, field, value, quote}]
  produced_by      TEXT        NOT NULL,      -- 'engine:<name>' | 'agent:<key>' | 'staff:<uid>'
  agent_run_id     UUID,                      -- FK added in 086
  model            TEXT,
  prompt_version   TEXT,
  fingerprint      TEXT,                      -- stable key to supersede the same finding on re-run
  status           TEXT        NOT NULL DEFAULT 'active'
                   CHECK (status IN ('active', 'superseded', 'dismissed')),
  visible_to_client BOOLEAN    NOT NULL DEFAULT TRUE,
  reviewed_by      TEXT,
  reviewed_at      TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- An unreviewed model hypothesis is never shown to the client as fact.
  CONSTRAINT diagnostic_findings_ai_needs_review
    CHECK (provenance_type <> 'AI_HYPOTHESIS' OR visible_to_client = FALSE OR reviewed_at IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS diagnostic_findings_company_idx
  ON public.diagnostic_findings (company_id, status, severity);
CREATE INDEX IF NOT EXISTS diagnostic_findings_session_idx
  ON public.diagnostic_findings (session_id) WHERE session_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS diagnostic_findings_active_fingerprint
  ON public.diagnostic_findings (company_id, fingerprint)
  WHERE status = 'active' AND fingerprint IS NOT NULL;

DROP TRIGGER IF EXISTS diagnostic_findings_updated_at ON public.diagnostic_findings;
CREATE TRIGGER diagnostic_findings_updated_at
  BEFORE UPDATE ON public.diagnostic_findings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ─── Recommendations ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.diagnostic_recommendations (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id       TEXT        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  session_id       UUID        REFERENCES public.diagnostic_sessions(id) ON DELETE SET NULL,
  finding_ids      UUID[]      NOT NULL DEFAULT '{}',
  area             TEXT        NOT NULL,
  title            TEXT        NOT NULL CHECK (length(title) BETWEEN 1 AND 300),
  body             TEXT,
  expected_impact  TEXT,
  effort           TEXT        CHECK (effort IS NULL OR effort IN ('low', 'medium', 'high')),
  priority         SMALLINT    NOT NULL DEFAULT 3 CHECK (priority BETWEEN 1 AND 5),
  horizon_days     SMALLINT    CHECK (horizon_days IS NULL OR horizon_days IN (30, 90, 180, 365)),
  provenance_type  TEXT        NOT NULL DEFAULT 'RECOMMENDATION'
                   CHECK (provenance_type IN ('CALCULATED', 'INFERRED', 'AI_HYPOTHESIS', 'RECOMMENDATION')),
  confidence       NUMERIC(3,2) NOT NULL CHECK (confidence BETWEEN 0 AND 1),
  produced_by      TEXT        NOT NULL,
  agent_run_id     UUID,
  model            TEXT,
  prompt_version   TEXT,
  status           TEXT        NOT NULL DEFAULT 'proposed'
                   CHECK (status IN ('proposed', 'accepted', 'rejected', 'done', 'superseded')),
  visible_to_client BOOLEAN    NOT NULL DEFAULT FALSE,
  reviewed_by      TEXT,
  reviewed_at      TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS diagnostic_recommendations_company_idx
  ON public.diagnostic_recommendations (company_id, status, priority);

DROP TRIGGER IF EXISTS diagnostic_recommendations_updated_at ON public.diagnostic_recommendations;
CREATE TRIGGER diagnostic_recommendations_updated_at
  BEFORE UPDATE ON public.diagnostic_recommendations
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.action_items ADD COLUMN IF NOT EXISTS recommendation_id UUID
  REFERENCES public.diagnostic_recommendations(id) ON DELETE SET NULL;

-- ─── Metric history (append-only) and targets ──────────────────────────────
-- `metrics` keeps the latest value per key (upsert); every change is copied
-- here so trends, deltas and forecasts have real points.
CREATE TABLE IF NOT EXISTS public.metric_value_history (
  id              BIGINT      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  metric_id       UUID,
  company_id      TEXT        NOT NULL,
  metric_key      TEXT        NOT NULL,
  value           NUMERIC(20,4),
  unit            TEXT,
  source          TEXT,
  confidence      NUMERIC(3,2),
  period_year     INTEGER,
  period_quarter  TEXT,
  period_month    INTEGER,
  scenario        TEXT,
  provenance      JSONB,
  recorded_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS metric_value_history_series_idx
  ON public.metric_value_history (company_id, metric_key, recorded_at DESC);

CREATE OR REPLACE FUNCTION public.metrics_record_history()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND NEW.metric_value IS NOT DISTINCT FROM OLD.metric_value
     AND NEW.source IS NOT DISTINCT FROM OLD.source THEN
    RETURN NEW;
  END IF;
  INSERT INTO public.metric_value_history (
    metric_id, company_id, metric_key, value, unit, source, confidence,
    period_year, period_quarter, period_month, scenario, provenance
  ) VALUES (
    NEW.id, NEW.company_id::text, NEW.metric_key, NEW.metric_value, NEW.metric_unit, NEW.source,
    NEW.confidence, NEW.period_year, NEW.period_quarter, NEW.period_month, NEW.scenario, NEW.provenance
  );
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.metrics_record_history() FROM PUBLIC;

DROP TRIGGER IF EXISTS metrics_record_history ON public.metrics;
CREATE TRIGGER metrics_record_history
  AFTER INSERT OR UPDATE ON public.metrics
  FOR EACH ROW EXECUTE FUNCTION public.metrics_record_history();

-- Seed history with the current values once, so existing companies have a first point.
INSERT INTO public.metric_value_history (
  metric_id, company_id, metric_key, value, unit, source, confidence,
  period_year, period_quarter, period_month, scenario, provenance, recorded_at
)
SELECT m.id, m.company_id::text, m.metric_key, m.metric_value, m.metric_unit, m.source, m.confidence,
       m.period_year, m.period_quarter, m.period_month, m.scenario, m.provenance,
       coalesce(m.computed_at, m.recorded_at, now())
FROM public.metrics m
WHERE NOT EXISTS (SELECT 1 FROM public.metric_value_history h WHERE h.metric_id = m.id);

CREATE TABLE IF NOT EXISTS public.metric_targets (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      TEXT        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  metric_key      TEXT        NOT NULL,
  target_value    NUMERIC(20,4) NOT NULL,
  direction       TEXT        NOT NULL DEFAULT 'higher_is_better'
                  CHECK (direction IN ('higher_is_better', 'lower_is_better', 'range')),
  period_label    TEXT        NOT NULL DEFAULT '12m',  -- '12m' | '3y' | '2026-Q4' …
  source          TEXT        NOT NULL DEFAULT 'owner' CHECK (source IN ('owner', 'expert', 'agent', 'survey')),
  set_by          TEXT,
  note            TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company_id, metric_key, period_label)
);
DROP TRIGGER IF EXISTS metric_targets_updated_at ON public.metric_targets;
CREATE TRIGGER metric_targets_updated_at
  BEFORE UPDATE ON public.metric_targets
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ─── Versioned reports with provenance ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.report_versions (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id       TEXT        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  session_id       UUID        REFERENCES public.diagnostic_sessions(id) ON DELETE SET NULL,
  report_type      TEXT        NOT NULL CHECK (report_type IN ('point_a', 'full', 'gri', 'point_b')),
  version          INTEGER     NOT NULL,
  status           TEXT        NOT NULL DEFAULT 'draft'
                   CHECK (status IN ('draft', 'ready', 'published', 'superseded', 'failed')),
  title            TEXT        NOT NULL,
  content          JSONB       NOT NULL,      -- frozen snapshot rendered by the UI / PDF
  provenance       JSONB       NOT NULL,      -- {agent_key, run_ids, model, prompt_version, tools, sources, data_hash, generated_at}
  confidence       NUMERIC(3,2) CHECK (confidence IS NULL OR confidence BETWEEN 0 AND 1),
  data_hash        TEXT        NOT NULL,
  pdf_storage_path TEXT,
  created_by       TEXT        NOT NULL,
  published_by     TEXT,
  published_at     TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company_id, report_type, version)
);
CREATE INDEX IF NOT EXISTS report_versions_company_idx
  ON public.report_versions (company_id, report_type, version DESC);

CREATE OR REPLACE FUNCTION public.report_versions_assign_version()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.version IS NULL THEN
    PERFORM pg_advisory_xact_lock(hashtext('report_versions:' || NEW.company_id || ':' || NEW.report_type));
    SELECT coalesce(max(version), 0) + 1 INTO NEW.version
    FROM public.report_versions
    WHERE company_id = NEW.company_id AND report_type = NEW.report_type;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.report_versions_assign_version() FROM PUBLIC;

DROP TRIGGER IF EXISTS report_versions_assign_version ON public.report_versions;
CREATE TRIGGER report_versions_assign_version
  BEFORE INSERT ON public.report_versions
  FOR EACH ROW EXECUTE FUNCTION public.report_versions_assign_version();

DROP TRIGGER IF EXISTS report_versions_updated_at ON public.report_versions;
CREATE TRIGGER report_versions_updated_at
  BEFORE UPDATE ON public.report_versions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ─── RLS: read by tenant, write by service role only ────────────────────────
DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'diagnostic_sessions', 'diagnostic_findings', 'diagnostic_recommendations',
    'metric_value_history', 'metric_targets', 'report_versions'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE INSERT, UPDATE, DELETE ON public.%I FROM anon, authenticated', t);
  END LOOP;
END $$;

DROP POLICY IF EXISTS diagnostic_sessions_select ON public.diagnostic_sessions;
CREATE POLICY diagnostic_sessions_select ON public.diagnostic_sessions FOR SELECT
  USING (public.can_read_company(company_id));

-- Clients see reviewed/visible items; staff and partner consultants see all.
DROP POLICY IF EXISTS diagnostic_findings_select ON public.diagnostic_findings;
CREATE POLICY diagnostic_findings_select ON public.diagnostic_findings FOR SELECT USING (
  public.can_read_company(company_id)
  AND (visible_to_client OR public.is_platform_staff() OR public.partner_role_for_company(company_id) IS NOT NULL)
);

DROP POLICY IF EXISTS diagnostic_recommendations_select ON public.diagnostic_recommendations;
CREATE POLICY diagnostic_recommendations_select ON public.diagnostic_recommendations FOR SELECT USING (
  public.can_read_company(company_id)
  AND (visible_to_client OR public.is_platform_staff() OR public.partner_role_for_company(company_id) IS NOT NULL)
);

DROP POLICY IF EXISTS metric_value_history_select ON public.metric_value_history;
CREATE POLICY metric_value_history_select ON public.metric_value_history FOR SELECT
  USING (public.can_read_company(company_id));

DROP POLICY IF EXISTS metric_targets_select ON public.metric_targets;
CREATE POLICY metric_targets_select ON public.metric_targets FOR SELECT
  USING (public.can_read_company(company_id));

DROP POLICY IF EXISTS report_versions_select ON public.report_versions;
CREATE POLICY report_versions_select ON public.report_versions FOR SELECT USING (
  public.can_read_company(company_id)
  AND (status = 'published' OR public.is_platform_staff() OR public.partner_role_for_company(company_id) IS NOT NULL)
);

NOTIFY pgrst, 'reload schema';
