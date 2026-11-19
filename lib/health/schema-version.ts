/**
 * lib/health/schema-version.ts — the newest migration this build ships (N5-1a).
 *
 * GET /api/health (lib/health/platform.ts) reports `schema: fail` when this file is not recorded in
 * public.schema_migrations: the code went out without its migrations (runbook §4: migrations go
 * before the code). It is a constant, not a read of supabase/migrations at runtime: the server runs
 * from a build, and what the repository looks like next to it is not something to rely on.
 *
 * Adding a migration → set it here to the new file name. CI refuses a stale value twice:
 * scripts/deploy/check-migrations.mjs (the first CI step) and tests/unit/health/schema-version.test.ts.
 */
export const NEWEST_MIGRATION = '157_crm_sync_catchup_lease_provenance.sql'
