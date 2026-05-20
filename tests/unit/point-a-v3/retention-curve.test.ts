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

  it('retention current% reflects repeat-within-horizon clients', () => {
    // Two cohorts:
    //   - 4 clients first-purchased 200d ago; 3 of them had a 2nd visit within 30d
    //   - 4 clients first-purchased 100d ago; 1 of them returned within 30d
    const rows: ClientBaseRow[] = [
      // 200d cohort
      row('a1', { first: 200, last: 180, visits: 2, spent: 80_000 }), // spread=20d → retained at 30d
      row('a2', { first: 200, last: 195, visits: 2, spent: 80_000 }), // spread=5d  → retained at 30d
      row('a3', { first: 200, last: 197, visits: 3, spent: 90_000 }), // spread=3d  → retained at 30d
      row('a4', { first: 200, last: 200, visits: 1, spent: 50_000 }), // one-time   → not retained
      // 100d cohort
      row('b1', { first: 100, last: 95,  visits: 2, spent: 60_000 }),
      row('b2', { first: 100, last: 100, visits: 1, spent: 40_000 }),
      row('b3', { first: 100, last: 100, visits: 1, spent: 40_000 }),
      row('b4', { first: 100, last: 100, visits: 1, spent: 40_000 }),
    ]
    const res = computeRetentionCurve(rows, { now: NOW })
    const p30 = res.points.find((p) => p.horizon_days === 30)!
    // 30d cohort = first 30..365 days ago = all 8 clients
    // retained = a1,a2,a3 (spread≤30) + b1 (spread=5) = 4
    // current = 4/8 = 50%
    expect(p30.current).toBe(50)
  })

  it('current is 0 when no client has another purchase within the horizon', () => {
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

  it('fact column counts purchases inside the trailing horizon window', () => {
    const rows = [
      // 2 purchases spread over 60d, last 10d ago — should land in the 30d window once
      row('a', { first: 60, last: 10, visits: 2, spent: 100_000 }),
    ]
    const res = computeRetentionCurve(rows, { now: NOW })
    const p30 = res.points.find((p) => p.horizon_days === 30)!
    expect(p30.fact).toBeGreaterThanOrEqual(1)
    const p365 = res.points.find((p) => p.horizon_days === 365)!
    expect(p365.fact).toBeGreaterThanOrEqual(p30.fact)
  })
})
