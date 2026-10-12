import { describe, it, expect } from 'vitest'
import { currentMetricRows } from '@/lib/metrics/company-metrics'

const row = (over: Record<string, unknown>) => ({ metric_key: 'm', metric_value: 1, source: 'survey', computed_at: '2026-10-01T00:00:00Z', period_year: null, period_quarter: null, period_month: null, ...over })

describe('currentMetricRows', () => {
  it('a more recent calendar period wins regardless of when it was computed', () => {
    const r = currentMetricRows([row({ metric_value: 2025, period_year: 2025, computed_at: '2026-01-01T00:00:00Z' }), row({ metric_value: 2024, period_year: 2024, computed_at: '2026-10-01T00:00:00Z' })])
    expect(r.get('m')!.metric_value).toBe(2025)
    const q = currentMetricRows([row({ metric_value: 'q3', period_year: 2025, period_quarter: 'Q3' }), row({ metric_value: 'q2', period_year: 2025, period_quarter: 'Q2', computed_at: '2026-10-02T00:00:00Z' })])
    expect(q.get('m')!.metric_value).toBe('q3')
  })

  it('within the same instant the survey beats a document', () => {
    const r = currentMetricRows([row({ metric_value: 14, source: 'document' }), row({ metric_value: 10, source: 'survey' })])
    expect(r.get('m')!.metric_value).toBe(10)
  })

  it('rows without a period: the newest computation', () => {
    const r = currentMetricRows([row({ metric_value: 1, computed_at: '2026-01-01T00:00:00Z' }), row({ metric_value: 2, source: 'document' })])
    expect(r.get('m')!.metric_value).toBe(2)
  })
})
