import { describe, it, expect } from 'vitest'
import { runSimulation, type SimInput } from '@/lib/simulator/core'

function base(over: Partial<SimInput> = {}): SimInput {
  return { simType: 'revenue_growth', currentRevenueMonthly: 10_000_000, marginPct: 22, horizonMonths: 12, ...over }
}

describe('runSimulation — revenue_growth', () => {
  // R-039: this test used to require the realistic path to land on the target (the goal WAS the forecast).
  // Now the pace comes from the history and the goal is a separate line with a verdict.
  it('projects a compounded path from the history pace, with optimistic > realistic > pessimistic; the goal is a separate line', () => {
    const history = Array.from({ length: 12 }, (_, k) => 10_000_000 / 1.03 ** (11 - k))
    const r = runSimulation(base({ targetRevenueMonthly: 20_000_000, revenueHistoryMonthly: history }))
    expect(r.scenarios.realistic.monthly).toHaveLength(12)
    const end = (s: 'optimistic' | 'realistic' | 'pessimistic') => r.scenarios[s].outcome.revenueEnd
    // realistic = 10 M × 1.03^12 ≈ 14.26 M (the band ±10%), not the 20 M goal
    expect((end('realistic')[0] + end('realistic')[1]) / 2).toBeCloseTo(10_000_000 * 1.03 ** 12, -1)
    expect(end('optimistic')[1]).toBeGreaterThan(end('realistic')[1])
    expect(end('pessimistic')[0]).toBeLessThan(end('realistic')[0])
    expect(r.target!.verdict).toBe('unrealistic') // optimistic 10 M × 1.04^12 ≈ 16 M < 20 M
  })

  it('every monthly point is a [low, high] range with low <= high', () => {
    const r = runSimulation(base({ targetRevenueMonthly: 15_000_000 }))
    for (const s of ['optimistic', 'realistic', 'pessimistic'] as const) {
      for (const m of r.scenarios[s].monthly) {
        expect(m.revenueRange[0]).toBeLessThanOrEqual(m.revenueRange[1])
      }
    }
  })

  it('never presents a forecast as certain — always carries assumptions and a confidence level', () => {
    const r = runSimulation(base({ targetRevenueMonthly: 20_000_000 }))
    expect(r.assumptions.length).toBeGreaterThan(0)
    expect(['low', 'medium', 'high']).toContain(r.confidence)
  })

  it('degrades honestly with no current revenue (low confidence, missing data)', () => {
    const r = runSimulation(base({ currentRevenueMonthly: 0, targetRevenueMonthly: 20_000_000 }))
    expect(r.confidence).toBe('low')
    expect(r.missingData.join(' ')).toMatch(/выручк/i)
  })

  // R-039: no invented 5%/month any more — without history there is no forecast, said in the result.
  it('without a target and without history it says there is no data for a forecast', () => {
    const r = runSimulation(base({ targetRevenueMonthly: null }))
    expect(r.confidence).not.toBe('high')
    expect(r.forecastAvailable).toBe(false)
    expect(r.assumptions.join(' ')).toMatch(/Нет данных для прогноза/)
  })
})

describe('runSimulation — cost_reduction', () => {
  it('improves end profit versus the untouched baseline', () => {
    const withCut = runSimulation(base({ simType: 'cost_reduction', monthlyCostsFixed: 4_000_000, costCutPct: 25 }))
    const noCut = runSimulation(base({ simType: 'cost_reduction', monthlyCostsFixed: 4_000_000, costCutPct: 0 }))
    expect(withCut.scenarios.realistic.outcome.profitEnd[0]).toBeGreaterThan(noCut.scenarios.realistic.outcome.profitEnd[0])
  })
})
