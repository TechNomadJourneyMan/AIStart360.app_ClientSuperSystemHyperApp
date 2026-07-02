import { dbTestsEnabled } from '../helpers/db-env'
import { describe, expect, it } from 'vitest'
import { withRollback } from '../helpers/db'

describe.skipIf(!dbTestsEnabled)('analytics data', () => {
  it('returns deterministic zero-state for organization without clients and reports', async () => {
    await withRollback(async (tx) => {
      const org = await tx.organization.create({
        data: {
          name: 'Analytics Zero Org',
          slug: `analytics-zero-${Date.now().toString(36)}`,
        },
      })

      const { getAnalyticsData } = await import('../../lib/analytics-data')
      const data = await getAnalyticsData(tx, org.id)

      expect(data.kpis.avgGriScore).toBe(0)
      expect(data.kpis.portfolioGmv).toBe(0)
      expect(data.kpis.activeClients).toBe(0)
      expect(data.kpis.churnRate).toBe(0)
      expect(data.trend).toEqual([])
      expect(data.industryBreakdown).toEqual([])
      expect(data.clientPerformance).toEqual([])
    })
  })
})
