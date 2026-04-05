import { describe, expect, it } from 'vitest'

describe('pulse api', () => {
  it('calculates processedToday from actionable clients instead of hardcoded value', async () => {
    const { GET } = await import('../../app/api/pulse/route')
    const response = await GET()
    const payload = await response.json() as { stats: { processedToday: number }, todayClients: Array<{ action: string }> }

    expect(payload.stats.processedToday).toBe(payload.todayClients.length)
  })
})
