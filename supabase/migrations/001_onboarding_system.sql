-- =============================================================================
-- AIStart360 — Client Portal Onboarding System
-- Migration: 001_onboarding_system.sql
-- Covers: Modules 1–5 (Waiting Room, Wizard, Documents, Point A Engine, Dashboard)
-- =============================================================================

-- -----------------------------------------------------------------------------
-- EXTENSIONS
-- -----------------------------------------------------------------------------

CREATE EXTENSION IF NOT EXISTS "pgcrypto";   -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";  -- uuid_generate_v4()


-- =============================================================================
-- MODULE 1 — WAITING ROOM / APPROVAL GATE
-- =============================================================================

-- Add status columns to existing users table (Supabase auth.users extended via profiles)
-- If you use a custom `users` table (not auth.users), alter it directly.

CREATE TABLE IF NOT EXISTS public.profiles (
  id            UUID        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email         TEXT        NOT NULL,
  full_name     TEXT,
  role          TEXT        NOT NULL DEFAULT 'client'
                            CHECK (role IN ('super_admin', 'admin', 'manager', 'analyst', 'client', 'expert', 'owner')),
  status        TEXT        NOT NULL DEFAULT 'pending_approval'
                            CHECK (status IN ('pending_approval', 'approved', 'rejected', 'requires_clarification')),
  approved_at   TIMESTAMPTZ,
  approved_by   UUID        REFERENCES public.profiles(id),
  avatar_url    TEXT,
  organization  TEXT,
  position      TEXT,
  phone         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.profiles IS 'Extended user profile linked to Supabase Auth. Manages approval status for the client portal.';
COMMENT ON COLUMN public.profiles.status IS 'pending_approval → requires_clarification → approved | rejected';

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profiles_updated_at ON public.profiles;
CREATE TRIGGER profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Auto-create profile when a new user registers via Supabase Auth
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name, role, status)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email),
    COALESCE(NEW.raw_user_meta_data->>'role', 'client'),
    'pending_approval'
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();


-- =============================================================================
-- MODULE 2 — COMPANIES TABLE
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.companies (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  name            TEXT        NOT NULL,
  industry        TEXT,
  stage           TEXT        CHECK (stage IN ('Startup', 'Growth', 'Scale', 'Mature')),
  employee_count  INTEGER,
  founded_at      DATE,
  business_model  TEXT        CHECK (business_model IN ('B2B', 'B2C', 'B2B2C', 'Mixed')),
  regions         TEXT[]      DEFAULT '{}',
  contact_name    TEXT,
  contact_position TEXT,
  contact_phone   TEXT,
  contact_email   TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.companies IS 'Company profile created during onboarding wizard Step 1.';

DROP TRIGGER IF EXISTS companies_updated_at ON public.companies;
CREATE TRIGGER companies_updated_at
  BEFORE UPDATE ON public.companies
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


-- =============================================================================
-- MODULE 2 — SURVEY ANSWERS (Onboarding Wizard Steps 1–6)
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.survey_answers (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  company_id    UUID        REFERENCES public.companies(id) ON DELETE SET NULL,
  step          INTEGER     NOT NULL CHECK (step BETWEEN 1 AND 6),
  question_key  TEXT        NOT NULL,
  answer        JSONB       NOT NULL,
  answered_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, question_key)
);

COMMENT ON TABLE public.survey_answers IS 'Stores all onboarding questionnaire answers. One row per user+question_key. JSONB answer supports all data types.';
COMMENT ON COLUMN public.survey_answers.question_key IS 'e.g. "company_name", "revenue_2024", "has_crm". Namespaced by step: "s1_company_name".';
COMMENT ON COLUMN public.survey_answers.answer IS 'JSONB: {"value": "ТОО Almas"} or {"value": 84000000} or {"value": ["Instagram","Google"]}';

CREATE INDEX IF NOT EXISTS survey_answers_user_id_idx   ON public.survey_answers(user_id);
CREATE INDEX IF NOT EXISTS survey_answers_step_idx      ON public.survey_answers(user_id, step);


