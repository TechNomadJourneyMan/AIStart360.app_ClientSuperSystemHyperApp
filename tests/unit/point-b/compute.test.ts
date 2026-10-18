import { describe, it, expect } from 'vitest'
import { computePointB } from '@/lib/point-b/compute'
import { diagToPointA } from '@/lib/point-b/adapters'
import type { PointBInputs } from '@/lib/point-b/inputs'

const block = (score: number) => ({ score, status: 'average', top_issues: [], recommendations: [] })
const diagnostic = {
  id: 'd1', overall_score: 55, health_index: 50, stage: 'growth',
  finance_score: block(60), sales_score: block(0), operations_score: block(55), marketing_score: block(45), strategy_score: block(40),
}

function inputs(over: Partial<PointBInputs> = {}): PointBInputs {
  return {
    userId: 'u1',
    companyId: 'c1',
    diagnostic,
    snapshot: { id: 's1', engine: 'v4', confidence: 0.62, coverage: 0.7, createdAt: '2026-10-10T00:00:00Z' },
    blocksWithoutData: ['sales'],
    pointA: diagToPointA(diagnostic),
    answers: {},
    griTop5: undefined,
    metricOptions: { currentRevenueYear: 60_000_000, metrics: {} },
    goal12mYear: 120_000_000,
    goal3yYear: 600_000_000,
    base: { revenue: 60_000_000, period: '2024', ageMonths: 22, stale: true },
    ...over,
  }
}

describe('computePointB', () => {
  it('returns null without a diagnostic', () => {
    expect(computePointB(inputs({ diagnostic: null, pointA: null }))).toBeNull()
  })

  it('passes snapshot confidence and coverage into data_quality', () => {
    const pb = computePointB(inputs())!
    expect(pb.diagnostic_id).toBe('d1')
    expect(pb.data_quality.snapshot).toEqual({ id: 's1', confidence: 0.62, coverage: 0.7 })
    expect(pb.data_quality.blocks_without_data).toEqual(['sales'])
    expect(pb.data_quality.base.stale).toBe(true)
    expect(pb.gap.find((g) => g.horizon === '12m')!.target_revenue).toBe(120_000_000)
  })

  it('has no snapshot in data_quality when there is none', () => {
    const pb = computePointB(inputs({ snapshot: null, blocksWithoutData: [] }))!
    expect(pb.data_quality.snapshot).toBeNull()
  })
})
