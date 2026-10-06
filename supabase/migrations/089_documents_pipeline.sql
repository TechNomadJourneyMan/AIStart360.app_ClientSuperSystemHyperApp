-- 089_documents_pipeline.sql
--
-- Server-side document pipeline (docs/platform, decision D6; audit 03 §1–3):
--
--   upload (client → private bucket, own folder)
--     → finalize (server: size cap, magic bytes, zip/XML bomb, PDF active
--       content, sha256 dedupe)                       processing_stage=validated
--     → FILE_UPLOADED → agent document_intelligence   parsing → extracting → binding
--     → parsed_data + provenance                      done   (FILE_PROCESSED)
--
-- What this migration adds to public.documents:
--   * storage_bucket / storage_path — where the object lives. The pipeline
--     never stores 1-year signed URLs again; file_url keeps the plain path for
--     old readers.
--   * size_bytes, sha256, sniffed_mime — measured by the server, not declared
--     by the browser. sha256 drives per-company dedupe (unique index below).
--   * security_status pending|clean|rejected + security_reason.
--   * processing_stage, attempts, last_error_code, processed_at,
--     extraction_version, processing_task_id, updated_at — the real lifecycle
--     (the stuck-document reaper uses processing_stage + updated_at).
--   * parse_status gains 'needs_ocr' (scan without a text layer, OCR not
--     available) and 'rejected' (failed the security preflight).
--   * doc_type gains the values the UI and the extractor already send
--     (pl_statement, business_plan, presentation, e-commerce exports) —
--     before, those inserts failed the CHECK with a 500.
--
-- Guard (same pattern as profiles_guard_privileged_columns in 083): the owner
-- of a row talks to PostgREST as `authenticated` and RLS lets them UPDATE
-- their own documents. Without a guard they could forge parsed_data /
-- parse_status (which flow into metrics as "document" facts), mark a file
-- clean, or point storage_path/file_url/company_id at somebody else's object
-- or company. Pipeline, security and location columns are therefore writable
-- only by the service role / server (Prisma) and platform staff. Owners keep
-- editing the descriptive columns (file_name, doc_type, period_*).
--
-- Idempotent. Apply: node scripts/apply-migration.js supabase/migrations/089_documents_pipeline.sql

-- ─── Columns ────────────────────────────────────────────────────────────────
ALTER TABLE public.documents
  ADD COLUMN IF NOT EXISTS storage_bucket      TEXT,
  ADD COLUMN IF NOT EXISTS storage_path        TEXT,
  ADD COLUMN IF NOT EXISTS size_bytes          BIGINT,
  ADD COLUMN IF NOT EXISTS sha256              TEXT,
  ADD COLUMN IF NOT EXISTS sniffed_mime        TEXT,
  ADD COLUMN IF NOT EXISTS security_status     TEXT        NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS security_reason     TEXT,
  ADD COLUMN IF NOT EXISTS processing_stage    TEXT,
  ADD COLUMN IF NOT EXISTS attempts            SMALLINT    NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_error_code     TEXT,
  ADD COLUMN IF NOT EXISTS processed_at        TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS extraction_version  TEXT,
  ADD COLUMN IF NOT EXISTS processing_task_id  UUID;

COMMENT ON COLUMN public.documents.storage_bucket IS 'Storage bucket of the object (089). NULL for legacy rows that only have file_url.';
COMMENT ON COLUMN public.documents.storage_path IS 'Object path inside storage_bucket; always starts with "<user_id>/" (089).';
COMMENT ON COLUMN public.documents.sha256 IS 'Hex SHA-256 of the object bytes, measured by the server at finalize (089).';
COMMENT ON COLUMN public.documents.sniffed_mime IS 'MIME detected from magic bytes by lib/documents/preflight.ts (089).';
COMMENT ON COLUMN public.documents.security_status IS 'pending = not checked yet (legacy) | clean = passed preflight | rejected (089).';
COMMENT ON COLUMN public.documents.processing_stage IS 'uploaded → validated → parsing → extracting → binding → done | failed (089).';
COMMENT ON COLUMN public.documents.attempts IS 'Number of processing runs started for this document (089).';
COMMENT ON COLUMN public.documents.extraction_version IS 'Pipeline + prompt version that produced parsed_data (089).';
COMMENT ON COLUMN public.documents.processing_task_id IS 'agent_tasks.id currently holding the document (089).';

