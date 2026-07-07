-- 041_fk_indexes.sql
-- PERF-01 (audit 2026-07-07): the Prisma schema declares 31 @@index entries on
-- foreign-key / hot-filter columns, but no SQL migration ever created them on
-- the shared Supabase Postgres, so those columns are scanned sequentially.
--
-- This migration creates every one of them, idempotently and defensively.
--
-- SAFETY / APPLY NOTES:
--   * Live column names were introspected from information_schema. They are
--     MIXED: most are camelCase and must be quoted ("managerId"), but a few FK
--     columns are snake_case (accounts.user_id, sessions.user_id,
--     report_documents.uploaded_by). Each index below uses the REAL column name.
--   * Every CREATE is guarded twice: the table must exist AND all target columns
--     must exist. A missing table/column is skipped with a NOTICE — never an
--     error that aborts the batch (so this stays safe to re-run on any env).
--   * Index names follow Prisma's {table}_{cols}_idx convention so `IF NOT
--     EXISTS` is a true no-op for the 3 already created in init-schema.sql.
--   * These are PLAIN (non-CONCURRENT) CREATE INDEX statements: scripts/
--     apply-migration.js runs the file as one implicit transaction, and CREATE
--     INDEX CONCURRENTLY cannot run inside a transaction. Plain builds take a
--     brief write lock per table — run OFF-PEAK. For a zero-write-lock rollout,
--     run each index's CONCURRENTLY variant one-by-one via psql instead.
--
-- Apply with:  node scripts/apply-migration.js supabase/migrations/041_fk_indexes.sql

DO $$
DECLARE
  rec RECORD;
  missing_col text;
BEGIN
  FOR rec IN
    SELECT * FROM (VALUES
      ('financial_snapshots', ARRAY['orgId'],                 'CREATE INDEX IF NOT EXISTS "financial_snapshots_orgId_idx" ON "financial_snapshots"("orgId")'),
      ('users',               ARRAY['orgId'],                 'CREATE INDEX IF NOT EXISTS "users_orgId_idx" ON "users"("orgId")'),
      ('accounts',            ARRAY['user_id'],               'CREATE INDEX IF NOT EXISTS "accounts_user_id_idx" ON "accounts"("user_id")'),
      ('sessions',            ARRAY['user_id'],               'CREATE INDEX IF NOT EXISTS "sessions_user_id_idx" ON "sessions"("user_id")'),
      ('clients',             ARRAY['orgId'],                 'CREATE INDEX IF NOT EXISTS "clients_orgId_idx" ON "clients"("orgId")'),
      ('clients',             ARRAY['managerId'],             'CREATE INDEX IF NOT EXISTS "clients_managerId_idx" ON "clients"("managerId")'),
      ('reports',             ARRAY['clientId'],              'CREATE INDEX IF NOT EXISTS "reports_clientId_idx" ON "reports"("clientId")'),
      ('reports',             ARRAY['uploadedBy'],            'CREATE INDEX IF NOT EXISTS "reports_uploadedBy_idx" ON "reports"("uploadedBy")'),
      ('projects',            ARRAY['clientId'],              'CREATE INDEX IF NOT EXISTS "projects_clientId_idx" ON "projects"("clientId")'),
      ('notifications',       ARRAY['userId','isRead'],       'CREATE INDEX IF NOT EXISTS "notifications_userId_isRead_idx" ON "notifications"("userId", "isRead")'),
      ('activity_logs',       ARRAY['clientId','createdAt'],  'CREATE INDEX IF NOT EXISTS "activity_logs_clientId_createdAt_idx" ON "activity_logs"("clientId", "createdAt")'),
      ('activity_logs',       ARRAY['userId','createdAt'],    'CREATE INDEX IF NOT EXISTS "activity_logs_userId_createdAt_idx" ON "activity_logs"("userId", "createdAt")'),
      ('gri_reports',         ARRAY['clientId','calculatedAt'], 'CREATE INDEX IF NOT EXISTS "gri_reports_clientId_calculatedAt_idx" ON "gri_reports"("clientId", "calculatedAt")'),
      ('report_documents',    ARRAY['uploaded_by'],           'CREATE INDEX IF NOT EXISTS "report_documents_uploaded_by_idx" ON "report_documents"("uploaded_by")'),
      ('admin_requests',      ARRAY['status','createdAt'],    'CREATE INDEX IF NOT EXISTS "admin_requests_status_createdAt_idx" ON "admin_requests"("status", "createdAt")'),
      ('admin_requests',      ARRAY['assignedAdminId'],       'CREATE INDEX IF NOT EXISTS "admin_requests_assignedAdminId_idx" ON "admin_requests"("assignedAdminId")'),
      ('admin_requests',      ARRAY['companyId'],             'CREATE INDEX IF NOT EXISTS "admin_requests_companyId_idx" ON "admin_requests"("companyId")'),
      ('admin_requests',      ARRAY['userId'],                'CREATE INDEX IF NOT EXISTS "admin_requests_userId_idx" ON "admin_requests"("userId")'),
      ('comments',            ARRAY['requestId'],             'CREATE INDEX IF NOT EXISTS "comments_requestId_idx" ON "comments"("requestId")'),
      ('comments',            ARRAY['authorId'],              'CREATE INDEX IF NOT EXISTS "comments_authorId_idx" ON "comments"("authorId")'),
      ('audit_logs',          ARRAY['entityType','entityId'], 'CREATE INDEX IF NOT EXISTS "audit_logs_entityType_entityId_idx" ON "audit_logs"("entityType", "entityId")'),
      ('audit_logs',          ARRAY['performedBy'],           'CREATE INDEX IF NOT EXISTS "audit_logs_performedBy_idx" ON "audit_logs"("performedBy")'),
      ('diagnostic_runs',     ARRAY['clientId'],              'CREATE INDEX IF NOT EXISTS "diagnostic_runs_clientId_idx" ON "diagnostic_runs"("clientId")'),
      ('document_summaries',  ARRAY['clientId'],              'CREATE INDEX IF NOT EXISTS "document_summaries_clientId_idx" ON "document_summaries"("clientId")'),
      ('document_summaries',  ARRAY['reportId'],              'CREATE INDEX IF NOT EXISTS "document_summaries_reportId_idx" ON "document_summaries"("reportId")'),
      ('document_chunks',     ARRAY['documentSummaryId'],     'CREATE INDEX IF NOT EXISTS "document_chunks_documentSummaryId_idx" ON "document_chunks"("documentSummaryId")'),
      ('mini_gri_leads',      ARRAY['email'],                 'CREATE INDEX IF NOT EXISTS "mini_gri_leads_email_idx" ON "mini_gri_leads"("email")'),
      ('mini_gri_leads',      ARRAY['createdAt'],             'CREATE INDEX IF NOT EXISTS "mini_gri_leads_createdAt_idx" ON "mini_gri_leads"("createdAt")'),
      ('shared_reports',      ARRAY['token'],                 'CREATE INDEX IF NOT EXISTS "shared_reports_token_idx" ON "shared_reports"("token")'),
      ('shared_reports',      ARRAY['companyId'],             'CREATE INDEX IF NOT EXISTS "shared_reports_companyId_idx" ON "shared_reports"("companyId")'),
      ('payment_transactions',ARRAY['orgId'],                 'CREATE INDEX IF NOT EXISTS "payment_transactions_orgId_idx" ON "payment_transactions"("orgId")')
    ) AS t(tbl, cols, ddl)
  LOOP
    IF to_regclass(format('public.%I', rec.tbl)) IS NULL THEN
      RAISE NOTICE 'skip %: table does not exist', rec.tbl;
      CONTINUE;
    END IF;

    SELECT c INTO missing_col
      FROM unnest(rec.cols) AS c
     WHERE NOT EXISTS (
       SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = rec.tbl AND column_name = c
     )
     LIMIT 1;

    IF missing_col IS NOT NULL THEN
      RAISE NOTICE 'skip index on %: column % missing', rec.tbl, missing_col;
      CONTINUE;
    END IF;

    EXECUTE rec.ddl;
  END LOOP;
END $$;
