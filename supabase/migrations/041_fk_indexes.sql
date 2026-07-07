-- 041_fk_indexes.sql
-- PERF-01 (audit 2026-07-07): the Prisma schema declares 31 @@index entries on
-- foreign-key / hot-filter columns, but no SQL migration ever created them on
-- the shared Supabase Postgres, so those columns are scanned sequentially.
--
-- This migration creates every one of them, idempotently.
--
-- SAFETY / APPLY NOTES:
--   * Columns on the Prisma-owned tables are CAMELCASE and must be quoted
--     ("managerId", not manager_id) — verified against scripts/init-schema.sql.
--   * Index names follow Prisma's own convention ({table}_{cols}_idx) so that
--     `IF NOT EXISTS` is a true no-op for the 3 already created in
--     init-schema.sql and so Prisma will never create a duplicate later.
--   * Each CREATE is guarded by a table-existence check, because some
--     Prisma/NextAuth tables (users/accounts/sessions/...) may not exist on
--     every environment. Missing tables are skipped with a NOTICE, not an error.
--   * These are PLAIN (non-CONCURRENT) CREATE INDEX statements: scripts/
--     apply-migration.js sends the whole file as one implicit transaction, and
--     CREATE INDEX CONCURRENTLY cannot run inside a transaction block. Plain
--     builds take a brief write lock per table — run this OFF-PEAK.
--   * If you need a zero-write-lock rollout instead, run each statement's
--     CONCURRENTLY variant one-by-one via psql (outside any transaction), e.g.
--       CREATE INDEX CONCURRENTLY IF NOT EXISTS "clients_managerId_idx"
--         ON "clients"("managerId");
--
-- Apply with:  node scripts/apply-migration.js supabase/migrations/041_fk_indexes.sql

DO $$
DECLARE
  rec RECORD;
BEGIN
  FOR rec IN
    SELECT * FROM (VALUES
      ('financial_snapshots', 'CREATE INDEX IF NOT EXISTS "financial_snapshots_orgId_idx" ON "financial_snapshots"("orgId")'),
      ('users',               'CREATE INDEX IF NOT EXISTS "users_orgId_idx" ON "users"("orgId")'),
      ('accounts',            'CREATE INDEX IF NOT EXISTS "accounts_userId_idx" ON "accounts"("userId")'),
      ('sessions',            'CREATE INDEX IF NOT EXISTS "sessions_userId_idx" ON "sessions"("userId")'),
      ('clients',             'CREATE INDEX IF NOT EXISTS "clients_orgId_idx" ON "clients"("orgId")'),
      ('clients',             'CREATE INDEX IF NOT EXISTS "clients_managerId_idx" ON "clients"("managerId")'),
      ('reports',             'CREATE INDEX IF NOT EXISTS "reports_clientId_idx" ON "reports"("clientId")'),
      ('reports',             'CREATE INDEX IF NOT EXISTS "reports_uploadedBy_idx" ON "reports"("uploadedBy")'),
      ('projects',            'CREATE INDEX IF NOT EXISTS "projects_clientId_idx" ON "projects"("clientId")'),
      ('notifications',       'CREATE INDEX IF NOT EXISTS "notifications_userId_isRead_idx" ON "notifications"("userId", "isRead")'),
      ('activity_logs',       'CREATE INDEX IF NOT EXISTS "activity_logs_clientId_createdAt_idx" ON "activity_logs"("clientId", "createdAt")'),
      ('activity_logs',       'CREATE INDEX IF NOT EXISTS "activity_logs_userId_createdAt_idx" ON "activity_logs"("userId", "createdAt")'),
      ('gri_reports',         'CREATE INDEX IF NOT EXISTS "gri_reports_clientId_calculatedAt_idx" ON "gri_reports"("clientId", "calculatedAt")'),
      ('report_documents',    'CREATE INDEX IF NOT EXISTS "report_documents_uploadedBy_idx" ON "report_documents"("uploadedBy")'),
      ('admin_requests',      'CREATE INDEX IF NOT EXISTS "admin_requests_status_createdAt_idx" ON "admin_requests"("status", "createdAt")'),
      ('admin_requests',      'CREATE INDEX IF NOT EXISTS "admin_requests_assignedAdminId_idx" ON "admin_requests"("assignedAdminId")'),
      ('admin_requests',      'CREATE INDEX IF NOT EXISTS "admin_requests_companyId_idx" ON "admin_requests"("companyId")'),
      ('admin_requests',      'CREATE INDEX IF NOT EXISTS "admin_requests_userId_idx" ON "admin_requests"("userId")'),
      ('comments',            'CREATE INDEX IF NOT EXISTS "comments_requestId_idx" ON "comments"("requestId")'),
      ('comments',            'CREATE INDEX IF NOT EXISTS "comments_authorId_idx" ON "comments"("authorId")'),
      ('audit_logs',          'CREATE INDEX IF NOT EXISTS "audit_logs_entityType_entityId_idx" ON "audit_logs"("entityType", "entityId")'),
      ('audit_logs',          'CREATE INDEX IF NOT EXISTS "audit_logs_performedBy_idx" ON "audit_logs"("performedBy")'),
      ('diagnostic_runs',     'CREATE INDEX IF NOT EXISTS "diagnostic_runs_clientId_idx" ON "diagnostic_runs"("clientId")'),
      ('document_summaries',  'CREATE INDEX IF NOT EXISTS "document_summaries_clientId_idx" ON "document_summaries"("clientId")'),
      ('document_summaries',  'CREATE INDEX IF NOT EXISTS "document_summaries_reportId_idx" ON "document_summaries"("reportId")'),
      ('document_chunks',     'CREATE INDEX IF NOT EXISTS "document_chunks_documentSummaryId_idx" ON "document_chunks"("documentSummaryId")'),
      ('mini_gri_leads',      'CREATE INDEX IF NOT EXISTS "mini_gri_leads_email_idx" ON "mini_gri_leads"("email")'),
      ('mini_gri_leads',      'CREATE INDEX IF NOT EXISTS "mini_gri_leads_createdAt_idx" ON "mini_gri_leads"("createdAt")'),
      ('shared_reports',      'CREATE INDEX IF NOT EXISTS "shared_reports_token_idx" ON "shared_reports"("token")'),
      ('shared_reports',      'CREATE INDEX IF NOT EXISTS "shared_reports_companyId_idx" ON "shared_reports"("companyId")'),
      ('payment_transactions','CREATE INDEX IF NOT EXISTS "payment_transactions_orgId_idx" ON "payment_transactions"("orgId")')
    ) AS t(tbl, ddl)
  LOOP
    IF to_regclass(format('public.%I', rec.tbl)) IS NOT NULL THEN
      EXECUTE rec.ddl;
    ELSE
      RAISE NOTICE 'skip index on %: table does not exist', rec.tbl;
    END IF;
  END LOOP;
END $$;
