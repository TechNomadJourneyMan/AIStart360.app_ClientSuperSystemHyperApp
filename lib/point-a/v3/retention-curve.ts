// ============================================================
// lib/point-a/v3/retention-curve.ts
//
// Engine 2 — Retention curve.
//
// For each spec horizon h ∈ {30, 60, 90, 180, 365} compute:
//   current     % of clients whose first_purchase happened
//               h..365 days ago AND who made at least one more
//               purchase within `h` days of that first one.
//   plan_slice  Yearly client-plan / (365 / h).
//   fact        Actual number of purchase events that fell in
//               the trailing `h` days.
//   target_pct  Spec retention target for that horizon.
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

  const points: RetentionPoint[] = HORIZONS.map((h) => {
    // Eligible cohort: clients whose first_purchase is between
    // `h` and 365 days ago — they had a real chance to come
    // back within the horizon window.
    let cohort = 0
    let retained = 0
    let fact = 0

    for (const row of rows) {
      const firstAge = daysBetween(new Date(row.first_purchase_date), now)

      // Cohort eligibility.
      if (firstAge >= h && firstAge <= 365) {
        cohort += 1
        // Repeat within horizon: we approximate "another purchase
        // within h days of the first" by checking whether the
        // client has ≥ 2 purchases AND the spread between first
        // and last purchase is ≥ 1 day AND ≤ h.
        if (row.purchase_count >= 2) {
          const spread = daysBetween(
            new Date(row.first_purchase_date),
            new Date(row.last_purchase_date),
          )
          if (spread >= 0 && spread <= h) retained += 1
        }
      }

      // Fact: any purchase event that lands inside the trailing `h` days.
      // Approximation: a client contributes one event per visit if their
      // last_purchase falls inside the window; for multi-visit clients
      // we proportionally distribute purchases under uniform-spread
      // assumption.
      const lastAge = daysBetween(new Date(row.last_purchase_date), now)
      if (lastAge <= h) {
        if (row.purchase_count <= 1) {
          fact += 1
        } else {
          const totalSpan = Math.max(
            1,
            daysBetween(
              new Date(row.first_purchase_date),
              new Date(row.last_purchase_date),
            ),
          )
          const ratePerDay = row.purchase_count / Math.max(totalSpan, 1)
          // Cap so we don't double-count purchases that pre-date the window.
          fact += Math.min(row.purchase_count, Math.round(ratePerDay * h))
        }
      }
    }

    const current = cohort === 0 ? 0 : round2((retained / cohort) * 100)
    const planSlice = yearlyPlan === 0 ? 0 : round2(yearlyPlan / (365 / h))

    return {
      horizon_days: h,
      current,
      plan_slice: planSlice,
      fact: Math.round(fact),
      target_pct: TARGET_BY_HORIZON[h],
    }
  })

  return {
    points,
    computed_at: now.toISOString(),
    has_client_base: true,
  }
}
