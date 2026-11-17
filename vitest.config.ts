import { defineConfig, configDefaults } from 'vitest/config'
import { readdirSync, readFileSync } from 'node:fs'
import path from 'path'

/**
 * Test files that change the schema of the shared test database — they re-run a migration or its
 * rollback, or ALTER / DROP / CREATE a table, index, trigger, policy or function — take ACCESS
 * EXCLUSIVE locks inside their transactions. Run in parallel with the other DB tests they
 * deadlocked with them: the Postgres log of the test server, 2026-11-16 and 2026-11-17, shows the
 * rollback of migration 150 waiting for `profiles` while another test's transaction held `profiles`
 * and waited for `diagnostics`; Postgres killed the migration test («deadlock detected»), so it
 * failed now and then under a full run and passed alone. They now run as their own project, AFTER
 * all the other files and one file at a time, so nothing holds a lock they need. They are found by
 * their content: a new test of that kind joins the serial project without anyone listing it.
 */
export const SCHEMA_CHANGE = /supabase\/migrations\/|\b(?:ALTER|DROP|CREATE(?:\s+OR\s+REPLACE)?)\s+(?:TABLE|(?:UNIQUE\s+)?INDEX|TRIGGER|POLICY|FUNCTION)\b/

export function schemaChangingTests(root: string = __dirname): string[] {
  const dir = path.join(root, 'tests/integration')
  return (readdirSync(dir, { recursive: true }) as string[])
    .filter((f) => f.endsWith('.test.ts'))
    .map((f) => path.posix.join('tests/integration', f.split(path.sep).join('/')))
    .filter((f) => SCHEMA_CHANGE.test(readFileSync(path.join(root, f), 'utf8')))
    .sort()
}

const SERIAL = schemaChangingTests()

export default defineConfig({
  // tsconfig sets jsx:"preserve" for Next, which makes the transformer skip
  // JSX per-file. Vitest 4 runs on rolldown-vite (oxc, not esbuild), so the
  // override lives under `oxc` — it lets component tests import .tsx files.
  oxc: {
    jsx: { runtime: 'automatic', importSource: 'react' },
  },
  test: {
    environment: 'node',
    // No `include` here: a project with `extends: true` MERGES its arrays with the root's, so a root
    // include would put every file into the serial project too. Each project names its own files.
    globals: true,
    // Integration tests may talk to a remote test DB — 5s is too tight.
    testTimeout: 15000,
    // env-setup must run first: it re-points DATABASE_URL at
    // TEST_DATABASE_URL before any PrismaClient is constructed.
    setupFiles: ['tests/helpers/env-setup.ts', 'tests/helpers/setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['app/actions/**', 'middleware.ts'],
    },
    projects: [
      {
        extends: true,
        test: {
          name: 'tests',
          include: ['tests/**/*.test.ts'],
          exclude: [...configDefaults.exclude, ...SERIAL],
          sequence: { groupOrder: 0 },
        },
      },
      {
        extends: true,
        test: {
          name: 'schema-changing',
          include: SERIAL,
          // one file at a time, after every file of the project above has finished
          fileParallelism: false,
          sequence: { groupOrder: 1 },
        },
      },
    ],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
})
