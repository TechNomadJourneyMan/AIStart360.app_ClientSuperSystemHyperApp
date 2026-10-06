import { describe, it, expect } from 'vitest'
import { resolvedInputsFromMetricRows, resolvedInputsFromValues } from '@/lib/point-a/resolved-inputs'
import type { MetricValue } from '@/lib/metrics/types'

const value = (metricId: string, numeric: number, type: 'survey' | 'document' | 'manual'): MetricValue => ({
  metricId, value: numeric, numeric, unit: '', confidence: 0.9,
  picked: { type, key: 'k' }, considered: [], periodYear: null, periodQuarter: null, computedAt: '2026-10-06T00:00:00Z',
})

describe('resolved inputs for the Point A engine', () => {
  it('uses document / manual values only — the engine reads survey answers itself', () => {
    const out = resolvedInputsFromValues([
      value('goal.04.ltv', 400_000, 'document'),
      value('biz.marketing.cac', 50_000, 'survey'),
      value('goal.09.cac', 80_000, 'manual'),
      value('biz.finansy.valovaya_marzha', 41, 'document'),
    ])
    expect(out).toEqual({ ltv: 400_000, cac: 80_000, grossMargin: 41 })
  })

  it('from materialised rows: newest non-survey row per metric', () => {
    const out = resolvedInputsFromMetricRows([
      { metric_key: 'biz.marketing.ltv_cac', metric_value: '2.5', source: 'document', computed_at: '2026-09-01T00:00:00Z' },
      { metric_key: 'biz.marketing.ltv_cac', metric_value: '3.4', source: 'document', computed_at: '2026-10-01T00:00:00Z' },
      { metric_key: 'goal.04.ltv', metric_value: 1, source: 'survey', computed_at: '2026-10-01T00:00:00Z' },
    ])
    expect(out).toEqual({ ltvCacRatio: 3.4 })
  })
})
