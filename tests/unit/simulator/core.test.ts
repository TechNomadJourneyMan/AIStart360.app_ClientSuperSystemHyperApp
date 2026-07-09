import { describe, it, expect } from 'vitest'
import { runSimulation, type SimInput } from '@/lib/simulator/core'

function base(over: Partial<SimInput> = {}): SimInput {
  return { simType: 'revenue_growth', currentRevenueMonthly: 10_000_000, marginPct: 22, horizonMonths: 12, ...over }
}

describe('runSimulation — revenue_growth', () => {
  it('projects a compounded path toward the stated target, with optimistic > realistic > pessimistic', () => {
    const r = runSimulation(base({ targetRevenueMonthly: 20_000_000 }))
    expect(r.scenarios.realistic.monthly).toHaveLength(12)
    const end = (s: 'optimistic' | 'realistic' | 'pessimistic') => r.scenarios[s].outcome.revenueEnd
    // realistic should land near the target 20M (within its band)
    expect(end('realistic')[0]).toBeGreaterThan(15_000_000)
    expect(end('realistic')[1]).toBeGreaterThanOrEqual(20_000_000 * 0.9)
    // ordering at the end
    expect(end('optimistic')[1]).toBeGreaterThan(end('realistic')[1])
    expect(end('pessimistic')[0]).toBeLessThan(end('realistic')[0])
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

  it('without a target it uses a modest default rate and flags the assumption', () => {
    const r = runSimulation(base({ targetRevenueMonthly: null }))
    expect(r.confidence).not.toBe('high')
    expect(r.assumptions.join(' ')).toMatch(/по умолчанию|темп/i)
  })
})

describe('runSimulation — cost_reduction', () => {
  it('improves end profit versus the untouched baseline', () => {
    const withCut = runSimulation(base({ simType: 'cost_reduction', monthlyCostsFixed: 4_000_000, costCutPct: 25 }))
    const noCut = runSimulation(base({ simType: 'cost_reduction', monthlyCostsFixed: 4_000_000, costCutPct: 0 }))
    expect(withCut.scenarios.realistic.outcome.profitEnd[0]).toBeGreaterThan(noCut.scenarios.realistic.outcome.profitEnd[0])
  })
})
