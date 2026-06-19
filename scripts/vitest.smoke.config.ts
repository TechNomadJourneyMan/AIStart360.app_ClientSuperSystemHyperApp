import { defineConfig } from 'vitest/config'
import path from 'path'

// Dedicated config for the manual LIVE AI smoke test so it never runs as part
// of the normal `npm test` suite (which would make real network calls).
export default defineConfig({
  test: {
    environment: 'node',
    include: ['scripts/ai-smoke.test.ts', 'scripts/ai-probe.test.ts'],
    globals: true,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '..'),
    },
  },
})
