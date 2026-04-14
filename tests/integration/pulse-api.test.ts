import { describe, expect, it } from 'vitest'
import { NextRequest } from 'next/server'

describe('pulse api', () => {
  it('calculates processedToday from actionable clients instead of hardcoded value', async () => {
    const { GET } = await import('../../app/api/pulse/route')
    // Create a mock request with admin role cookies so all deals are visible
    const req = new NextRequest('http://localhost:3000/api/pulse', {
      headers: { cookie: 'aistart360_role=admin; aistart360_user_id=test-user' },
    })
    const response = await GET(req)
    const payload = await response.json() as { stats: { processedToday: number }, todayClients: Array<{ action: string }> }

    expect(payload.stats.processedToday).toBe(payload.todayClients.length)
  })
})