-- =============================================================================
-- MODULE 3 — DOCUMENTS (File Upload System)
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.documents (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  company_id      UUID        REFERENCES public.companies(id) ON DELETE SET NULL,
  file_name       TEXT        NOT NULL,
  file_url        TEXT        NOT NULL,
  file_size       INTEGER,                 -- bytes
  mime_type       TEXT,
  doc_type        TEXT        NOT NULL
                              CHECK (doc_type IN (
                                'pl_report',       -- P&L
                                'balance_sheet',   -- Баланс
                                'marketing_report',-- Маркетинговый отчёт
                                'ops_report',      -- Операционный отчёт
                                'crm_export',      -- CRM-выгрузка
                                'audit',           -- Аудит
                                'other'            -- Другое
                              )),
  period_quarter  TEXT        CHECK (period_quarter IN ('Q1','Q2','Q3','Q4')),
  period_year     INTEGER     CHECK (period_year BETWEEN 2020 AND 2030),
  parse_status    TEXT        NOT NULL DEFAULT 'queued'
                              CHECK (parse_status IN ('queued','processing','parsed','error')),
  parsed_data     JSONB,      -- Extracted metrics from n8n/AI parsing
  parse_error     TEXT,       -- Error message if parse_status = 'error'
  n8n_execution_id TEXT,      -- n8n workflow execution ID for tracking
  uploaded_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.documents IS 'Uploaded business documents (PDF, XLSX, etc). Triggers n8n parsing workflow after upload.';
COMMENT ON COLUMN public.documents.parsed_data IS 'Structured metrics extracted by n8n AI: {"revenue": 84000000, "gross_margin": 34.2, ...}';

CREATE INDEX IF NOT EXISTS documents_user_id_idx      ON public.documents(user_id);
CREATE INDEX IF NOT EXISTS documents_parse_status_idx ON public.documents(parse_status);
CREATE INDEX IF NOT EXISTS documents_doc_type_idx     ON public.documents(doc_type);


-- =============================================================================
-- MODULE 4 — METRICS TABLE (Extracted & Calculated)
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.metrics (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    UUID        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  metric_key    TEXT        NOT NULL,  -- e.g. "revenue", "cac", "ltv", "gross_margin"
  metric_value  DECIMAL(15,4),
  metric_unit   TEXT,                  -- "KZT", "%", "days", "count"
  period_year   INTEGER,
  period_quarter TEXT       CHECK (period_quarter IN ('Q1','Q2','Q3','Q4')),
  source        TEXT        NOT NULL DEFAULT 'survey'
                            CHECK (source IN ('survey','document','manual','calculated')),
  recorded_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.metrics IS 'Normalized metric values from surveys and parsed documents. Used by Point A calculation engine.';

CREATE INDEX IF NOT EXISTS metrics_company_id_idx    ON public.metrics(company_id);
CREATE INDEX IF NOT EXISTS metrics_key_period_idx    ON public.metrics(company_id, metric_key, period_year);

-- Prevent duplicate metric entries per source period
CREATE UNIQUE INDEX IF NOT EXISTS metrics_unique_idx
  ON public.metrics(company_id, metric_key, period_year, period_quarter, source);


-- =============================================================================
-- MODULE 4 — DIAGNOSTICS TABLE (Point A Results)
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.diagnostics (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  company_id        UUID        REFERENCES public.companies(id) ON DELETE SET NULL,
  version           INTEGER     NOT NULL DEFAULT 1,

  -- Top-level scores
  overall_score     DECIMAL(5,2),         -- 0–100
  health_index      DECIMAL(5,2),         -- 0–100
  stage             TEXT        CHECK (stage IN ('seed','early','growth','scale','mature')),

  -- Block scores (JSONB for full BlockScore object)
  finance_score     JSONB,
  -- Example: {"score": 58, "status": "average", "top_issues": ["No breakeven calc", "High debt"]}
  marketing_score   JSONB,
  operations_score  JSONB,
  strategy_score    JSONB,
  sales_score       JSONB,

  -- Derived outputs
  risks             JSONB,    -- Risk[]
  -- Example: [{"level":"critical","area":"sales","text":"No CRM → ~30% lead loss","impact":"high"}]
  insights          JSONB,    -- Insight[]
  quick_wins        JSONB,    -- QuickWin[]
  data_gaps         JSONB,    -- DataGap[] — missing data flags

  -- Meta
  is_current        BOOLEAN     NOT NULL DEFAULT TRUE,
  calculated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.diagnostics IS 'Point A diagnostic result. Versioned — new record on recalculation, previous set is_current=false.';
COMMENT ON COLUMN public.diagnostics.overall_score IS 'Weighted composite: Finance 30% + Sales 25% + Ops 20% + Marketing 15% + Strategy 10%';

CREATE INDEX IF NOT EXISTS diagnostics_user_current_idx ON public.diagnostics(user_id, is_current);
CREATE INDEX IF NOT EXISTS diagnostics_company_idx      ON public.diagnostics(company_id, is_current);

-- When a new diagnostic is inserted, mark all previous versions as not current
CREATE OR REPLACE FUNCTION public.set_diagnostic_version()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  -- Deactivate previous versions for this user+company
  UPDATE public.diagnostics
  SET    is_current = FALSE
  WHERE  user_id    = NEW.user_id
    AND  company_id = NEW.company_id
    AND  id        != NEW.id;

  -- Set version number
  SELECT COALESCE(MAX(version), 0) + 1
  INTO   NEW.version
  FROM   public.diagnostics
  WHERE  user_id    = NEW.user_id
    AND  company_id = NEW.company_id
    AND  id        != NEW.id;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS diagnostics_versioning ON public.diagnostics;
CREATE TRIGGER diagnostics_versioning
  BEFORE INSERT ON public.diagnostics
  FOR EACH ROW EXECUTE FUNCTION public.set_diagnostic_version();


-- =============================================================================
-- ROW LEVEL SECURITY (RLS)
-- =============================================================================

-- PROFILES --
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- Users can read/update their own profile
CREATE POLICY "profiles_select_own" ON public.profiles
  FOR SELECT USING (id = auth.uid());

CREATE POLICY "profiles_update_own" ON public.profiles
  FOR UPDATE USING (id = auth.uid())
  WITH CHECK (
    -- Users cannot change their own role or status
    role   = (SELECT role   FROM public.profiles WHERE id = auth.uid()) AND
    status = (SELECT status FROM public.profiles WHERE id = auth.uid())
  );

-- Admins/managers can read all profiles
CREATE POLICY "profiles_admin_select" ON public.profiles
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid()
        AND role IN ('super_admin', 'admin', 'manager')
    )
  );

-- Admins can update any profile (for approval/rejection)
CREATE POLICY "profiles_admin_update" ON public.profiles
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid()
        AND role IN ('super_admin', 'admin')
    )
  );

