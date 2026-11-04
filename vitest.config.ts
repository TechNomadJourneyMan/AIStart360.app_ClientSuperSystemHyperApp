import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  // tsconfig.json sets `jsx: "preserve"` (required by Next.js), which leaves raw
  // JSX in .tsx files and breaks the transformer's import-analysis when a
  // component is imported into a test. Vite 8 uses oxc (not esbuild), so override
  // the JSX runtime here for the test transform only.
  oxc: { jsx: { runtime: 'automatic' } },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    globals: true,
    // Integration tests run against a remote Supabase pooler; round-trip latency
    // under parallel load exceeds the 5s default, so give DB-backed tests room.
    testTimeout: 30000,
    hookTimeout: 30000,
    setupFiles: ['tests/helpers/setup.ts'],
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