-- ─── Value checks ───────────────────────────────────────────────────────────
ALTER TABLE public.documents DROP CONSTRAINT IF EXISTS documents_security_status_check;
ALTER TABLE public.documents ADD CONSTRAINT documents_security_status_check
  CHECK (security_status IN ('pending', 'clean', 'rejected'));

ALTER TABLE public.documents DROP CONSTRAINT IF EXISTS documents_processing_stage_check;
ALTER TABLE public.documents ADD CONSTRAINT documents_processing_stage_check
  CHECK (processing_stage IS NULL OR processing_stage IN
    ('uploaded', 'validated', 'parsing', 'extracting', 'binding', 'done', 'failed'));

ALTER TABLE public.documents DROP CONSTRAINT IF EXISTS documents_sha256_format_check;
ALTER TABLE public.documents ADD CONSTRAINT documents_sha256_format_check
  CHECK (sha256 IS NULL OR sha256 ~ '^[0-9a-f]{64}$');

ALTER TABLE public.documents DROP CONSTRAINT IF EXISTS documents_storage_location_check;
ALTER TABLE public.documents ADD CONSTRAINT documents_storage_location_check
  CHECK ((storage_bucket IS NULL) = (storage_path IS NULL));

ALTER TABLE public.documents DROP CONSTRAINT IF EXISTS documents_size_bytes_check;
ALTER TABLE public.documents ADD CONSTRAINT documents_size_bytes_check
  CHECK (size_bytes IS NULL OR size_bytes >= 0);

ALTER TABLE public.documents DROP CONSTRAINT IF EXISTS documents_attempts_check;
ALTER TABLE public.documents ADD CONSTRAINT documents_attempts_check
  CHECK (attempts >= 0);

-- parse_status: drop whatever CHECK mentions it (016/017 pattern), then re-add.
DO $$
DECLARE c_name TEXT;
BEGIN
  FOR c_name IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'public.documents'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%parse_status%'
  LOOP
    EXECUTE format('ALTER TABLE public.documents DROP CONSTRAINT %I', c_name);
  END LOOP;
END $$;

ALTER TABLE public.documents ADD CONSTRAINT documents_parse_status_check
  CHECK (parse_status IN ('queued', 'processing', 'parsed', 'completed', 'error', 'needs_ocr', 'rejected'));

-- doc_type: keep every existing value, add what the UI / extractor send.
DO $$
DECLARE c_name TEXT;
BEGIN
  FOR c_name IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'public.documents'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%doc_type%'
  LOOP
    EXECUTE format('ALTER TABLE public.documents DROP CONSTRAINT %I', c_name);
  END LOOP;
END $$;

ALTER TABLE public.documents ADD CONSTRAINT documents_doc_type_check CHECK (
  doc_type IN (
    -- generic (001 / 019)
    'pl_report', 'balance_sheet', 'marketing_report', 'ops_report', 'crm_export',
    'audit', 'other', 'financial_report',
    -- v3 Point A (019)
    'sales_report', 'client_base',
    -- medical (012)
    'patient_base', 'pricelist', 'services_catalog', 'packages', 'scripts', 'brand_rules',
    -- point-a FileArea (089)
    'pl_statement', 'business_plan', 'presentation',
    -- e-commerce exports understood by lib/documents/extract.ts (089)
    'marketplace_report', 'ads_report', 'cart_funnel', 'inventory_csv', 'ga4_export',
    'ecommerce_customers'
  )
);

-- ─── Indexes ────────────────────────────────────────────────────────────────
-- Same bytes uploaded twice into one company (or, without a company, by one
-- user) are one document. Rejected rows do not block a later clean upload.
CREATE UNIQUE INDEX IF NOT EXISTS documents_dedupe_sha256_idx
  ON public.documents ((coalesce('c:' || company_id, 'u:' || user_id::text)), sha256)
  WHERE sha256 IS NOT NULL AND security_status <> 'rejected';

-- Reaper: in-flight documents by staleness.
CREATE INDEX IF NOT EXISTS documents_inflight_idx
  ON public.documents (processing_stage, updated_at)
  WHERE processing_stage IN ('uploaded', 'validated', 'parsing', 'extracting', 'binding');

CREATE INDEX IF NOT EXISTS documents_company_uploaded_idx
  ON public.documents (company_id, uploaded_at DESC)
  WHERE company_id IS NOT NULL;

-- Wider "needs attention" partial index (017 covered queued/processing/error).
DROP INDEX IF EXISTS public.documents_parse_status_idx;
CREATE INDEX IF NOT EXISTS documents_parse_status_idx
  ON public.documents (parse_status)
  WHERE parse_status IN ('queued', 'processing', 'error', 'needs_ocr', 'rejected');

