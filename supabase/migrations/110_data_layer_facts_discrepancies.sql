-- 110_data_layer_facts_discrepancies.sql
--
-- Period-aware data layer of Point A
-- (docs/superpowers/specs/2026-10-12-point-a-full-design.md §1):
--
--   metric_facts        every observation of a metric: value × period × source.
--                       Rebuilt by every metrics materialisation
--                       (lib/data-layer/sync.ts). public.metrics keeps ONE
--                       current value per metric, as before.
--   data_discrepancies  values of one period that disagree between sources,
--                       values outside the plausible range, anomalies.
--   metric_overrides    a value the owner / an expert set for one period of a
--                       metric (resolution of a discrepancy, manual correction);
--                       the highest-priority source of that period.
--
-- Company-scoped, readable via public.can_read_company() (084), written only by
-- the service role (API routes authorise the tenant first).
--
-- Idempotent. Apply: node scripts/apply-migration.js supabase/migrations/110_data_layer_facts_discrepancies.sql

-- ─── Facts ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.metric_facts (
  id             BIGINT      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  company_id     TEXT        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  metric_key     TEXT        NOT NULL,
  period_key     TEXT        NOT NULL,              -- '2024' | '2024-Q2' | '2024-03' | '2026-YTD' | 'unknown'
  period_year    INT,
  period_quarter SMALLINT    CHECK (period_quarter IS NULL OR period_quarter BETWEEN 1 AND 4),
  period_month   SMALLINT    CHECK (period_month IS NULL OR period_month BETWEEN 1 AND 12),
  value          NUMERIC(24,6) NOT NULL,
  unit           TEXT,
  source_kind    TEXT        NOT NULL CHECK (source_kind IN ('survey', 'document', 'manual', 'integration', 'assessment')),
  source_ref     TEXT        NOT NULL,
  source_refs    TEXT[]      NOT NULL DEFAULT '{}',
  confidence     NUMERIC(4,3) NOT NULL DEFAULT 0 CHECK (confidence BETWEEN 0 AND 1),
  flags          TEXT[]      NOT NULL DEFAULT '{}',
  is_current     BOOLEAN     NOT NULL DEFAULT false, -- survey answer about the current situation
  observed_at    TIMESTAMPTZ,
  note           TEXT,
  computed_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.metric_facts IS
  'Every observation of a metric by period and source; rebuilt on materialisation (110).';
CREATE INDEX IF NOT EXISTS metric_facts_company_metric_idx
  ON public.metric_facts (company_id, metric_key, period_key);

-- ─── Discrepancies ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.data_discrepancies (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id       TEXT        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  metric_key       TEXT        NOT NULL,
  period_key       TEXT        NOT NULL,
  kind             TEXT        NOT NULL CHECK (kind IN ('conflict', 'invalid', 'anomaly', 'missing_period')),
  candidates       JSONB       NOT NULL DEFAULT '[]'::jsonb,  -- [{value, unit, sourceKind, sourceRef, confidence, note?}]
  chosen_value     NUMERIC(24,6),                            -- the value in use until resolved
  detail           TEXT,
  status           TEXT        NOT NULL DEFAULT 'open'
                   CHECK (status IN ('open', 'resolved_user', 'resolved_expert', 'ignored', 'auto_resolved')),
  resolved_by      TEXT,
  resolution_value NUMERIC(24,6),
  resolution_note  TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at      TIMESTAMPTZ
);
COMMENT ON TABLE public.data_discrepancies IS
  'Disagreeing / implausible / anomalous metric values found by lib/data-layer/reconcile.ts (110).';
CREATE UNIQUE INDEX IF NOT EXISTS data_discrepancies_one_open
  ON public.data_discrepancies (company_id, metric_key, period_key, kind) WHERE status = 'open';
CREATE INDEX IF NOT EXISTS data_discrepancies_company_idx
  ON public.data_discrepancies (company_id, status, created_at DESC);

-- ─── Period overrides ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.metric_overrides (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      TEXT        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  metric_key      TEXT        NOT NULL,
  period_key      TEXT        NOT NULL,
  value           NUMERIC(24,6) NOT NULL,
  note            TEXT,
  set_by          TEXT,                                -- auth uid of the owner / expert
  discrepancy_id  UUID        REFERENCES public.data_discrepancies(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company_id, metric_key, period_key)
);
COMMENT ON TABLE public.metric_overrides IS
  'Value of one period of a metric set by the owner / an expert; highest priority in that period (110).';

-- ─── updated_at triggers ────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS data_discrepancies_updated_at ON public.data_discrepancies;
CREATE TRIGGER data_discrepancies_updated_at
  BEFORE UPDATE ON public.data_discrepancies
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
DROP TRIGGER IF EXISTS metric_overrides_updated_at ON public.metric_overrides;
CREATE TRIGGER metric_overrides_updated_at
  BEFORE UPDATE ON public.metric_overrides
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ─── RLS: read by tenant, write by service role only ────────────────────────
DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['metric_facts', 'data_discrepancies', 'metric_overrides'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE INSERT, UPDATE, DELETE ON public.%I FROM anon, authenticated', t);
  END LOOP;
END $$;

DROP POLICY IF EXISTS metric_facts_select ON public.metric_facts;
CREATE POLICY metric_facts_select ON public.metric_facts FOR SELECT
  USING (public.can_read_company(company_id));

DROP POLICY IF EXISTS data_discrepancies_select ON public.data_discrepancies;
CREATE POLICY data_discrepancies_select ON public.data_discrepancies FOR SELECT
  USING (public.can_read_company(company_id));

DROP POLICY IF EXISTS metric_overrides_select ON public.metric_overrides;
CREATE POLICY metric_overrides_select ON public.metric_overrides FOR SELECT
  USING (public.can_read_company(company_id));

NOTIFY pgrst, 'reload schema';