-- Service role bypass (used by API routes with supabaseAdmin)
-- Service role key bypasses RLS automatically — no additional policy needed.


-- COMPANIES --
ALTER TABLE public.companies ENABLE ROW LEVEL SECURITY;

CREATE POLICY "companies_select_own" ON public.companies
  FOR SELECT USING (user_id = auth.uid());

CREATE POLICY "companies_insert_own" ON public.companies
  FOR INSERT WITH CHECK (user_id = auth.uid());

CREATE POLICY "companies_update_own" ON public.companies
  FOR UPDATE USING (user_id = auth.uid());

CREATE POLICY "companies_admin_select" ON public.companies
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid()
        AND role IN ('super_admin', 'admin', 'manager', 'analyst')
    )
  );


-- SURVEY ANSWERS --
ALTER TABLE public.survey_answers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "survey_select_own" ON public.survey_answers
  FOR SELECT USING (user_id = auth.uid());

CREATE POLICY "survey_insert_own" ON public.survey_answers
  FOR INSERT WITH CHECK (user_id = auth.uid());

CREATE POLICY "survey_update_own" ON public.survey_answers
  FOR UPDATE USING (user_id = auth.uid());

CREATE POLICY "survey_admin_select" ON public.survey_answers
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid()
        AND role IN ('super_admin', 'admin', 'manager', 'analyst')
    )
  );


-- DOCUMENTS --
ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "documents_select_own" ON public.documents
  FOR SELECT USING (user_id = auth.uid());

CREATE POLICY "documents_insert_own" ON public.documents
  FOR INSERT WITH CHECK (user_id = auth.uid());

CREATE POLICY "documents_update_own" ON public.documents
  FOR UPDATE USING (user_id = auth.uid());

CREATE POLICY "documents_admin_select" ON public.documents
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid()
        AND role IN ('super_admin', 'admin', 'manager', 'analyst')
    )
  );

-- Allow service role to update parse_status (n8n callback)
-- Handled via service role key bypass — no extra policy needed.


-- METRICS --
ALTER TABLE public.metrics ENABLE ROW LEVEL SECURITY;

CREATE POLICY "metrics_select_own" ON public.metrics
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.companies
      WHERE id = metrics.company_id
        AND user_id = auth.uid()
    )
  );

CREATE POLICY "metrics_insert_own" ON public.metrics
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.companies
      WHERE id = metrics.company_id
        AND user_id = auth.uid()
    )
  );

CREATE POLICY "metrics_admin_select" ON public.metrics
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid()
        AND role IN ('super_admin', 'admin', 'manager', 'analyst')
    )
  );


-- DIAGNOSTICS --
ALTER TABLE public.diagnostics ENABLE ROW LEVEL SECURITY;

CREATE POLICY "diagnostics_select_own" ON public.diagnostics
  FOR SELECT USING (user_id = auth.uid());

CREATE POLICY "diagnostics_insert_own" ON public.diagnostics
  FOR INSERT WITH CHECK (user_id = auth.uid());

CREATE POLICY "diagnostics_admin_select" ON public.diagnostics
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid()
        AND role IN ('super_admin', 'admin', 'manager', 'analyst')
    )
  );


