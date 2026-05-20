// ============================================================
// Engine 3 — loss map unit tests.
// ============================================================

import { describe, it, expect } from 'vitest'
import {
  computeLossMap,
  emptyLossMap,
  FX_USD_KZT,
} from '@/lib/point-a/v3/loss-map'
import type { ClientBaseRow } from '@/lib/point-a/v3/client-base-loader'

const NOW = new Date('2026-05-20T00:00:00Z')

function daysAgo(n: number): string {
  return new Date(NOW.getTime() - n * 86_400_000).toISOString()
}

function row(
  id: string,
  opts: { first: number; last: number; visits: number; spent: number },
): ClientBaseRow {
  return {
    client_id: id,
    first_purchase_date: daysAgo(opts.first),
    last_purchase_date: daysAgo(opts.last),
    purchase_count: opts.visits,
    total_spent_kzt: opts.spent,
  }
}

describe('computeLossMap', () => {
  it('FX_USD_KZT constant matches spec', () => {
    expect(FX_USD_KZT).toBe(450)
  })

  it('returns empty 6-bucket map for no rows / no signals', () => {
    const res = emptyLossMap(NOW)
    expect(res.buckets).toHaveLength(6)
    expect(res.total_loss_kzt_per_year).toBe(0)
    expect(res.dominant_bucket).toBeNull()
    expect(res.has_client_base).toBe(false)
  })

  it('no_show bucket = noShow × AOV × leads × 12 (annualised)', () => {
    const res = computeLossMap([], {
      avg_check_kzt: 50_000,
      leads_per_month: 200,
      no_show_rate: 0.15,
      now: NOW,
    })
    const ns = res.buckets.find((b) => b.bucket === 'no_show')!
    // monthly 0.15 × 50_000 × 200 = 1_500_000  → yearly 18_000_000
    expect(ns.loss_kzt_per_month).toBe(1_500_000)
    expect(ns.loss_kzt_per_year).toBe(18_000_000)
    expect(ns.severity).toBe('high')
  })

  it('missed_incoming bucket = missed × AOV × leads × 12', () => {
    const res = computeLossMap([], {
      avg_check_kzt: 50_000,
      leads_per_month: 200,
      missed_rate: 0.10,
      now: NOW,
    })
    const mi = res.buckets.find((b) => b.bucket === 'missed_incoming')!
    expect(mi.loss_kzt_per_month).toBe(1_000_000)
    expect(mi.loss_kzt_per_year).toBe(12_000_000)
  })

  it('no_followup activates for one-purchase clients past the Freq×1.5 cutoff', () => {
    const rows = [
      // 1-visit, first 200d ago, cutoff = 30*1.5=45 → fires
      row('a', { first: 200, last: 200, visits: 1, spent: 80_000 }),
      // 1-visit, first 20d ago → still in the welcome window → does not fire
      row('b', { first: 20, last: 20, visits: 1, spent: 80_000 }),
      // multi-visit → never fires
      row('c', { first: 200, last: 10, visits: 4, spent: 600_000 }),
    ]
    const res = computeLossMap(rows, {
      avg_check_kzt: 100_000,
      leads_per_month: 0,
      freq_days: 30,
      now: NOW,
    })
    const f = res.buckets.find((b) => b.bucket === 'no_followup')!
    // 1 client × 100_000 / 12 ≈ 8_333 monthly → 8_333 × 12 = 99_996 yearly
    expect(f.loss_kzt_per_month).toBe(8_333)
    expect(f.loss_kzt_per_year).toBe(99_996)
  })

  it('no_upsell fires only when target_aov > actual repeat AOV', () => {
    const rows = [
      row('r1', { first: 200, last: 30, visits: 4, spent: 400_000 }), // AOV = 100k
      row('r2', { first: 200, last: 30, visits: 2, spent: 200_000 }), // AOV = 100k
    ]
    const fires = computeLossMap(rows, {
      avg_check_kzt: 100_000,
      leads_per_month: 0,
      target_aov_kzt: 150_000,
      now: NOW,
    })
    const u = fires.buckets.find((b) => b.bucket === 'no_upsell')!
    // (150_000 - 100_000) × 2 / 12 ≈ 8_333 monthly → 8_333 × 12 = 99_996 yearly
    expect(u.loss_kzt_per_month).toBe(8_333)
    expect(u.loss_kzt_per_year).toBe(99_996)

    // No firing when actual ≥ target
    const ok = computeLossMap(rows, {
      avg_check_kzt: 100_000,
      leads_per_month: 0,
      target_aov_kzt: 80_000,
      now: NOW,
    })
    expect(ok.buckets.find((b) => b.bucket === 'no_upsell')!.loss_kzt_per_year).toBe(0)
  })

  it('no_reactivation uses 20 % recovery from sleeping clients', () => {
    const rows = [
      row('s1', { first: 800, last: 400, visits: 2, spent: 100_000 }),
      row('s2', { first: 800, last: 500, visits: 3, spent: 150_000 }),
      // recency ≤365 — does not count
      row('a1', { first: 400, last: 200, visits: 2, spent: 100_000 }),
    ]
    const res = computeLossMap(rows, {
      avg_check_kzt: 50_000,
      leads_per_month: 0,
      now: NOW,
    })
    const r = res.buckets.find((b) => b.bucket === 'no_reactivation')!
    // monthly = 2 × 50_000 × 0.2 / 12 = 1_666.67 → rounds to 1_667
    expect(r.loss_kzt_per_month).toBe(1_667)
    expect(r.loss_kzt_per_year).toBe(20_004) // 1_667 * 12
  })

  it('weak_nps fires only when NPS<40', () => {
    const rows = Array.from({ length: 100 }, (_, i) =>
      row(`c${i}`, { first: 200, last: 100, visits: 2, spent: 100_000 }),
    )
    const lowNPS = computeLossMap(rows, {
      avg_check_kzt: 100_000,
      leads_per_month: 0,
      nps: 20,
      ltv_kzt: 300_000,
      now: NOW,
    })
    const w = lowNPS.buckets.find((b) => b.bucket === 'weak_nps')!
    expect(w.loss_kzt_per_month).toBeGreaterThan(0)

    const highNPS = computeLossMap(rows, {
      avg_check_kzt: 100_000,
      leads_per_month: 0,
      nps: 60,
      ltv_kzt: 300_000,
      now: NOW,
    })
    expect(highNPS.buckets.find((b) => b.bucket === 'weak_nps')!.loss_kzt_per_year).toBe(0)
  })

  it('severity classification: critical > high > medium > low', () => {
    const res = computeLossMap([], {
      avg_check_kzt: 200_000,
      leads_per_month: 500,
      no_show_rate: 0.30,         // huge monthly
      missed_rate: 0.02,          // small
      now: NOW,
    })
    const ns = res.buckets.find((b) => b.bucket === 'no_show')!
    expect(ns.severity).toBe('critical') // 30M+ annual
    const mi = res.buckets.find((b) => b.bucket === 'missed_incoming')!
    // 0.02 × 200_000 × 500 × 12 = 24_000_000  → high (>=10M)
    expect(mi.severity).toBe('high')
  })

  it('dominant_bucket picks the highest non-zero annual loss', () => {
    const res = computeLossMap([], {
      avg_check_kzt: 100_000,
      leads_per_month: 200,
      no_show_rate: 0.20,
      missed_rate: 0.05,
      now: NOW,
    })
    expect(res.dominant_bucket).toBe('no_show')
    expect(res.total_loss_kzt_per_year).toBeGreaterThan(0)
  })

  it('has_client_base reflects whether rows were provided', () => {
    expect(computeLossMap([], { avg_check_kzt: 0, leads_per_month: 0, now: NOW })
      .has_client_base).toBe(false)
    expect(
      computeLossMap(
        [row('x', { first: 50, last: 50, visits: 1, spent: 1 })],
        { avg_check_kzt: 0, leads_per_month: 0, now: NOW },
      ).has_client_base,
    ).toBe(true)
  })
})