-- ─── updated_at ─────────────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS documents_updated_at ON public.documents;
CREATE TRIGGER documents_updated_at
  BEFORE UPDATE ON public.documents
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ─── Guard: pipeline / security / location columns are server-only ─────────
CREATE OR REPLACE FUNCTION public.documents_guard_pipeline_columns()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  -- The service role, migrations and the server's direct connection (Prisma,
  -- no JWT) are trusted; so is platform staff.
  IF coalesce(auth.role(), '') NOT IN ('authenticated', 'anon') THEN
    RETURN NEW;
  END IF;
  IF public.is_platform_staff() THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.parsed_data IS NOT NULL
    OR NEW.parse_status IS DISTINCT FROM 'queued'
    OR NEW.parse_error IS NOT NULL
    OR NEW.security_status IS DISTINCT FROM 'pending'
    OR NEW.security_reason IS NOT NULL
    OR NEW.sha256 IS NOT NULL
    OR NEW.sniffed_mime IS NOT NULL
    OR coalesce(NEW.processing_stage, 'uploaded') <> 'uploaded'
    OR NEW.attempts <> 0
    OR NEW.processed_at IS NOT NULL
    OR NEW.extraction_version IS NOT NULL
    OR NEW.last_error_code IS NOT NULL
    OR NEW.processing_task_id IS NOT NULL
    OR NEW.storage_bucket IS NOT NULL
    OR NEW.storage_path IS NOT NULL
    OR NEW.size_bytes IS NOT NULL THEN
      RAISE EXCEPTION 'documents: pipeline columns are set by the server only'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF NEW.company_id IS NOT NULL AND NOT public.can_read_company(NEW.company_id::text) THEN
      RAISE EXCEPTION 'documents: no access to this company'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.parsed_data        IS DISTINCT FROM OLD.parsed_data
  OR NEW.parse_status       IS DISTINCT FROM OLD.parse_status
  OR NEW.parse_error        IS DISTINCT FROM OLD.parse_error
  OR NEW.security_status    IS DISTINCT FROM OLD.security_status
  OR NEW.security_reason    IS DISTINCT FROM OLD.security_reason
  OR NEW.sha256             IS DISTINCT FROM OLD.sha256
  OR NEW.sniffed_mime       IS DISTINCT FROM OLD.sniffed_mime
  OR NEW.processing_stage   IS DISTINCT FROM OLD.processing_stage
  OR NEW.attempts           IS DISTINCT FROM OLD.attempts
  OR NEW.processed_at       IS DISTINCT FROM OLD.processed_at
  OR NEW.extraction_version IS DISTINCT FROM OLD.extraction_version
  OR NEW.last_error_code    IS DISTINCT FROM OLD.last_error_code
  OR NEW.processing_task_id IS DISTINCT FROM OLD.processing_task_id
  OR NEW.storage_bucket     IS DISTINCT FROM OLD.storage_bucket
  OR NEW.storage_path       IS DISTINCT FROM OLD.storage_path
  OR NEW.size_bytes         IS DISTINCT FROM OLD.size_bytes
  OR NEW.file_url           IS DISTINCT FROM OLD.file_url
  OR NEW.company_id         IS DISTINCT FROM OLD.company_id
  OR NEW.user_id            IS DISTINCT FROM OLD.user_id THEN
    RAISE EXCEPTION 'documents: column is not editable by the owner'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS documents_guard_pipeline_columns ON public.documents;
CREATE TRIGGER documents_guard_pipeline_columns
  BEFORE INSERT OR UPDATE ON public.documents
  FOR EACH ROW EXECUTE FUNCTION public.documents_guard_pipeline_columns();

-- ─── Bucket: private, hard size ceiling ─────────────────────────────────────
-- The server cap is DOCUMENT_MAX_BYTES (25 MB by default, enforced at
-- finalize); the bucket ceiling stops abusive uploads before they are stored.
DO $$
BEGIN
  IF to_regclass('storage.buckets') IS NOT NULL THEN
    INSERT INTO storage.buckets (id, name, public, file_size_limit)
    VALUES ('client-documents', 'client-documents', false, 52428800)
    ON CONFLICT (id) DO UPDATE
      SET public = false,
          file_size_limit = least(coalesce(storage.buckets.file_size_limit, 52428800), 52428800);
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
