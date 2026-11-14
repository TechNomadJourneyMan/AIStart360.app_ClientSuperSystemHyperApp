/**
 * R-039 (BI-42): the simulator's «realistic» pace was the pace NEEDED for the goal (confidence high — any goal
 * looked reachable), and «Антикризис» showed growth of 5%/month. Now: the base is the client's own history
 * (≥ 6 monthly points), the goal is a separate line with a verdict; without history — «нет данных для прогноза»;
 * the anti-crisis scenarios never grow above the base.
 */
import { describe, expect, it } from 'vitest'
import { runSimulation, type SimInput } from '@/lib/simulator/core'

const input = (over: Partial<SimInput> = {}): SimInput => ({
  simType: 'revenue_growth', currentRevenueMonthly: 10_000_000, marginPct: 22, horizonMonths: 12, ...over,
})
const mid = (r: [number, number]) => (r[0] + r[1]) / 2
/** 12 months growing exactly 2% a month, ending at 10 M. */
const growing2 = Array.from({ length: 12 }, (_, k) => 10_000_000 / 1.02 ** (11 - k))

describe('R-039 — the realistic scenario is a forecast, not the goal', () => {
  it('R-039: 10 M/month, goal 100 M/month in 12 months, no history → the realistic path is NOT the required 21.2%/month; «нет данных для прогноза», confidence low', () => {
    const r = runSimulation(input({ targetRevenueMonthly: 100_000_000 }))
    // before: realistic end ≈ 90–110 M (the goal by construction), confidence high
    expect(mid(r.scenarios.realistic.outcome.revenueEnd)).toBe(10_000_000)
    expect(r.confidence).toBe('low')
    expect(r.forecastAvailable).toBe(false)
    expect(r.assumptions.join(' ')).toMatch(/Нет данных для прогноза/)
    expect(r.target).not.toBeNull()
    expect(r.target!.verdict).toBe('no_forecast')
    expect(r.target!.requiredMonthlyGrowthPct).toBeCloseTo(21.15, 1)
    expect(r.target!.revenueMonthly).toBe(100_000_000)
  })

  it('R-039: with 12 months of history at +2%/month the realistic end is 10 M × 1.02^12 ≈ 12,68 M and the 100 M goal is «unrealistic»', () => {
    const r = runSimulation(input({ targetRevenueMonthly: 100_000_000, revenueHistoryMonthly: growing2 }))
    expect(r.forecastAvailable).toBe(true)
    expect(r.base.monthlyGrowthPct).toBeCloseTo(2, 6)
    expect(mid(r.scenarios.realistic.outcome.revenueEnd)).toBeCloseTo(10_000_000 * 1.02 ** 12, -1)
    expect(r.target!.verdict).toBe('unrealistic')
    expect(r.target!.gapAtEnd).toBeCloseTo(100_000_000 - 10_000_000 * 1.02 ** 12, -1)
    expect(r.confidence).not.toBe('high')
  })

  it('R-039: the goal does not change the forecast — only the verdict', () => {
    const a = runSimulation(input({ targetRevenueMonthly: 100_000_000, revenueHistoryMonthly: growing2 }))
    const b = runSimulation(input({ targetRevenueMonthly: 11_000_000, revenueHistoryMonthly: growing2 }))
    expect(a.scenarios).toEqual(b.scenarios)
    expect(b.target!.verdict).toBe('on_track')
  })

  it('R-039: goal below today’s revenue (10 M → 8 M) → «reached» (run-rate rule), and optimistic ≥ realistic ≥ pessimistic', () => {
    const r = runSimulation(input({ targetRevenueMonthly: 8_000_000, horizonMonths: 6, revenueHistoryMonthly: growing2 }))
    expect(r.target!.verdict).toBe('reached')
    const end = (k: 'optimistic' | 'realistic' | 'pessimistic') => mid(r.scenarios[k].outcome.revenueEnd)
    expect(end('optimistic')).toBeGreaterThanOrEqual(end('realistic'))
    expect(end('realistic')).toBeGreaterThanOrEqual(end('pessimistic'))
  })

  it('R-039: a shrinking business keeps the order of the scenarios (optimistic ≥ realistic ≥ pessimistic)', () => {
    const falling = Array.from({ length: 8 }, (_, k) => 10_000_000 * 1.03 ** (7 - k))
    const r = runSimulation(input({ revenueHistoryMonthly: falling, horizonMonths: 6 }))
    expect(r.base.monthlyGrowthPct).toBeCloseTo(-2.91, 1)
    const end = (k: 'optimistic' | 'realistic' | 'pessimistic') => mid(r.scenarios[k].outcome.revenueEnd)
    expect(end('optimistic')).toBeGreaterThan(end('realistic'))
    expect(end('realistic')).toBeGreaterThan(end('pessimistic'))
  })

  it('R-039: fewer than 6 months of history is not a forecast', () => {
    const r = runSimulation(input({ revenueHistoryMonthly: growing2.slice(-5) }))
    expect(r.forecastAvailable).toBe(false)
    expect(r.missingData.join(' ')).toMatch(/6 мес/)
  })

  it('R-039: without a goal and without history there is no invented 5%/month', () => {
    const r = runSimulation(input({ targetRevenueMonthly: null }))
    expect(mid(r.scenarios.realistic.outcome.revenueEnd)).toBe(10_000_000)
    expect(r.assumptions.join(' ')).not.toMatch(/5%\/мес/)
    expect(r.target).toBeNull()
  })
})

describe('R-039 — anti-crisis never shows growth above the base', () => {
  it('R-039: no history → anti-crisis is a stress test: flat at best, then falling (was +5%/month)', () => {
    const r = runSimulation(input({ simType: 'anti_crisis' }))
    for (const k of ['optimistic', 'realistic', 'pessimistic'] as const) {
      expect(mid(r.scenarios[k].outcome.revenueEnd)).toBeLessThanOrEqual(10_000_000)
    }
    expect(mid(r.scenarios.pessimistic.outcome.revenueEnd)).toBeLessThan(mid(r.scenarios.realistic.outcome.revenueEnd))
  })

  it('R-039: a growing history (+2%/month) — anti-crisis stays at or below the base, never above', () => {
    const base = runSimulation(input({ revenueHistoryMonthly: growing2 }))
    const r = runSimulation(input({ simType: 'anti_crisis', revenueHistoryMonthly: growing2 }))
    const baseEnd = mid(base.scenarios.realistic.outcome.revenueEnd)
    for (const k of ['optimistic', 'realistic', 'pessimistic'] as const) {
      const end = mid(r.scenarios[k].outcome.revenueEnd)
      expect(end).toBeLessThanOrEqual(baseEnd)
      expect(end).toBeLessThanOrEqual(10_000_000)
    }
  })

  it('R-039: a falling history (−3%/month) — anti-crisis is not better than the base', () => {
    const falling = Array.from({ length: 8 }, (_, k) => 10_000_000 * 1.03 ** (7 - k))
    const base = runSimulation(input({ revenueHistoryMonthly: falling }))
    const r = runSimulation(input({ simType: 'anti_crisis', revenueHistoryMonthly: falling }))
    expect(mid(r.scenarios.optimistic.outcome.revenueEnd)).toBeLessThanOrEqual(mid(base.scenarios.realistic.outcome.revenueEnd) + 1)
  })
})
