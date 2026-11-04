-- Create the report_documents table that backs the Reports feature.
--
-- The Prisma model `ReportDocument` (@@map("report_documents")) existed in
-- prisma/schema.prisma but the table was never materialized in the database,
-- so app/actions/reports.ts (createReportMetadata / getReportDocuments) and the
-- Reports UI failed at runtime with "table public.report_documents does not exist".
--
-- Column types mirror Prisma's Postgres mapping: String -> text,
-- Int -> integer, DateTime -> timestamp(3). `id` is an app-generated cuid.

CREATE TABLE IF NOT EXISTS public.report_documents (
  id              text         PRIMARY KEY,
  name            text         NOT NULL,
  client_name     text         NOT NULL,
  category        text         NOT NULL,
  type            text         NOT NULL,
  file_url        text         NOT NULL,
  file_size_bytes integer      NOT NULL,
  uploaded_by     text         NOT NULL,
  created_at      timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
