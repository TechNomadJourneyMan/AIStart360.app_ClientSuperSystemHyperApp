# Database Ownership

This repo provisions its Postgres schema through **two independent systems** that
both target the same Supabase Postgres database:

1. **Prisma** (`prisma/schema.prisma`) — owns the application/business domain
   tables. Migrated with `prisma migrate` / `prisma db push`. Table names below
   are the `@@map(...)` values.
2. **Supabase SQL migrations** (`supabase/migrations/*.sql`) — own the
   auth-adjacent, onboarding, RLS, diagnostics and document-ingestion tables.
   Applied with the Supabase CLI.

Because both write to the same database, a handful of tables **overlap
conceptually**. This document records the convention so the two systems do not
fight over the same rows.

> Convention in one line: **Prisma is the source of truth for the internal admin
> / CRM domain (Users, Clients, Reports, CRM, audit). Supabase migrations are the
> source of truth for the end-user-facing onboarding domain (profiles, companies,
> diagnostics, documents) which is bound to Supabase Auth + RLS.**

---

## Prisma-owned tables (`prisma/schema.prisma`)

| Table (`@@map`)        | Prisma model        | Domain                                   |
| ---------------------- | ------------------- | ---------------------------------------- |
| `organizations`        | `Organization`      | Tenancy / org grouping                   |
| `financial_snapshots`  | `FinancialSnapshot` | Org financials                           |
| `users`                | `User`              | Internal app users (admin/expert/etc.)   |
| `accounts`             | `Account`           | Auth.js OAuth accounts                   |
| `sessions`             | `Session`           | Auth.js sessions                         |
| `verification_tokens`  | `VerificationToken` | Auth.js email verification               |
| `clients`              | `Client`            | Managed client records (CRM-side)        |
| `reports`              | `Report`            | Uploaded/generated reports               |
| `projects`             | `Project`           | Client projects                          |
| `notifications`        | `Notification`      | In-app notifications                     |
| `activity_logs`        | `ActivityLog`       | Activity feed                            |
| `pulse_metrics`        | `PulseMetric`       | Pulse metric snapshots                   |
| `gri_reports`          | `GriReport`         | GRI report records                       |
| `report_documents`     | `ReportDocument`    | Files attached to reports                |
| `companies`            | `Company`           | Company records (**overlaps Supabase**)  |
| `admin_requests`       | `AdminRequest`      | Admin request queue                      |
| `comments`             | `Comment`           | Expert/internal comments                 |
| `crm_integrations`     | `CrmIntegration`    | Bitrix24 / amoCRM connections            |
| `audit_logs`           | `AuditLog`          | Security audit trail                     |
| `diagnostic_runs`      | `DiagnosticRun`     | Diagnostic run records                   |
| `document_summaries`   | `DocumentSummary`   | Per-document AI summaries                |
| `document_chunks`      | `DocumentChunk`     | pgvector RAG chunks                      |

---

## Supabase-migration-owned tables (`supabase/migrations`)

These are created and/or altered by the SQL migrations and carry **Row Level
Security** policies tied to Supabase Auth (`auth.uid()`).

| Table              | First defined / touched by         | Domain                                  |
| ------------------ | ---------------------------------- | --------------------------------------- |
| `profiles`         | `001_onboarding_system.sql`        | End-user profile (1:1 with auth.users)  |
| `companies`        | `001` / `013_companies_schema_reconcile` | End-user company (**overlaps Prisma**) |
| `survey_answers`   | `001_onboarding_system.sql`        | Onboarding survey responses             |
| `diagnostics`      | `003_ai_analysis.sql`              | AI diagnostic output (health/scores)    |
| `documents`        | `001_onboarding_system.sql`        | Uploaded client documents (**overlaps Prisma docs**) |
| `expert_comments`  | `005_expert_comments.sql`          | Expert comments on diagnostics          |
| `metrics`          | `001` / `016_metrics_resolver_extensions` | Resolved metrics (**overlaps pulse_metrics**) |
| `gri_assessments`  | `021_gri_assessments.sql`          | GRI assessment data (**overlaps gri_reports**) |
| `point_a_insights` | `024_point_a_insights.sql`         | Point A narrative insights              |
| `revenue_losses`   | `010_growth_bundles.sql`           | Revenue-at-risk analysis                |
| `patient_segments` | `009_patient_segments.sql`         | Medical vertical segments               |
| `growth_bundles`   | `010_growth_bundles.sql`           | Growth bundle catalog                   |

---

## Overlapping tables — source of truth

These names exist (or represent the same concept) in **both** systems. To avoid
drift, treat the following as authoritative:

| Concept            | Prisma side                          | Supabase side        | Source of truth | Notes |
| ------------------ | ------------------------------------ | -------------------- | --------------- | ----- |
| Company            | `companies` (`Company`)              | `companies`          | **Supabase**    | End-user company is created via the onboarding flow and protected by RLS. The Pulse API and dashboards read the Supabase `companies` table. Prisma's `Company` model maps the same physical table for server-side reads — do **not** run conflicting Prisma migrations against its columns; reconcile via `013_companies_schema_reconcile.sql`. |
| Profile / Person   | `users` (`User`) + `clients` (`Client`) | `profiles`        | **Split**       | `profiles` (Supabase Auth, RLS) is the truth for end-user identity & onboarding status. `users`/`clients` (Prisma) are the truth for internal staff and the CRM-managed client roster. They are linked by id/email, not merged. |
| Documents          | `report_documents`, `document_summaries`, `document_chunks` | `documents` | **Supabase for raw uploads; Prisma for AI artifacts** | `documents` (Supabase, RLS + storage bucket policies) is the truth for uploaded files. Prisma owns derived AI artifacts (summaries, pgvector chunks). |
| GRI                | `gri_reports` (`GriReport`)          | `gri_assessments`    | **Supabase**    | `gri_assessments` (RLS, realtime) is the live assessment store written by the diagnostics pipeline. `gri_reports` is the report-generation/export record. |
| Metrics            | `pulse_metrics` (`PulseMetric`)      | `metrics`            | **Supabase**    | `metrics` is the resolved-metrics store used by the metrics resolver. `pulse_metrics` is a Prisma-side snapshot cache. |

### Rules of thumb

- **Never** create a Prisma migration that re-creates or drops a Supabase-owned
  table (`profiles`, `diagnostics`, `documents`, `survey_answers`,
  `gri_assessments`, `metrics`, `point_a_insights`, `revenue_losses`,
  `patient_segments`, `growth_bundles`). Prisma may only `@@map` to read them.
- **Never** add RLS-sensitive end-user columns to `companies` via Prisma —
  add them via a numbered Supabase migration so RLS stays correct.
- Internal CRM/admin domain changes (Users, Clients, Reports, CRM integrations,
  audit) go through Prisma.
- When in doubt: if a table has RLS policies in `supabase/migrations`, Supabase
  owns its shape.
