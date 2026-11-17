/**
 * The test files that change the schema of the shared test database run after all the others, one
 * at a time (vitest.config.ts). In parallel they deadlocked with the other DB tests (Postgres log of
 * the test server 2026-11-16/17: the rollback of migration 150 vs a test's transaction holding
 * `profiles`), and the migration-150 test failed now and then under a full run.
 */
import { describe, expect, it } from 'vitest'
import config, { SCHEMA_CHANGE, schemaChangingTests } from '../../../vitest.config'

type Project = { test?: { name?: string; include?: string[]; exclude?: string[]; fileParallelism?: boolean; sequence?: { groupOrder?: number } } }

describe('vitest: schema-changing DB tests run serially, last', () => {
  const serial = schemaChangingTests()

  it('finds every test file that re-runs a migration or changes the schema', () => {
    for (const f of [
      'tests/integration/db/point-a-ai-review.test.ts', // migration 150 and its rollback
      'tests/integration/db/rollback-141-142.test.ts',
      'tests/integration/db/expert-sla.test.ts',
      'tests/integration/db/diagnostics-fixes.test.ts', // DROP INDEX
      'tests/integration/db/expert-sla-clients-only.test.ts', // ALTER TABLE … DISABLE TRIGGER
      'tests/integration/db/ops-job-runs.test.ts', // DROP TABLE
    ]) expect(serial).toContain(f)
  })

  it('leaves the ordinary DB tests in the parallel project', () => {
    expect(serial).not.toContain('tests/integration/db/backup.test.ts')
    expect(serial.every((f) => f.startsWith('tests/integration/'))).toBe(true)
  })

  it('the pattern: DDL and migration files yes, plain queries no', () => {
    for (const yes of [
      "readFileSync('supabase/migrations/150_point_a_ai_review.sql')",
      'ALTER TABLE public.diagnostics ADD COLUMN x TEXT',
      'CREATE OR REPLACE FUNCTION public.f() RETURNS void',
      'DROP INDEX IF EXISTS public.i',
      'CREATE UNIQUE INDEX i ON public.t (a)',
      'DROP POLICY p ON public.t',
    ]) expect(SCHEMA_CHANGE.test(yes), yes).toBe(true)
    for (const no of [
      'SELECT * FROM public.profiles',
      'INSERT INTO public.diagnostics (user_id) VALUES ($1)',
      "UPDATE public.profiles SET status = 'approved'",
      'DELETE FROM public.admin_requests',
    ]) expect(SCHEMA_CHANGE.test(no), no).toBe(false)
  })

  it('two projects: everything else first in parallel, the schema-changing files after, one file at a time', () => {
    const root = (config as { test?: { include?: string[]; projects?: Project[] } }).test
    // `extends: true` merges arrays with the root's: a root include would put every file into both
    // projects (each test ran twice when it was there).
    expect(root?.include).toBeUndefined()
    const projects = root?.projects ?? []
    const [main, ddl] = projects
    expect(main.test?.name).toBe('tests')
    expect(main.test?.include).toEqual(['tests/**/*.test.ts'])
    expect(main.test?.sequence?.groupOrder).toBe(0)
    for (const f of serial) expect(main.test?.exclude).toContain(f)
    expect(ddl.test?.name).toBe('schema-changing')
    expect(ddl.test?.include).toEqual(serial)
    expect(ddl.test?.fileParallelism).toBe(false)
    expect(ddl.test?.sequence?.groupOrder).toBe(1)
  })
})
