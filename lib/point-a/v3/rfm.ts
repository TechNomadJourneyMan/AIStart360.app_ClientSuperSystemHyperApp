// ============================================================
// lib/point-a/v3/rfm.ts
//
// Engine 1 — RFM segmentation (AIStart360_Metrics_Guide.docx.txt,
// Часть 3 — Сегментация).
//
// Inputs:  normalised client-base rows (see client-base-loader).
// Outputs: 7 spec-defined segments with Russian labels.
//
// Rules (precedence in the order shown; first match wins):
//   1. onetime — Frequency = 1
//        a) onetime_fresh    Recency ≤ 180d
//        b) onetime_old      Recency > 180d
//   2. sleeping              Recency > 365d AND Frequency ≥ 2
//   3. churn_risk            Recency 180..365d AND Frequency 2..3
//   4. VIP buckets (require Frequency ≥ 4 AND Monetary top-20%)
//        a) vip_retention    Recency ≤ 90d
//        b) vip_reactivation Recency 90..365d
//   5. loyal_active          Recency ≤ 90d AND Freq 2..3 AND
//                            Monetary 21..60 percentile
//
// Anything that falls out gets routed to the nearest spec
// bucket via a deterministic fallback so the seven counts
// always sum to total_clients.
// ============================================================

import type {
  RFMResult,
  RFMSegmentId,
  RFMSegmentRow,
} from '@/types/point-a-v3'
import type { ClientBaseRow } from './client-base-loader'
import { daysSince } from './client-base-loader'

// ─── Static metadata ────────────────────────────────────────

const SEGMENT_ORDER: RFMSegmentId[] = [
  'vip_retention',
  'vip_reactivation',
  'loyal_active',
  'churn_risk',
  'sleeping',
  'onetime_fresh',
  'onetime_old',
]

const SEGMENT_LABEL_RU: Record<RFMSegmentId, string> = {
  vip_retention:    'VIP — удержание',
  vip_reactivation: 'VIP — реактивация',
  loyal_active:     'Лояльные активные',
  churn_risk:       'Риск оттока',
  sleeping:         'Спящие',
  onetime_fresh:    'Разовые свежие',
  onetime_old:      'Разовые старые',
}

const SEGMENT_ACTION_RU: Record<RFMSegmentId, string> = {
  vip_retention:    'Программа лояльности',
  vip_reactivation: 'Персональный оффер от ЛПР',
  loyal_active:     'Cross-sell / увеличение частоты',
  churn_risk:       'Win-back серия + скидка 15%',
  sleeping:         'Реактивация: пробная услуга',
  onetime_fresh:    'Welcome-серия + допродажа',
  onetime_old:      'Реактивация через WhatsApp',
}

// ─── Helpers ────────────────────────────────────────────────

interface Enriched extends ClientBaseRow {
  recency_days: number
}

/**
 * Percentile rank by total_spent_kzt. Returns a map clientId →
 * percentile (0..100). The highest spender is at 100.
 */
function monetaryPercentiles(rows: Enriched[]): Map<string, number> {
  const sorted = [...rows].sort(
    (a, b) => a.total_spent_kzt - b.total_spent_kzt,
  )
  const map = new Map<string, number>()
  const n = sorted.length
  if (n === 0) return map
  sorted.forEach((row, idx) => {
    // Inclusive percentile so the top spender is at 100.
    map.set(row.client_id, ((idx + 1) / n) * 100)
  })
  return map
}