-- =============================================================================
-- SUPABASE REALTIME
-- =============================================================================
-- Enable Realtime publication for tables that need live push notifications

-- Run these in the Supabase Dashboard → Database → Replication,
-- OR uncomment the lines below if using supabase CLI with realtime extension:

-- ALTER PUBLICATION supabase_realtime ADD TABLE public.profiles;
-- ALTER PUBLICATION supabase_realtime ADD TABLE public.documents;
-- ALTER PUBLICATION supabase_realtime ADD TABLE public.diagnostics;

-- NOTE: For security, only expose non-sensitive columns via Realtime.
-- Clients subscribe filtered by user_id using .eq('user_id', uid) channel filters.


-- =============================================================================
-- STORAGE BUCKET — client-documents
-- =============================================================================
-- Run in Supabase Dashboard → Storage → New bucket, OR via API:

-- INSERT INTO storage.buckets (id, name, public)
-- VALUES ('client-documents', 'client-documents', false);

-- Storage RLS — Users upload only to their own folder: {user_id}/{filename}

-- CREATE POLICY "storage_insert_own" ON storage.objects
--   FOR INSERT WITH CHECK (
--     bucket_id = 'client-documents' AND
--     (storage.foldername(name))[1] = auth.uid()::text
--   );

-- CREATE POLICY "storage_select_own" ON storage.objects
--   FOR SELECT USING (
--     bucket_id = 'client-documents' AND
--     (storage.foldername(name))[1] = auth.uid()::text
--   );

-- CREATE POLICY "storage_delete_own" ON storage.objects
--   FOR DELETE USING (
--     bucket_id = 'client-documents' AND
--     (storage.foldername(name))[1] = auth.uid()::text
--   );

-- CREATE POLICY "storage_admin_select" ON storage.objects
--   FOR SELECT USING (
--     bucket_id = 'client-documents' AND
--     EXISTS (
--       SELECT 1 FROM public.profiles
--       WHERE id = auth.uid()
--         AND role IN ('super_admin', 'admin', 'manager')
--     )
--   );


-- =============================================================================
-- HELPER VIEWS (optional, for admin dashboard)
-- =============================================================================

CREATE OR REPLACE VIEW public.v_pending_users AS
SELECT
  p.id,
  p.email,
  p.full_name,
  p.organization,
  p.position,
  p.phone,
  p.status,
  p.created_at,
  c.name        AS company_name,
  c.industry    AS company_industry,
  c.stage       AS company_stage
FROM public.profiles p
LEFT JOIN public.companies c ON c.user_id = p.id
WHERE p.status = 'pending_approval'
ORDER BY p.created_at ASC;

COMMENT ON VIEW public.v_pending_users IS 'Admin view: users awaiting approval, joined with company info.';

CREATE OR REPLACE VIEW public.v_client_diagnostics AS
SELECT
  p.id          AS user_id,
  p.email,
  p.full_name,
  p.status      AS approval_status,
  c.id          AS company_id,
  c.name        AS company_name,
  c.industry,
  c.stage,
  d.overall_score,
  d.health_index,
  d.stage       AS diagnostic_stage,
  d.finance_score,
  d.sales_score,
  d.operations_score,
  d.marketing_score,
  d.strategy_score,
  d.risks,
  d.quick_wins,
  d.calculated_at
FROM public.profiles p
LEFT JOIN public.companies   c ON c.user_id    = p.id
LEFT JOIN public.diagnostics d ON d.user_id    = p.id AND d.is_current = TRUE
WHERE p.role = 'client'
ORDER BY d.overall_score DESC NULLS LAST;

COMMENT ON VIEW public.v_client_diagnostics IS 'Admin view: all clients with their current Point A scores.';


-- =============================================================================
-- SEED: Create first admin user
-- (Replace values before running)
-- =============================================================================

-- Step 1: Register via Supabase Auth API (dashboard or auth.signUp)
-- Step 2: Then run this to promote to admin:

-- UPDATE public.profiles
-- SET    role   = 'admin',
--        status = 'approved'
-- WHERE  email  = 'admin@aistart360.kz';


-- =============================================================================
-- DONE
-- =============================================================================
-- Tables created:
--   public.profiles        (users + approval gate)
--   public.companies       (company data from Step 1)
--   public.survey_answers  (Steps 1–6 wizard answers)
--   public.documents       (uploaded files)
--   public.metrics         (extracted + calculated KPIs)
--   public.diagnostics     (Point A results, versioned)
--
-- RLS enabled on all 6 tables
-- Triggers: auto-profile on register, auto-updated_at, diagnostic versioning
-- Views: v_pending_users, v_client_diagnostics
-- =============================================================================
