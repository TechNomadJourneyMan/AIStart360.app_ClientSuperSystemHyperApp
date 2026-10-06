import { describe, expect, it } from 'vitest'
import { historyToPoints, periodEnd } from '@/lib/metrics/timeseries-fetch'

const row = (p: Partial<Parameters<typeof historyToPoints>[0][number]>) => ({
  value: 1, source: 'survey', period_year: null, period_quarter: null, period_month: null, recorded_at: '2026-01-01T00:00:00Z', ...p,
})

describe('metric history → timeseries', () => {
  it('builds a series by business period with the latest value of each period', () => {
    const pts = historyToPoints([
      row({ period_year: 2024, value: 80, recorded_at: '2026-01-01T00:00:00Z' }),
      row({ period_year: 2023, value: 60, recorded_at: '2026-01-01T00:00:00Z' }),
      row({ period_year: 2024, value: 84, recorded_at: '2026-02-01T00:00:00Z' }), // corrected later
      row({ period_year: 2025, value: 95, recorded_at: '2026-01-01T00:00:00Z' }),
    ], null)
    expect(pts.map((p) => [p.label, p.value])).toEqual([['2023', 60], ['2024', 84], ['2025', 95]])
    expect(pts[0].timestamp).toBe('2023-12-31T00:00:00.000Z')
  })

  it('places quarters and months at their end', () => {
    expect(periodEnd({ period_year: 2025, period_quarter: 'Q2', period_month: null })?.toISOString()).toBe('2025-06-30T00:00:00.000Z')
    expect(periodEnd({ period_year: 2025, period_quarter: null, period_month: 2 })?.toISOString()).toBe('2025-02-28T00:00:00.000Z')
    expect(periodEnd({ period_year: null, period_quarter: null, period_month: null })).toBeNull()
  })

  it('without periods: change events by time, filtered by the cutoff', () => {
    const pts = historyToPoints([
      row({ value: 10, recorded_at: '2026-01-01T00:00:00Z' }),
      row({ value: 12, recorded_at: '2026-03-01T00:00:00Z' }),
      row({ value: null, recorded_at: '2026-03-02T00:00:00Z' }),
    ], '2026-02-01T00:00:00Z')
    expect(pts.map((p) => p.value)).toEqual([12])
  })
})
