-- 103_report_review.sql
--
-- Owner decision (2026-10): «PDF-версия отчёта (с номером версии и датой)
-- отправляется эксперту после диагностики ИИ для подтверждения; кнопка
-- «Подтвердить» сразу публикует отчёт клиенту».
--
--   • report_versions.status gains 'in_review': the `report` agent now creates
--     a version in this status (lib/reports/versions.ts createReviewVersion).
--     The client never sees it: report_versions_select (085) admits a tenant
--     only to status = 'published'; staff and partner consultants keep reading
--     every status. The policy is re-created below unchanged in meaning, so the
--     rule is stated next to the new status.
--   • report_versions.pdf_rendered_at: when the stored PDF (pdf_storage_path,
--     085) was rendered. The PDF is rendered once per stage — «на проверке»
--     (watermarked) and «опубликован» — and kept in the private bucket
--     'report-pdfs' (service role only; no storage.objects policies).
--   • report_version_reviews: the expert decision on an in_review version —
--     approve (= publish at once) or changes_requested (comment, the report
--     agent is asked to rebuild, capped per diagnostic session). Exactly one
--     decision per version (unique index): a second approve is a no-op.
--     Read: platform staff only (experts included, is_platform_staff()). The
--     client and partner consultants never read reviews. Writes: server only.
--
-- Idempotent. Apply: node scripts/apply-migration.js supabase/migrations/103_report_review.sql

-- ─── Status vocabulary ──────────────────────────────────────────────────────
DO $$
DECLARE
  c RECORD;
BEGIN
  -- 085 declared the CHECK inline (auto-named); drop whichever status check exists.
  FOR c IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'public.report_versions'::regclass AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%status%'
      AND pg_get_constraintdef(oid) ILIKE '%superseded%'
  LOOP
    EXECUTE format('ALTER TABLE public.report_versions DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;

ALTER TABLE public.report_versions
  ADD CONSTRAINT report_versions_status_check
  CHECK (status IN ('draft', 'ready', 'in_review', 'published', 'superseded', 'failed'));

ALTER TABLE public.report_versions
  ADD COLUMN IF NOT EXISTS pdf_rendered_at TIMESTAMPTZ;

COMMENT ON COLUMN public.report_versions.pdf_storage_path IS
  'Private Storage object (bucket report-pdfs) of the rendered PDF of this version; review-v<N>.pdf while in_review, v<N>.pdf once published (103).';
COMMENT ON COLUMN public.report_versions.pdf_rendered_at IS
  'When pdf_storage_path was rendered (103).';

CREATE INDEX IF NOT EXISTS report_versions_in_review_idx
  ON public.report_versions (created_at DESC) WHERE status = 'in_review';

-- Clients: published only. Staff (experts included) and partner consultants: all statuses.
DROP POLICY IF EXISTS report_versions_select ON public.report_versions;
CREATE POLICY report_versions_select ON public.report_versions FOR SELECT USING (
  public.can_read_company(company_id)
  AND (status = 'published' OR public.is_platform_staff() OR public.partner_role_for_company(company_id) IS NOT NULL)
);

-- ─── Expert decisions ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.report_version_reviews (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  report_version_id UUID        NOT NULL REFERENCES public.report_versions(id) ON DELETE CASCADE,
  company_id        TEXT        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  session_id        UUID        REFERENCES public.diagnostic_sessions(id) ON DELETE SET NULL,
  reviewer_id       UUID        REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewer_role     TEXT,
  decision          TEXT        NOT NULL CHECK (decision IN ('approve', 'changes_requested')),
  comment           TEXT        CHECK (comment IS NULL OR length(comment) <= 2000),
  channel           TEXT        NOT NULL CHECK (channel IN ('web', 'telegram')),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT report_version_reviews_comment_required
    CHECK (decision <> 'changes_requested' OR length(btrim(coalesce(comment, ''))) >= 3)
);
COMMENT ON TABLE public.report_version_reviews IS
  'Expert decision on an in_review report version: approve (published at once) or changes_requested (103).';

CREATE UNIQUE INDEX IF NOT EXISTS report_version_reviews_one_decision
  ON public.report_version_reviews (report_version_id);
CREATE INDEX IF NOT EXISTS report_version_reviews_company_idx
  ON public.report_version_reviews (company_id, created_at DESC);
CREATE INDEX IF NOT EXISTS report_version_reviews_session_idx
  ON public.report_version_reviews (session_id, decision) WHERE session_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS report_version_reviews_reviewer_idx
  ON public.report_version_reviews (reviewer_id, created_at DESC);

ALTER TABLE public.report_version_reviews ENABLE ROW LEVEL SECURITY;
REVOKE INSERT, UPDATE, DELETE ON public.report_version_reviews FROM anon, authenticated;

DROP POLICY IF EXISTS report_version_reviews_select ON public.report_version_reviews;
CREATE POLICY report_version_reviews_select ON public.report_version_reviews FOR SELECT
  USING (public.is_platform_staff());

-- ─── Private bucket for rendered PDFs ───────────────────────────────────────
DO $$
BEGIN
  IF to_regclass('storage.buckets') IS NOT NULL THEN
    INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    VALUES ('report-pdfs', 'report-pdfs', false, 20971520, ARRAY['application/pdf'])
    ON CONFLICT (id) DO UPDATE
      SET public = false,
          file_size_limit = 20971520,
          allowed_mime_types = ARRAY['application/pdf'];
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
