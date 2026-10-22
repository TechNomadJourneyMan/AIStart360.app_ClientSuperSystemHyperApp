-- 132_point_b_checkpoints_runs.sql
--
-- Point B, phase 6b (recompute on a schedule, plan-fact, monthly reconciliation;
-- docs/superpowers/specs/2026-10-18-point-b-design.md §13, §14, §16;
-- plan docs/superpowers/plans/2026-10-22-point-b-phase6b-recompute-planfact.md, task 1):
--
--   pb_checkpoints    plan-fact of an APPROVED plan version by month: planned (from the version's
--                     trajectory), actual (the facts of the month), forecast (the current pace), the
--                     verdict per KPI and the overall one (on_track / risk / behind / no_data) with
--                     its reason («конверсия 11% при плане 13%»). One row per (version, month): the
--                     recompute rewrites it. inputs_hash = what the row was calculated from; an
--                     unchanged hash lets the scheduled recompute skip the company.
--   pb_runs           the journal of the recompute: scheduled (cron) or manual (the button of an
--                     expert / admin), how many companies, AI calls, cost, errors. A manual run of
--                     one company keeps its company_id (the «once in 10 minutes» check of the button).
--   pb_monthly_facts  «Факт за месяц» of the monthly reconciliation: the key KPIs of the plan
--                     (revenue, leads, conversion, average check, cash) the owner or an expert typed
--                     for a month. A separate table on purpose: public.metric_overrides would make a
--                     MONTHLY revenue the current ANNUAL revenue of Point A (the resolver takes the
--                     newest period of a manual source) and would outrank the questionnaire. Units:
--                     revenue / average check / cash in KZT, leads per month, conversion in percent.
--
-- triggered_by / entered_by carry NO foreign keys (like the authors of pb_plan_versions in 125): the
-- deletion of a staff account must not touch the journal.
--
-- RLS: written by the server only (service role). A signed-in client may SELECT the checkpoints and
-- the monthly facts of the companies he may read (can_read_company, migration 084); the run journal
-- is staff-only (service role). No INSERT / UPDATE grants to authenticated or anon.
--
-- Idempotent. NOT applied to production by the author of this file: apply with
-- node scripts/apply-migration.js supabase/migrations/132_point_b_checkpoints_runs.sql
-- at the push to main (the product owner's go-ahead is given for Point B migrations).

-- ─── 1. Checkpoints ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.pb_checkpoints (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    TEXT        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  plan_id       UUID        NOT NULL REFERENCES public.pb_plans(id) ON DELETE CASCADE,
  version_id    UUID        NOT NULL REFERENCES public.pb_plan_versions(id) ON DELETE CASCADE,
  period        TEXT        NOT NULL CHECK (period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  planned       JSONB       NOT NULL DEFAULT '{}'::jsonb
                CHECK (jsonb_typeof(planned) = 'object' AND pg_column_size(planned) <= 16384),
  actual        JSONB       NOT NULL DEFAULT '{}'::jsonb
                CHECK (jsonb_typeof(actual) = 'object' AND pg_column_size(actual) <= 16384),
  forecast      JSONB       NOT NULL DEFAULT '{}'::jsonb
                CHECK (jsonb_typeof(forecast) = 'object' AND pg_column_size(forecast) <= 16384),
  verdict       JSONB       NOT NULL DEFAULT '{}'::jsonb
                CHECK (jsonb_typeof(verdict) = 'object' AND pg_column_size(verdict) <= 16384),
  overall       TEXT        NOT NULL DEFAULT 'no_data'
                CHECK (overall IN ('on_track', 'risk', 'behind', 'no_data')),
  reason        TEXT        CHECK (reason IS NULL OR length(reason) <= 1000),
  inputs_hash   TEXT        CHECK (inputs_hash IS NULL OR length(inputs_hash) <= 128),
  computed_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT pb_checkpoints_version_period_uniq UNIQUE (version_id, period)
);

-- The page of a company: its checkpoints, newest month first.
CREATE INDEX IF NOT EXISTS pb_checkpoints_company_idx
  ON public.pb_checkpoints (company_id, period DESC);

DROP TRIGGER IF EXISTS pb_checkpoints_updated_at ON public.pb_checkpoints;
CREATE TRIGGER pb_checkpoints_updated_at
  BEFORE UPDATE ON public.pb_checkpoints
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ─── 2. Recompute journal ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.pb_runs (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  kind          TEXT        NOT NULL CHECK (kind IN ('scheduled', 'manual')),
  status        TEXT        NOT NULL DEFAULT 'running'
                CHECK (status IN ('running', 'done', 'failed')),
  company_id    TEXT        REFERENCES public.companies(id) ON DELETE SET NULL,
  triggered_by  UUID,
  started_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at   TIMESTAMPTZ,
  companies     INT         NOT NULL DEFAULT 0 CHECK (companies >= 0),
  skipped       INT         NOT NULL DEFAULT 0 CHECK (skipped >= 0),
  ai_calls      INT         NOT NULL DEFAULT 0 CHECK (ai_calls >= 0),
  cost          NUMERIC(12,4) NOT NULL DEFAULT 0 CHECK (cost >= 0),
  errors        JSONB       NOT NULL DEFAULT '[]'::jsonb
                CHECK (jsonb_typeof(errors) = 'array' AND pg_column_size(errors) <= 65536),
  cursor        TEXT        CHECK (cursor IS NULL OR length(cursor) <= 200)
);

-- The latest runs (GIGA) and the «once in 10 minutes per company» check of the button.
CREATE INDEX IF NOT EXISTS pb_runs_started_idx
  ON public.pb_runs (started_at DESC);
CREATE INDEX IF NOT EXISTS pb_runs_company_idx
  ON public.pb_runs (company_id, started_at DESC);

-- ─── 3. Monthly facts of the reconciliation ─────────────────────────────────
CREATE TABLE IF NOT EXISTS public.pb_monthly_facts (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    TEXT        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  period        TEXT        NOT NULL CHECK (period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  metric        TEXT        NOT NULL CHECK (metric IN ('revenue', 'leads', 'conversion', 'avg_check', 'cash')),
  value         NUMERIC(24,6) NOT NULL,
  source        TEXT        NOT NULL DEFAULT 'monthly_reconciliation'
                CHECK (source = 'monthly_reconciliation'),
  entered_by    UUID,
  entered_role  TEXT        NOT NULL CHECK (entered_role IN ('owner', 'expert')),
  note          TEXT        CHECK (note IS NULL OR length(note) <= 500),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT pb_monthly_facts_uniq UNIQUE (company_id, period, metric)
);

-- «Кто не прошёл сверку за месяц» (the expert's list) reads by month.
CREATE INDEX IF NOT EXISTS pb_monthly_facts_period_idx
  ON public.pb_monthly_facts (period, company_id);

DROP TRIGGER IF EXISTS pb_monthly_facts_updated_at ON public.pb_monthly_facts;
CREATE TRIGGER pb_monthly_facts_updated_at
  BEFORE UPDATE ON public.pb_monthly_facts
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ─── 4. RLS ─────────────────────────────────────────────────────────────────
ALTER TABLE public.pb_checkpoints ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pb_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pb_monthly_facts ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.pb_checkpoints, public.pb_runs, public.pb_monthly_facts FROM PUBLIC, anon;
REVOKE ALL ON public.pb_runs FROM authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON public.pb_checkpoints, public.pb_monthly_facts FROM authenticated;
GRANT SELECT ON public.pb_checkpoints, public.pb_monthly_facts TO authenticated;
GRANT ALL ON public.pb_checkpoints, public.pb_runs, public.pb_monthly_facts TO service_role;

-- The client reads the plan-fact and the monthly facts of the companies he may read.
DROP POLICY IF EXISTS pb_checkpoints_client_read ON public.pb_checkpoints;
CREATE POLICY pb_checkpoints_client_read ON public.pb_checkpoints FOR SELECT TO authenticated
  USING (public.can_read_company(company_id));

DROP POLICY IF EXISTS pb_monthly_facts_client_read ON public.pb_monthly_facts;
CREATE POLICY pb_monthly_facts_client_read ON public.pb_monthly_facts FOR SELECT TO authenticated
  USING (public.can_read_company(company_id));

NOTIFY pgrst, 'reload schema';
