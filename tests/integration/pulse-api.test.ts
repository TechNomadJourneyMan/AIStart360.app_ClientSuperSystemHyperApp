import { describe, expect, it } from 'vitest'
import { dbTestsEnabled } from '../helpers/db-env'

// /api/pulse now authenticates via the Supabase session (the old forgeable
// `aistart360_role` cookie path was removed as a security fix), so this needs a
// live session + DB. Gated behind TEST_DATABASE_URL like the other DB suites.
describe.skipIf(!dbTestsEnabled)('pulse api', () => {
  it('calculates processedToday from actionable clients instead of hardcoded value', async () => {
    const { GET } = await import('../../app/api/pulse/route')
    const response = await GET()
    const payload = await response.json() as { stats: { processedToday: number }, todayClients: Array<{ action: string }> }

    expect(payload.stats.processedToday).toBe(payload.todayClients.length)
  })
})
