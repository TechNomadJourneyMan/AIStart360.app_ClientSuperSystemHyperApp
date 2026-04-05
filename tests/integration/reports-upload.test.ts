import { describe, it, expect } from 'vitest'
import { withRollback } from '../helpers/db'

describe('reports upload metadata', () => {
  it('creates report metadata row in database', async () => {
    await withRollback(async (tx) => {
      const { createReportMetadata } = await import('../../app/actions/reports')

      const row = await createReportMetadata({
        name: 'Q1 Growth Report',
        clientName: 'Vortex Labs',
        category: 'Growth',
        type: 'pdf',
        fileUrl: '/uploads/reports/q1-growth.pdf',
        fileSizeBytes: 1024,
        uploadedBy: 'Admin User',
      }, tx)

      expect(row.id).toBeTruthy()
      expect(row.name).toBe('Q1 Growth Report')
      expect(row.clientName).toBe('Vortex Labs')
      expect(row.category).toBe('Growth')
      expect(row.fileSizeBytes).toBe(1024)
    })
  })
})
