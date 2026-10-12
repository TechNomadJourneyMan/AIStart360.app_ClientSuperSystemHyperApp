-- 111_point_a_engine.sql
--
-- Point A, phase 2 (docs/superpowers/specs/2026-10-12-point-a-full-design.md §2)
-- and the review fixes of the data layer (110):
--
--   metric_overrides.basis_signature  what a manual value was decided against;
--                                     new data of the period reopens it
--   replace_metric_facts()            facts of a company replaced atomically,
--                                     serialised per company
--   pa_templates, pa_company_config   the block constructor
--   point_a_snapshots                 every recalculation with its inputs and
--                                     change reasons (v1 kept as shadow)
--   point_a_recalc_queue              event-driven recalculation, debounced
--
-- Idempotent. Apply: node scripts/apply-migration.js supabase/migrations/111_point_a_engine.sql

-- ─── Data layer fixes ───────────────────────────────────────────────────────
ALTER TABLE public.metric_overrides ADD COLUMN IF NOT EXISTS basis_signature TEXT;

CREATE OR REPLACE FUNCTION public.replace_metric_facts(p_company_id TEXT, p_rows JSONB)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  n INTEGER;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('metric_facts:' || p_company_id));
  DELETE FROM public.metric_facts WHERE company_id = p_company_id;
  INSERT INTO public.metric_facts (
    company_id, metric_key, period_key, period_year, period_quarter, period_month, value, unit,
    source_kind, source_ref, source_refs, confidence, flags, is_current, observed_at, note, computed_at
  )
  SELECT p_company_id, r.metric_key, r.period_key, r.period_year, r.period_quarter, r.period_month, r.value, r.unit,
         r.source_kind, r.source_ref, COALESCE(r.source_refs, '{}'), COALESCE(r.confidence, 0), COALESCE(r.flags, '{}'),
         COALESCE(r.is_current, false), r.observed_at, r.note, COALESCE(r.computed_at, now())
  FROM jsonb_to_recordset(COALESCE(p_rows, '[]'::jsonb)) AS r(
    metric_key TEXT, period_key TEXT, period_year INT, period_quarter SMALLINT, period_month SMALLINT,
    value NUMERIC, unit TEXT, source_kind TEXT, source_ref TEXT, source_refs TEXT[], confidence NUMERIC,
    flags TEXT[], is_current BOOLEAN, observed_at TIMESTAMPTZ, note TEXT, computed_at TIMESTAMPTZ
  );
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;
REVOKE ALL ON FUNCTION public.replace_metric_facts(TEXT, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.replace_metric_facts(TEXT, JSONB) TO service_role;

-- ─── Block constructor (spec §2.2) ──────────────────────────────────────────
-- Templates: blocks and weights per industry (admin). The code copies in
-- lib/point-a/v4/config.ts are the fallback; these rows are the seed.
CREATE TABLE IF NOT EXISTS public.pa_templates (
  key         TEXT        PRIMARY KEY,
  title       TEXT        NOT NULL,
  industries  TEXT[]      NOT NULL DEFAULT '{}',
  blocks      JSONB       NOT NULL,              -- [{key, weight, enabled}]
  version     INT         NOT NULL DEFAULT 1,
  updated_by  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO public.pa_templates (key, title, industries, blocks, version) VALUES
  ('default', 'Универсальный', '{}'::text[], '[{"key": "finance", "weight": 0.25, "enabled": true}, {"key": "sales", "weight": 0.2, "enabled": true}, {"key": "operations", "weight": 0.15, "enabled": true}, {"key": "marketing", "weight": 0.12, "enabled": true}, {"key": "strategy", "weight": 0.1, "enabled": true}, {"key": "team", "weight": 0.1, "enabled": true}, {"key": "product", "weight": 0.08, "enabled": true}]'::jsonb, 1),
  ('ecommerce', 'E-commerce и розница', ARRAY['e-commerce','ecommerce','интернет','маркетплейс','розниц','ритейл','retail']::text[], '[{"key": "finance", "weight": 0.22, "enabled": true}, {"key": "sales", "weight": 0.18, "enabled": true}, {"key": "operations", "weight": 0.12, "enabled": true}, {"key": "marketing", "weight": 0.2, "enabled": true}, {"key": "strategy", "weight": 0.08, "enabled": true}, {"key": "team", "weight": 0.06, "enabled": true}, {"key": "product", "weight": 0.14, "enabled": true}]'::jsonb, 1),
  ('services', 'Услуги и B2B', ARRAY['услуг','консалт','b2b','агентств','сервис','it','образован']::text[], '[{"key": "finance", "weight": 0.22, "enabled": true}, {"key": "sales", "weight": 0.24, "enabled": true}, {"key": "operations", "weight": 0.12, "enabled": true}, {"key": "marketing", "weight": 0.12, "enabled": true}, {"key": "strategy", "weight": 0.1, "enabled": true}, {"key": "team", "weight": 0.14, "enabled": true}, {"key": "product", "weight": 0.06, "enabled": true}]'::jsonb, 1),
  ('production', 'Производство', ARRAY['производ','завод','промышлен','строител','manufactur']::text[], '[{"key": "finance", "weight": 0.28, "enabled": true}, {"key": "sales", "weight": 0.16, "enabled": true}, {"key": "operations", "weight": 0.22, "enabled": true}, {"key": "marketing", "weight": 0.08, "enabled": true}, {"key": "strategy", "weight": 0.1, "enabled": true}, {"key": "team", "weight": 0.1, "enabled": true}, {"key": "product", "weight": 0.06, "enabled": true}]'::jsonb, 1)
ON CONFLICT (key) DO NOTHING;

-- Per company: the template, the expert's overrides and the client's view.
CREATE TABLE IF NOT EXISTS public.pa_company_config (
  company_id        TEXT        PRIMARY KEY REFERENCES public.companies(id) ON DELETE CASCADE,
  template_key      TEXT        REFERENCES public.pa_templates(key) ON DELETE SET NULL,
  expert_overrides  JSONB       NOT NULL DEFAULT '{}'::jsonb,   -- {block: {weight?, enabled?}}
  client_view       JSONB       NOT NULL DEFAULT '{}'::jsonb,   -- {hidden: [], order: [], added: []}
  version           INT         NOT NULL DEFAULT 1,
  updated_by        TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─── Snapshots (spec §2.5) ──────────────────────────────────────────────────
-- Every recalculation of Point A: the v4 result, the v1 result (shadow /
-- written), the inputs it rests on and what changed since the previous one.
CREATE TABLE IF NOT EXISTS public.point_a_snapshots (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      TEXT        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  diagnostic_id   UUID        REFERENCES public.diagnostics(id) ON DELETE SET NULL,
  engine          TEXT        NOT NULL CHECK (engine IN ('v1', 'v4')),   -- which one public.diagnostics shows
  trigger         TEXT        NOT NULL DEFAULT 'event' CHECK (trigger IN ('event', 'manual', 'schedule', 'expert')),
  reasons         TEXT[]      NOT NULL DEFAULT '{}',                      -- events that caused it
  overall         NUMERIC(5,2),
  confidence      NUMERIC(4,3),
  coverage        NUMERIC(4,3),
  stage           TEXT,
  blocks          JSONB       NOT NULL DEFAULT '[]'::jsonb,                -- v4 blocks
  v4              JSONB       NOT NULL DEFAULT '{}'::jsonb,                -- strengths, upload checklist …
  v1_overall      NUMERIC(5,2),
  v1_blocks       JSONB,
  inputs          JSONB       NOT NULL DEFAULT '{}'::jsonb,
  inputs_hash     TEXT        NOT NULL,
  config_version  TEXT        NOT NULL,
  change_reasons  JSONB       NOT NULL DEFAULT '[]'::jsonb,
  reviewed_by     TEXT,
  reviewed_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS point_a_snapshots_company_idx ON public.point_a_snapshots (company_id, created_at DESC);

-- ─── Recalculation queue (spec §2.4) ────────────────────────────────────────
-- One row per company; due_at slides with every new event (debounce);
-- started_at claims it (one recalculation per company at a time).
CREATE TABLE IF NOT EXISTS public.point_a_recalc_queue (
  company_id    TEXT        PRIMARY KEY REFERENCES public.companies(id) ON DELETE CASCADE,
  reasons       TEXT[]      NOT NULL DEFAULT '{}',
  requested_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  due_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at    TIMESTAMPTZ,
  attempts      INT         NOT NULL DEFAULT 0,
  last_error    TEXT
);
CREATE INDEX IF NOT EXISTS point_a_recalc_queue_due_idx ON public.point_a_recalc_queue (due_at);

DROP TRIGGER IF EXISTS pa_templates_updated_at ON public.pa_templates;
CREATE TRIGGER pa_templates_updated_at BEFORE UPDATE ON public.pa_templates
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
DROP TRIGGER IF EXISTS pa_company_config_updated_at ON public.pa_company_config;
CREATE TRIGGER pa_company_config_updated_at BEFORE UPDATE ON public.pa_company_config
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ─── RLS: read by tenant (templates: any signed-in user), write by service role
DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['pa_templates', 'pa_company_config', 'point_a_snapshots', 'point_a_recalc_queue'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE INSERT, UPDATE, DELETE ON public.%I FROM anon, authenticated', t);
  END LOOP;
END $$;

DROP POLICY IF EXISTS pa_templates_select ON public.pa_templates;
CREATE POLICY pa_templates_select ON public.pa_templates FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS pa_company_config_select ON public.pa_company_config;
CREATE POLICY pa_company_config_select ON public.pa_company_config FOR SELECT
  USING (public.can_read_company(company_id));
DROP POLICY IF EXISTS point_a_snapshots_select ON public.point_a_snapshots;
CREATE POLICY point_a_snapshots_select ON public.point_a_snapshots FOR SELECT
  USING (public.can_read_company(company_id));
-- point_a_recalc_queue: no SELECT policy — service role only.

NOTIFY pgrst, 'reload schema';