function classify(row: Enriched, monetaryPct: number): RFMSegmentId {
  const r = row.recency_days
  const f = row.purchase_count

  // Rule 1 — one-time
  if (f === 1) return r <= 180 ? 'onetime_fresh' : 'onetime_old'

  // Rule 2 — sleeping
  if (r > 365 && f >= 2) return 'sleeping'

  // Rule 4 — VIP
  const isTop20 = monetaryPct >= 80
  if (f >= 4 && isTop20) {
    if (r <= 90)  return 'vip_retention'
    if (r <= 365) return 'vip_reactivation'
    // VIP but recency > 365 — still sleeping per spec hierarchy.
    return 'sleeping'
  }

  // Rule 3 — churn risk
  if (r >= 180 && r <= 365 && f >= 2 && f <= 3) return 'churn_risk'

  // Rule 5 — loyal active
  if (r <= 90 && f >= 2 && f <= 3 && monetaryPct >= 21 && monetaryPct <= 60) {
    return 'loyal_active'
  }

  // Deterministic fallback so the 7 buckets cover everyone.
  if (r <= 90)  return 'loyal_active'
  if (r <= 365) return 'churn_risk'
  return 'sleeping'
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

function emptyRow(segment: RFMSegmentId): RFMSegmentRow {
  return {
    segment,
    label_ru: SEGMENT_LABEL_RU[segment],
    count: 0,
    share_pct: 0,
    total_revenue_kzt: 0,
    avg_check_kzt: 0,
    avg_recency_days: 0,
    suggested_action_ru: SEGMENT_ACTION_RU[segment],
  }
}

// ─── Public API ─────────────────────────────────────────────

export interface ComputeRFMOptions {
  /** Inject "now" for deterministic tests. Defaults to new Date(). */
  now?: Date
}

/**
 * Empty result helper — used when the client base is missing.
 * Returns all seven segments at zero so the UI doesn't need to
 * special-case the no_data branch.
 */
export function emptyRFMResult(now: Date = new Date()): RFMResult {
  return {
    segments: SEGMENT_ORDER.map(emptyRow),
    total_clients: 0,
    total_revenue_kzt: 0,
    computed_at: now.toISOString(),
    has_client_base: false,
  }
}

/**
 * Compute RFM segments from a normalised client base.
 */
export function computeRFM(
  rows: ClientBaseRow[],
  opts: ComputeRFMOptions = {},
): RFMResult {
  const now = opts.now ?? new Date()

  if (rows.length === 0) {
    return emptyRFMResult(now)
  }

  const enriched: Enriched[] = rows.map((r) => ({
    ...r,
    recency_days: daysSince(r.last_purchase_date, now),
  }))

  const monetary = monetaryPercentiles(enriched)

  // Bucket accumulators.
  const counts: Record<RFMSegmentId, number> = {
    vip_retention: 0, vip_reactivation: 0, loyal_active: 0,
    churn_risk: 0, sleeping: 0, onetime_fresh: 0, onetime_old: 0,
  }
  const revenue: Record<RFMSegmentId, number> = { ...counts }
  const recencySum: Record<RFMSegmentId, number> = { ...counts }

  for (const row of enriched) {
    const pct = monetary.get(row.client_id) ?? 0
    const segment = classify(row, pct)
    counts[segment] += 1
    revenue[segment] += row.total_spent_kzt
    recencySum[segment] += row.recency_days
  }

  const totalClients = rows.length
  const totalRevenue = rows.reduce((acc, r) => acc + r.total_spent_kzt, 0)

  const segments: RFMSegmentRow[] = SEGMENT_ORDER.map((segment) => {
    const c = counts[segment]
    const rev = revenue[segment]
    return {
      segment,
      label_ru: SEGMENT_LABEL_RU[segment],
      count: c,
      share_pct: totalClients === 0 ? 0 : round2((c / totalClients) * 100),
      total_revenue_kzt: Math.round(rev),
      avg_check_kzt: c === 0 ? 0 : Math.round(rev / c),
      avg_recency_days: c === 0 ? 0 : Math.round(recencySum[segment] / c),
      suggested_action_ru: SEGMENT_ACTION_RU[segment],
    }
  })

  return {
    segments,
    total_clients: totalClients,
    total_revenue_kzt: Math.round(totalRevenue),
    computed_at: now.toISOString(),
    has_client_base: true,
  }
}
