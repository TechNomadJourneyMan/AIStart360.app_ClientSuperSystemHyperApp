// ============================================================
// lib/point-a/v3/retention-curve.ts
//
// Engine 2 — Retention curve.
//
// For each spec horizon h ∈ {30, 60, 90, 180, 365} compute:
//   current     % of clients with ≥ 1 purchase whose 2nd
//               purchase occurred within `h` days of the 1st.
//   plan_slice  Yearly client-plan / (365 / h).
//   fact        Actual number of purchase events that fell in
//               the trailing `h` days.
//   target_pct  Spec retention target for that horizon.
//
// "Time-to-second-purchase" is derived from the normalized
// client base — we don't have explicit per-purchase events, so
// for a client with N≥2 purchases we approximate the 2nd
// purchase date as `first + spread / (N-1)` where
// spread = days between first_purchase_date and
// last_purchase_date.  For N=2 this is exact; for N>2 it is
// the mean inter-purchase gap which under uniform spacing
// equals the 1→2 gap in expectation.
// ============================================================

import type {
  RetentionCurve,
  RetentionHorizon,
  RetentionPoint,
} from '@/types/point-a-v3'
import type { ClientBaseRow } from './client-base-loader'
import { daysBetween } from './client-base-loader'

const HORIZONS: RetentionHorizon[] = [30, 60, 90, 180, 365]

const TARGET_BY_HORIZON: Record<RetentionHorizon, number> = {
  30:  75,
  60:  65,
  90:  60,
  180: 50,
  365: 40,
}

export interface ComputeRetentionOptions {
  /** Annual purchase / client plan (in number of clients).  Used for `plan_slice`. */
  yearlyPlanClients?: number
  /** Inject "now" for tests. */
  now?: Date
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

export function emptyRetentionCurve(now: Date = new Date()): RetentionCurve {
  return {
    points: HORIZONS.map((h) => ({
      horizon_days: h,
      current: 0,
      plan_slice: 0,
      fact: 0,
      target_pct: TARGET_BY_HORIZON[h],
    })),
    computed_at: now.toISOString(),
    has_client_base: false,
  }
}

/**
 * Compute the 5-point retention curve.
 */
export function computeRetentionCurve(
  rows: ClientBaseRow[],
  opts: ComputeRetentionOptions = {},
): RetentionCurve {
  const now = opts.now ?? new Date()
  const yearlyPlan = Math.max(0, opts.yearlyPlanClients ?? 0)

  if (rows.length === 0) {
    return {
      ...emptyRetentionCurve(now),
      points: HORIZONS.map((h) => ({
        horizon_days: h,
        current: 0,
        plan_slice: yearlyPlan === 0 ? 0 : round2(yearlyPlan / (365 / h)),
        fact: 0,
        target_pct: TARGET_BY_HORIZON[h],
      })),
    }
  }

  // ── Pre-compute per-row data ───────────────────────────────
  // Each client contributes:
  //   tenureDays    — days from first purchase to "now"  (cohort age)
  //   activeSpanDays — days from first to last purchase  (how long they stayed engaged)
  // A client is "retained at horizon H" iff their activeSpanDays ≥ H,
  // i.e. they made a purchase ≥ H days after their first. This matches the
  // spec's descending curve (long-tenure retention is harder).
  const enriched = rows
    .map((row) => {
      const first = new Date(row.first_purchase_date)
      const last = new Date(row.last_purchase_date)
      const tenure = daysBetween(first, now)
      const activeSpan = daysBetween(first, last)
      return { row, tenure, activeSpan }
    })
    .filter((r) => Number.isFinite(r.tenure) && r.tenure >= 0)

  const points: RetentionPoint[] = HORIZONS.map((h) => {
    // ── Cohort eligible to be MEASURED at horizon H ─────────
    // Only clients whose tenure ≥ H can possibly meet retention at H.
    const cohort = enriched.filter((e) => e.tenure >= h)
    const cohortSize = cohort.length

    // ── Retained = clients whose active span reaches H or more ──
    let retained = 0
    for (const e of cohort) {
      if (e.activeSpan >= h) retained += 1
    }

    // ── Fact (absolute count) — number of retained clients at H ──
    const fact = retained

    const current = cohortSize === 0 ? 0 : round2((retained / cohortSize) * 100)
    const planSlice = yearlyPlan === 0 ? 0 : round2(yearlyPlan / (365 / h))

    return {
      horizon_days: h,
      current,
      plan_slice: planSlice,
      fact,
      target_pct: TARGET_BY_HORIZON[h],
    }
  })

  return {
    points,
    computed_at: now.toISOString(),
    has_client_base: true,
  }
}
