/**
 * I2 — growth bundles have no invented average check: without amounts in the
 * base the revenue estimate is «нет данных» (null), not 10 000 ₸ × patients.
 */
import { describe, it, expect } from 'vitest'
import { computeBundles } from '@/lib/clinic-bundles'
import type { SegmentationResult } from '@/lib/rfm-segmentation'

function seg(avgCheck: number): SegmentationResult {
  return {
    totals: { avg_check_kzt: avgCheck },
    summary: [{ segment: 'sleeping', count: 40 }, { segment: 'churn_risk', count: 25 }, { segment: 'loyal_active', count: 10 }],
  } as unknown as SegmentationResult
}

describe('computeBundles', () => {
  it('no average check → estimated revenue null for every bundle (no 10 000 ₸ default)', () => {
    const b = computeBundles(seg(0))
    expect(b.length).toBeGreaterThan(0)
    expect(b.every((x) => x.estimated_revenue_kzt === null)).toBe(true)
    // still ordered: by the patients reached
    expect(b.map((x) => x.priority)).toEqual(b.map((_, i) => i + 1))
    expect(b[0].target_patient_count).toBeGreaterThanOrEqual(b[b.length - 1].target_patient_count)
  })

  it('with the base check → a number from that check', () => {
    const b = computeBundles(seg(15_000))
    expect(b.some((x) => (x.estimated_revenue_kzt ?? 0) > 0)).toBe(true)
    expect(b.every((x) => typeof x.estimated_revenue_kzt === 'number')).toBe(true)
  })
})
