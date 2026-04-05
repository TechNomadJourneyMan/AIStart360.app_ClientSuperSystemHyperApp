import { describe, it, expect } from 'vitest'
import { withRollback } from '../helpers/db'

describe('dashboard KPI aggregation', () => {
  it('returns zero KPI values for a new organization with no clients and no reports', async () => {
    await withRollback(async (tx) => {
      const org = await tx.organization.create({
        data: {
          name: 'Zero KPI Org',
          slug: `zero-kpi-${Date.now().toString(36)}`,
        },
      })

      const { getDashboardKpiData } = await import('../../lib/dashboard-kpi')
      const kpi = await getDashboardKpiData(tx, org.id)

      expect(kpi.clientCount).toBe(0)
      expect(kpi.orgCount).toBe(1)
      expect(kpi.avgGri).toBe(0)
    })
  })
})
