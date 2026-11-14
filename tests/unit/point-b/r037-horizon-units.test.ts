/**
 * R-037 (BI-21): Точка Б V2 — the monthly trajectory is the ANNUAL run-rate; the «Месяц» / «Квартал»
 * horizons must show the revenue OF the month / quarter, not the run-rate.
 *
 * Golden example of the BI audit: 10 M ₸ a month (120 M a year), goal 200 M a year in 12 months.
 *   required path (the model's growth formula): run-rate_t = 120 M · (200/120)^(t/12)
 *   run-rate month 1 = 125 218 542 ₸ → revenue of month 1 = 125 218 542 / 12 ≈ 10 434 878 ₸
 *   revenue of quarter 1 = Σ_{t=1..3} run-rate_t / 12 ≈ 32 684 778 ₸
 * Before the fix the «Месяц» horizon showed 125 218 542 ₸ «за месяц» and the quarter 136 346 324 ₸.
 */
import { describe, expect, it } from 'vitest'
import type { PointA } from '@/types/onboarding'
import { buildTrajectory, calculatePointBV2 } from '@/lib/point-b/engine'
import { projectGrowth, requiredAnnualGrowth } from '@/lib/point-b/model/growth'

function pointA(): PointA {
  const b = (score: number) => ({ score, status: 'average', top_issues: [], recommendations: [] })
  return {
    overall_score: 55, health_index: 50, stage: 'growth',
    blocks: { finance: b(45), marketing: b(50), operations: b(60), strategy: b(55), sales: b(48) },
    risks: [], insights: [], quick_wins: [], data_gaps: [],
  } as unknown as PointA
}

const RR1 = 120_000_000 * (200 / 120) ** (1 / 12)
const RR2 = 120_000_000 * (200 / 120) ** (2 / 12)
const RR3 = 120_000_000 * (200 / 120) ** (3 / 12)

describe('R-037 — V2 horizons: monthly / quarterly revenue, not the annual run-rate', () => {
  const pb = calculatePointBV2(pointA(), {}, { currentRevenueYear: 120_000_000, goal12mYear: 200_000_000 })

  it('R-037: «План на месяц» — revenue of month 1 ≈ 10,43 M (was 125,2 M)', () => {
    expect(pb.horizons.month.target_revenue).toBe(Math.round(RR1 / 12))
    expect(pb.horizons.month.target_revenue).toBe(10_434_878)
    expect(pb.horizons.month.kpis).toEqual([{ label: 'Выручка за месяц', target: `${(10_434_878).toLocaleString('ru-RU')} ₸` }])
  })

  it('R-037: «Квартальный фокус» — revenue of quarter 1 ≈ 32,68 M (was 136,3 M)', () => {
    const expected = Math.round((RR1 + RR2 + RR3) / 12)
    expect(Math.abs((pb.horizons.quarter.target_revenue as number) - expected)).toBeLessThanOrEqual(1) // whole tenge
    expect(expected).toBeGreaterThan(32_000_000)
    expect(expected).toBeLessThan(34_000_000)
    expect(pb.horizons.quarter.kpis[0].label).toBe('Выручка за квартал')
  })

  it('R-037: the trajectory stays the annual run-rate (as on «Обзор») and carries the monthly revenue next to it', () => {
    const t = pb.trajectory.monthly_12m
    expect(t[0].target_revenue).toBe(Math.round(RR1))
    expect(t[0].monthly_revenue).toBe(Math.round(RR1 / 12))
    expect(t[11].target_revenue).toBe(200_000_000)
    expect(t[11].monthly_revenue).toBe(Math.round(200_000_000 / 12))
  })

  it('R-037: buildTrajectory is the model formula (projectGrowth at the required growth) — V2 and «Обзор» agree', () => {
    const g = requiredAnnualGrowth(120_000_000, 200_000_000, 12) as number
    const model = projectGrowth({ baseAnnual: 120_000_000, annualGrowth: g, months: 12 })
    const v2 = buildTrajectory(120_000_000, 200_000_000, 12)
    expect(v2.map((p) => p.target_revenue)).toEqual(model.map((v) => Math.round(v)))
  })

  it('R-037: the 3-year path by quarters — run-rate at the quarter end, revenue of the quarter = Σ of its months / 12', () => {
    const pb3 = calculatePointBV2(pointA(), {}, { currentRevenueYear: 120_000_000, goal12mYear: 200_000_000, goal3yYear: 480_000_000 })
    const q = pb3.trajectory.quarterly_3y
    expect(q).toHaveLength(12)
    const rr = (t: number) => 120_000_000 * 4 ** (t / 36)
    expect(q[0].target_revenue).toBe(Math.round(rr(3)))
    expect(Math.abs((q[0].quarter_revenue as number) - (rr(1) + rr(2) + rr(3)) / 12)).toBeLessThanOrEqual(1)
    expect(q[11].target_revenue).toBe(480_000_000)
  })
})
