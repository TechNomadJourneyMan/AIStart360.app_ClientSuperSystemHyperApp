// ============================================================
// Engine 1 — RFM segmentation unit tests.
// ============================================================

import { describe, it, expect } from 'vitest'
import { computeRFM, emptyRFMResult } from '@/lib/point-a/v3/rfm'
import type { ClientBaseRow } from '@/lib/point-a/v3/client-base-loader'

const NOW = new Date('2026-05-20T00:00:00Z')

function daysAgo(n: number): string {
  return new Date(NOW.getTime() - n * 86_400_000).toISOString()
}

function row(
  id: string,
  opts: {
    first: number   // days ago
    last: number    // days ago
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

describe('computeRFM', () => {
  it('returns an empty 7-row result for an empty base', () => {
    const res = computeRFM([], { now: NOW })
    expect(res.has_client_base).toBe(false)
    expect(res.segments).toHaveLength(7)
    expect(res.total_clients).toBe(0)
    expect(res.segments.every((s) => s.count === 0)).toBe(true)
  })

  it('emptyRFMResult is stable and spec-ordered', () => {
    const empty = emptyRFMResult(NOW)
    expect(empty.segments.map((s) => s.segment)).toEqual([
      'vip_retention',
      'vip_reactivation',
      'loyal_active',
      'churn_risk',
      'sleeping',
      'onetime_fresh',
      'onetime_old',
    ])
  })

  it('classifies a single one-time fresh client', () => {
    const res = computeRFM([row('c1', { first: 30, last: 30, visits: 1, spent: 50_000 })], { now: NOW })
    const fresh = res.segments.find((s) => s.segment === 'onetime_fresh')!
    expect(fresh.count).toBe(1)
    expect(fresh.share_pct).toBe(100)
    expect(fresh.avg_check_kzt).toBe(50_000)
  })

  it('classifies a single one-time old client', () => {
    const res = computeRFM([row('c1', { first: 300, last: 300, visits: 1, spent: 50_000 })], { now: NOW })
    expect(res.segments.find((s) => s.segment === 'onetime_old')!.count).toBe(1)
  })

  it('produces all 7 buckets when the base spans the spec rules', () => {
    const rows: ClientBaseRow[] = [
      // 2 VIPs (Freq≥4, top-20% monetary, R≤90)
      row('vip1', { first: 400, last: 10, visits: 6, spent: 5_000_000 }),
      row('vip2', { first: 500, last: 20, visits: 5, spent: 4_800_000 }),
      // 1 VIP reactivation (top-20% but R 90-365)
      row('vipR1', { first: 600, last: 200, visits: 5, spent: 4_500_000 }),
      // 2 loyal active (R≤90, F 2-3, monetary 21-60%)
      row('loy1', { first: 200, last: 30, visits: 3, spent: 800_000 }),
      row('loy2', { first: 250, last: 40, visits: 2, spent: 700_000 }),
      // 2 churn risk (R 180-365, F 2-3)
      row('cr1', { first: 500, last: 200, visits: 3, spent: 400_000 }),
      row('cr2', { first: 500, last: 250, visits: 2, spent: 350_000 }),
      // 2 sleeping (R > 365, F≥2)
      row('sl1', { first: 800, last: 400, visits: 2, spent: 200_000 }),
      row('sl2', { first: 900, last: 500, visits: 3, spent: 220_000 }),
      // 3 one-time fresh
      row('of1', { first: 60, last: 60, visits: 1, spent: 100_000 }),
      row('of2', { first: 90, last: 90, visits: 1, spent: 80_000 }),
      row('of3', { first: 120, last: 120, visits: 1, spent: 60_000 }),
      // 2 one-time old
      row('oo1', { first: 400, last: 400, visits: 1, spent: 40_000 }),
      row('oo2', { first: 500, last: 500, visits: 1, spent: 30_000 }),
    ]
    const res = computeRFM(rows, { now: NOW })

    expect(res.has_client_base).toBe(true)
    expect(res.total_clients).toBe(14)

    const byId = Object.fromEntries(res.segments.map((s) => [s.segment, s.count]))
    expect(byId.vip_retention).toBeGreaterThanOrEqual(1)
    expect(byId.vip_reactivation).toBeGreaterThanOrEqual(1)
    expect(byId.churn_risk).toBeGreaterThanOrEqual(1)
    expect(byId.sleeping).toBeGreaterThanOrEqual(2)
    expect(byId.onetime_fresh).toBe(3)
    expect(byId.onetime_old).toBe(2)

    // Sum invariant.
    const sum = res.segments.reduce((s, x) => s + x.count, 0)
    expect(sum).toBe(14)

    // Suggested actions present, in Russian.
    expect(res.segments.find((s) => s.segment === 'vip_retention')!.suggested_action_ru)
      .toBe('Программа лояльности')
    expect(res.segments.find((s) => s.segment === 'churn_risk')!.suggested_action_ru)
      .toBe('Win-back серия + скидка 15%')
  })

  it('share_pct rows sum to ~100', () => {
    const rows = [
      row('a', { first: 50, last: 50, visits: 1, spent: 10_000 }),
      row('b', { first: 50, last: 50, visits: 1, spent: 10_000 }),
      row('c', { first: 50, last: 50, visits: 1, spent: 10_000 }),
    ]
    const res = computeRFM(rows, { now: NOW })
    const total = res.segments.reduce((s, x) => s + x.share_pct, 0)
    expect(Math.round(total)).toBe(100)
  })

  it('aggregates revenue and avg_check correctly per bucket', () => {
    const rows = [
      row('a', { first: 30, last: 30, visits: 1, spent: 100_000 }),
      row('b', { first: 60, last: 60, visits: 1, spent: 200_000 }),
    ]
    const res = computeRFM(rows, { now: NOW })
    const fresh = res.segments.find((s) => s.segment === 'onetime_fresh')!
    expect(fresh.count).toBe(2)
    expect(fresh.total_revenue_kzt).toBe(300_000)
    expect(fresh.avg_check_kzt).toBe(150_000)
  })
})
