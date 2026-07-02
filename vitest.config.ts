import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  // tsconfig sets jsx:"preserve" for Next, which makes the transformer skip
  // JSX per-file. Vitest 4 runs on rolldown-vite (oxc, not esbuild), so the
  // override lives under `oxc` — it lets component tests import .tsx files.
  oxc: {
    jsx: { runtime: 'automatic', importSource: 'react' },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
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
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
})
