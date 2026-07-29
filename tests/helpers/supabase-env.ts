/**
 * Gate for Supabase-touching integration tests.
 *
 * These suites call `auth.admin.createUser()` and insert into `profiles`,
 * `companies`, `diagnostics` and friends. `.env` carries the PRODUCTION
 * Supabase project, so keying them off NEXT_PUBLIC_SUPABASE_URL +
 * SUPABASE_SERVICE_ROLE_KEY means a plain `npm test` starts creating users in
 * the live project the moment a real service-role key is present. They are
 * skipped unless a disposable Supabase project is explicitly provided:
 *
 *   TEST_SUPABASE_URL=https://xxx.supabase.co \
 *   TEST_SUPABASE_SERVICE_ROLE_KEY=eyJ... npm test
 *
 * This mirrors the TEST_DATABASE_URL gate in tests/helpers/db-env.ts.
 */
export const TEST_SUPABASE_URL = process.env.TEST_SUPABASE_URL ?? ''
export const TEST_SUPABASE_SERVICE_ROLE_KEY = process.env.TEST_SUPABASE_SERVICE_ROLE_KEY ?? ''

export const supabaseTestsEnabled = Boolean(TEST_SUPABASE_URL && TEST_SUPABASE_SERVICE_ROLE_KEY)
