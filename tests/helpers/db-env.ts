/**
 * Gate for DB-touching integration tests.
 *
 * Test suites that create/delete rows must never run against a real
 * database. They are skipped unless a disposable LOCAL test database is
 * explicitly provided:
 *
 *   TEST_DATABASE_URL=postgres://postgres@127.0.0.1:5432/aistart360_test npm test
 *
 * A TEST_DATABASE_URL on any other host (a cloud / reserve database) is
 * refused outright — even when it is set on purpose (R-010).
 *
 * (tests/helpers/env-setup.ts maps TEST_DATABASE_URL onto DATABASE_URL /
 * DIRECT_URL for the whole test process, so app code under test uses the
 * same test DB, and refuses a non-local one there too.)
 */
import { assertLocalTestDbUrl } from './test-env-guard'

/** True when a local test DB is configured; throws on a non-local one. */
export function resolveDbTestsEnabled(env: Record<string, string | undefined>): boolean {
  const url = env.TEST_DATABASE_URL
  if (!url) return false
  assertLocalTestDbUrl('TEST_DATABASE_URL', url)
  return true
}

export const dbTestsEnabled = resolveDbTestsEnabled(process.env)
