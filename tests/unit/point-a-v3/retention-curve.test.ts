// ============================================================
// Engine 2 — retention curve unit tests.
// ============================================================

import { describe, it, expect } from 'vitest'
import {
  computeRetentionCurve,
  emptyRetentionCurve,
} from '@/lib/point-a/v3/retention-curve'
import type { ClientBaseRow } from '@/lib/point-a/v3/client-base-loader'

const NOW = new Date('2026-05-20T00:00:00Z')
const TARGETS = { 30: 75, 60: 65, 90: 60, 180: 50, 365: 40 } as const

function daysAgo(n: number): string {
  return new Date(NOW.getTime() - n * 86_400_000).toISOString()
}

function range(n: number): number[] {
  return Array.from({ length: n }, (_, i) => i)
}

function row(
  id: string,
  opts: {
    first: number
    last: number
    visits: number
    spent: number
  },
): ClientBaseRow {
  return {
    client_id: id,
    first_purchase_date: daysAgo(opts.first),
    last_purchase_date: daysAgo(opts.last),
    purchase_count: opts.visits,
    total_spent_kzt: opts.spent,
  }
}

describe('computeRetentionCurve', () => {
  it('returns the 5 spec horizons with correct targets', () => {
    const res = emptyRetentionCurve(NOW)
    const horizons = res.points.map((p) => p.horizon_days)
    expect(horizons).toEqual([30, 60, 90, 180, 365])
    for (const p of res.points) {
      expect(p.target_pct).toBe(TARGETS[p.horizon_days])
    }
    expect(res.has_client_base).toBe(false)
  })

  it('flags has_client_base=true when rows are provided', () => {
    const res = computeRetentionCurve(
      [row('a', { first: 200, last: 200, visits: 1, spent: 50_000 })],
      { now: NOW },
    )
    expect(res.has_client_base).toBe(true)
  })

  it('computes plan_slice = yearlyPlan / (365/h)', () => {
    const res = computeRetentionCurve([], {
      yearlyPlanClients: 1200,
      now: NOW,
    })
    // 30d  : 1200 / (365/30)  ≈ 98.63
    // 90d  : 1200 / (365/90)  ≈ 295.89
    // 365d : 1200 / 1         = 1200
    const p30  = res.points.find((p) => p.horizon_days === 30)!
    const p90  = res.points.find((p) => p.horizon_days === 90)!
    const p365 = res.points.find((p) => p.horizon_days === 365)!
    expect(p30.plan_slice).toBeCloseTo(1200 / (365 / 30), 1)
    expect(p90.plan_slice).toBeCloseTo(1200 / (365 / 90), 1)
    expect(p365.plan_slice).toBe(1200)
  })

  it('retention current% reflects active-span ≥ horizon over eligible cohort', () => {
    // Denominator at horizon H = cohort with tenure ≥ H (first purchase ≥H days ago)
    // Numerator = of that cohort, clients whose active span ≥ H (still engaged at H)
    // Spec direction: higher % at shorter horizons (most stick around early, fewer long-term).
    const rows: ClientBaseRow[] = [
      // All clients have tenure 200d so they are part of every H ≤ 180 cohort
      row('a1', { first: 200, last: 180, visits: 2, spent: 80_000 }), // span=20 — retained at 30 only
      row('a2', { first: 200, last: 150, visits: 2, spent: 80_000 }), // span=50 — retained at 30, not 60
      row('a3', { first: 200, last: 100, visits: 3, spent: 90_000 }), // span=100 — retained at 30/60/90
      row('a4', { first: 200, last: 200, visits: 1, spent: 50_000 }), // span=0
      row('b1', { first: 100, last: 50,  visits: 2, spent: 60_000 }), // span=50 — retained at 30
    ]
    const res = computeRetentionCurve(rows, { now: NOW })
    const byH = Object.fromEntries(res.points.map((p) => [p.horizon_days, p.current]))
    // At H=30: eligible cohort = 5 (all tenure ≥ 30). Span ≥30 = a2 (50), a3 (100), b1 (50) → 3/5 = 60%
    expect(byH[30]).toBe(60)
    // At H=60: eligible cohort = 5. Span ≥60 = a3 (100) only → 1/5 = 20%
    expect(byH[60]).toBe(20)
    // At H=180: eligible = 5. Span ≥180 = 0 → 0%
    expect(byH[180]).toBe(0)
    // Curve must descend (or stay flat).
    const horizons: number[] = [30, 60, 90, 180, 365]
    for (let i = 1; i < horizons.length; i++) {
      expect(byH[horizons[i]]).toBeLessThanOrEqual(byH[horizons[i - 1]])
    }
  })

  it('retention curve descends monotonically as horizon grows', () => {
    // Larger H = stricter "still engaged ≥ H days" filter ⇒ fewer pass.
    const rows: ClientBaseRow[] = [
      // 100 clients with assorted active spans bucketed into the 5 horizons.
      // Each tier has tenure 800d so they are eligible for every horizon.
      ...range(20).map((i) => row(`s10-${i}`,  { first: 800, last: 800 - 10,  visits: 2, spent: 100_000 })), // span=10  retained at H≤10  (none of {30,60,...})
      ...range(20).map((i) => row(`s50-${i}`,  { first: 800, last: 800 - 50,  visits: 2, spent: 100_000 })), // span=50  retained at H≤50  (30 only)
      ...range(20).map((i) => row(`s80-${i}`,  { first: 800, last: 800 - 80,  visits: 2, spent: 100_000 })), // span=80  retained at 30,60
      ...range(20).map((i) => row(`s150-${i}`, { first: 800, last: 800 - 150, visits: 2, spent: 100_000 })), // span=150 retained at 30,60,90
      ...range(20).map((i) => row(`s400-${i}`, { first: 800, last: 800 - 400, visits: 2, spent: 100_000 })), // span=400 retained at all 5
    ]
    const res = computeRetentionCurve(rows, { now: NOW })
    const byH = Object.fromEntries(res.points.map((p) => [p.horizon_days, p.current]))
    // Cohort size = 100 (all tenure 800 ≥ every H).
    // H=30:  retained s50+s80+s150+s400 = 80/100 = 80%
    // H=60:  retained s80+s150+s400 = 60/100 = 60%
    // H=90:  retained s150+s400 = 40/100 = 40%
    // H=180: retained s400 = 20/100 = 20%
    // H=365: retained s400 (span=400≥365) = 20%
    expect(byH[30]).toBe(80)
    expect(byH[60]).toBe(60)
    expect(byH[90]).toBe(40)
    expect(byH[180]).toBe(20)
    expect(byH[365]).toBe(20)
    // Strict non-ascending check.
    const horizons: number[] = [30, 60, 90, 180, 365]
    for (let i = 1; i < horizons.length; i++) {
      expect(byH[horizons[i]]).toBeLessThanOrEqual(byH[horizons[i - 1]])
    }
  })

  it('different horizons produce different percentages on a mixed cohort', () => {
    // Spec smoke check: curve should NOT be flat across all 5 horizons.
    const rows: ClientBaseRow[] = [
      row('a', { first: 800, last: 800 - 10,  visits: 2, spent: 100_000 }),
      row('b', { first: 800, last: 800 - 50,  visits: 2, spent: 100_000 }),
      row('c', { first: 800, last: 800 - 80,  visits: 2, spent: 100_000 }),
      row('d', { first: 800, last: 800 - 150, visits: 2, spent: 100_000 }),
      row('e', { first: 800, last: 800 - 300, visits: 2, spent: 100_000 }),
    ]
    const res = computeRetentionCurve(rows, { now: NOW })
    const pcts = res.points.map((p) => p.current)
    const unique = new Set(pcts)
    expect(unique.size).toBeGreaterThan(1)
  })

  it('current is 0 when no client has an active span ≥ horizon', () => {
    // Single-purchase clients have span=0 — they cannot be retained at any H>0.
    const rows = [
      row('a', { first: 200, last: 200, visits: 1, spent: 80_000 }),
      row('b', { first: 200, last: 200, visits: 1, spent: 80_000 }),
    ]
    const res = computeRetentionCurve(rows, { now: NOW })
    for (const p of res.points) expect(p.current).toBe(0)
  })

  it('falls back to 0 plan_slice when yearlyPlan is not provided', () => {
    const res = computeRetentionCurve([], { now: NOW })
    expect(res.points.every((p) => p.plan_slice === 0)).toBe(true)
  })

  it('fact equals the number of retained clients (descends with horizon)', () => {
    // Active span = horizon ⇒ retained at all H ≤ span.
    const rows = [
      row('a', { first: 800, last: 800 - 200, visits: 2, spent: 100_000 }), // span=200
      row('b', { first: 800, last: 800 - 200, visits: 2, spent: 100_000 }),
      row('c', { first: 800, last: 800 - 50,  visits: 2, spent: 100_000 }), // span=50
    ]
    const res = computeRetentionCurve(rows, { now: NOW })
    const p30 = res.points.find((p) => p.horizon_days === 30)!
    const p180 = res.points.find((p) => p.horizon_days === 180)!
    const p365 = res.points.find((p) => p.horizon_days === 365)!
    expect(p30.fact).toBe(3)   // all spans ≥30
    expect(p180.fact).toBe(2)  // a, b
    expect(p365.fact).toBe(0)  // none ≥365
  })
})
