/**
 * Gate for DB-touching integration tests.
 *
 * .env's DATABASE_URL points at the PRODUCTION Supabase — test suites that
 * create/delete rows must never run against it. They are skipped unless a
 * disposable test database is explicitly provided:
 *
 *   TEST_DATABASE_URL=postgres://... npm test
 *
 * (tests/helpers/env-setup.ts maps TEST_DATABASE_URL onto DATABASE_URL for
 * the whole test process, so app code under test uses the same test DB.)
 */
export const dbTestsEnabled = Boolean(process.env.TEST_DATABASE_URL)
