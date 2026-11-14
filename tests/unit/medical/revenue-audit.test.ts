/**
 * R-041 (BI-53) — revenue-audit counts from the clinic's facts: no 300-visit
 * floor, no default check, rates are labelled assumptions, the total is capped
 * at a share of the revenue, severity is relative.
 */
import { describe, it, expect } from 'vitest'
import { auditRevenueLosses, REVENUE_AUDIT_ASSUMPTIONS } from '@/lib/revenue-audit'
import { computeBundles } from '@/lib/clinic-bundles'
import type { SegmentationResult, PatientSegmentId } from '@/lib/rfm-segmentation'

function seg(o: { total: number; active: number; check: number; sleeping?: number; churnLtv?: number }): SegmentationResult {
  const summary = (['vip_retention', 'vip_reactivation', 'loyal_active', 'churn_risk', 'sleeping', 'one_time_fresh', 'one_time_old', 'dead_lead'] as PatientSegmentId[])
    .map((segment, i) => ({
      segment, label: segment, priority: i + 1,
      count: segment === 'sleeping' ? (o.sleeping ?? 10) : segment === 'churn_risk' ? 15 : segment === 'loyal_active' ? o.active : 5,
      total_ltv_kzt: segment === 'churn_risk' ? (o.churnLtv ?? 15 * 3 * o.check) : 0, avg_ltv_kzt: 0, avg_recency_days: 0,
    }))
  return {
    patients: [], summary,
    totals: { total_patients: o.total, total_ltv_kzt: 0, avg_check_kzt: o.check, active_last_90d: o.active, sleeping_180d_plus: o.sleeping ?? 10, dead_leads: 0 },
    thresholds: { vip_ltv_kzt: 80_000, recency_active_days: 90, recency_sleeping_days: 180 },
  }
}

describe('auditRevenueLosses (R-041)', () => {
  it('R-041 golden: 100 patients, 50 active, check 15 000 (≈0.75 M ₸/мес) → losses ≤ 30 % of revenue (was ≈3.2 M ₸/мес, 4× the revenue)', () => {
    const s = seg({ total: 100, active: 50, check: 15_000 })
    const a = auditRevenueLosses(s, computeBundles(s))
    expect(a.status).toBe('ok')
    expect(a.monthly_visits).toBe(50)
    expect(a.monthly_revenue_kzt).toBe(750_000)
    expect(a.total_loss_kzt).toBeLessThanOrEqual(750_000 * REVENUE_AUDIT_ASSUMPTIONS.maxLossShareOfRevenue)
    expect(a.total_loss_kzt).toBeGreaterThan(0)
    // No 300-visit floor anywhere.
    expect(a.losses.some((l) => l.source_data.includes('300 визитов'))).toBe(false)
    const noShow = a.losses.find((l) => l.key === 'no_shows')!
    expect(noShow.basis).toBe('assumption')
    expect(noShow.source_data).toContain('Допущения: no-show 30%')
    expect(a.narrative).toContain('допущения')
  })

  it('facts of the client win over the base: visits and check from onboarding', () => {
    const s = seg({ total: 2000, active: 400, check: 9_000 })
    const a = auditRevenueLosses(s, [], { facts: { monthlyVisits: 120, avgCheckKzt: 20_000 } })
    expect(a.monthly_visits).toBe(120)
    expect(a.avg_check_kzt).toBe(20_000)
    expect(a.monthly_revenue_kzt).toBe(2_400_000)
    expect(a.losses.find((l) => l.key === 'no_shows')!.source_data).toContain('факт клиента')
  })

  it('no check in the base and none given → no_data, no amounts (was: a 10 000 ₸ default)', () => {
    const a = auditRevenueLosses(seg({ total: 100, active: 50, check: 0 }), [])
    expect(a.status).toBe('no_data')
    expect(a.losses).toEqual([])
    expect(a.total_loss_kzt).toBe(0)
    expect(a.not_estimated!.length).toBeGreaterThan(0)
    expect(a.narrative).toContain('не оценены')
  })

  it('no active patients and no visits/revenue given → no_data (was: 300 visits assumed)', () => {
    const a = auditRevenueLosses(seg({ total: 100, active: 0, check: 15_000 }), [])
    expect(a.status).toBe('no_data')
  })

  it('severity is relative to revenue; the cap is reported', () => {
    const s = seg({ total: 100, active: 50, check: 15_000 })
    const a = auditRevenueLosses(s, computeBundles(s))
    expect(a.capped).toBe(true)
    expect(a.cap_kzt).toBe(225_000)
    for (const l of a.losses) {
      const share = l.estimated_loss_kzt / 750_000
      expect(l.severity).toBe(share >= 0.1 ? 'critical' : share >= 0.05 ? 'high' : share >= 0.02 ? 'medium' : 'low')
    }
  })

  it('assumptions are overridable per clinic', () => {
    const s = seg({ total: 100, active: 50, check: 15_000 })
    const a = auditRevenueLosses(s, [], { assumptions: { noShowRate: 0.1, maxLossShareOfRevenue: 1 } })
    expect(a.losses.find((l) => l.key === 'no_shows')!.estimated_loss_kzt).toBe(75_000)
  })
})
