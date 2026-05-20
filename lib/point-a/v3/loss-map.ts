// ============================================================
// lib/point-a/v3/loss-map.ts
//
// Engine 3 — Loss map.  Six revenue-loss buckets from
// AIStart360_Metrics_Guide.docx.txt "Часть 3 — диагностика
// потерь":
//
//   no_show          NoShow% × AOV × leads/мес
//   missed_incoming  Missed%  × AOV × leads/мес
//   no_followup      clients-w/o-2nd-purchase × AOV
//   no_upsell        repeat × (target_AOV − actual_AOV)
//   no_reactivation  sleeping_count × AOV × 0.2
//   weak_nps         (NPS<40) → estimated_churn_added × LTV
//
// All amounts in tenge (₸). FX = 450 ₸/USD if a USD value
// is passed in.
// ============================================================

import type {
  LossBucket,
  LossBucketId,
  LossMap,
  LossSeverity,
} from '@/types/point-a-v3'
import type { ClientBaseRow } from './client-base-loader'
import { daysSince } from './client-base-loader'

// ─── Configuration ──────────────────────────────────────────

export const FX_USD_KZT = 450

/** Pessimistic recovery assumption for sleeping → reactivation. */
const REACTIVATION_RECOVERY_RATE = 0.2

/** Severity thresholds (₸/year) — tuned for typical SMB. */
const SEVERITY_THRESHOLDS: Record<LossSeverity, number> = {
  critical: 30_000_000,
  high:     10_000_000,
  medium:    3_000_000,
  low:               0,
}

// Bucket metadata.
const LABEL_RU: Record<LossBucketId, string> = {
  no_show:         'No-show',
  missed_incoming: 'Потерянные входящие',
  no_followup:     'Нет follow-up',
  no_upsell:       'Нет допродаж',
  no_reactivation: 'Нет реактивации',
  weak_nps:        'Слабый NPS',
}

const RECOMMENDATION_RU: Record<LossBucketId, string> = {
  no_show:         'Внедрить WhatsApp-подтверждения за 24ч и 2ч до визита',
  missed_incoming: 'Подключить AI-ответчик и SLA на пропущенные звонки ≤ 15 мин',
  no_followup:     'Запустить серию из 3 сообщений после первой покупки',
  no_upsell:       'Cross-sell сценарии для повторных клиентов, поднять AOV до плана',
  no_reactivation: 'Кампания реактивации спящих с пробной услугой',
  weak_nps:        'NPS-программа, разбор отрицательных отзывов в течение 48ч',
}

const DATA_SOURCE: Record<LossBucketId, string> = {
  no_show:         'funnel.NoShow × AOV × Leads/мес',
  missed_incoming: 'funnel.Missed × AOV × Leads/мес',
  no_followup:     'clients_without_2nd_purchase × AOV',
  no_upsell:       'repeat_clients × (target_AOV − actual_AOV)',
  no_reactivation: 'sleeping_count × AOV × 0.2',
  weak_nps:        '(NPS < 40) → churn_added × LTV',
}

// ─── Inputs ─────────────────────────────────────────────────

export interface LossMapInputs {
  /** Average order value (₸). */
  avg_check_kzt: number
  /** Monthly inbound leads. */
  leads_per_month: number
  /** No-show rate as fraction 0..1 (0.15 = 15%). */
  no_show_rate?: number
  /** Missed-call rate as fraction 0..1. */
  missed_rate?: number
  /** Target average order value (₸).  When null, no_upsell = 0. */
  target_aov_kzt?: number | null
  /** NPS score 0..100.  Below 40 triggers weak_nps. */
  nps?: number | null
  /** Customer LTV (₸) — used by weak_nps. */
  ltv_kzt?: number | null
  /** Median repeat-purchase interval in days.  no_followup uses 1.5×Freq. */
  freq_days?: number | null
  /** Inject "now" for tests. */
  now?: Date
}

// ─── Helpers ────────────────────────────────────────────────

function severityFor(annualLoss: number): LossSeverity {
  if (annualLoss >= SEVERITY_THRESHOLDS.critical) return 'critical'
  if (annualLoss >= SEVERITY_THRESHOLDS.high)     return 'high'
  if (annualLoss >= SEVERITY_THRESHOLDS.medium)   return 'medium'
  return 'low'
}

function bucket(
  id: LossBucketId,
  monthly: number,
): LossBucket {
  const month = Math.max(0, Math.round(monthly))
  const year = month * 12
  return {
    bucket: id,
    label_ru: LABEL_RU[id],
    loss_kzt_per_month: month,
    loss_kzt_per_year: year,
    severity: severityFor(year),
    recommendation_ru: RECOMMENDATION_RU[id],
    data_source: DATA_SOURCE[id],
  }
}

function dominant(buckets: LossBucket[]): LossBucketId | null {
  let top: LossBucket | null = null
  for (const b of buckets) {
    if (b.loss_kzt_per_year <= 0) continue
    if (!top || b.loss_kzt_per_year > top.loss_kzt_per_year) top = b
  }
  return top?.bucket ?? null
}

// ─── Public API ─────────────────────────────────────────────

export function emptyLossMap(now: Date = new Date()): LossMap {
  const ids: LossBucketId[] = [
    'no_show', 'missed_incoming', 'no_followup',
    'no_upsell', 'no_reactivation', 'weak_nps',
  ]
  return {
    buckets: ids.map((id) => bucket(id, 0)),
    total_loss_kzt_per_year: 0,
    dominant_bucket: null,
    computed_at: now.toISOString(),
    has_client_base: false,
  }
}

/**
 * Compute the loss map from a normalised client base + spec signals.
 * `rows` may be empty — most buckets still produce a useful value
 * from the funnel signals alone.
 */
export function computeLossMap(
  rows: ClientBaseRow[],
  inputs: LossMapInputs,
): LossMap {
  const now = inputs.now ?? new Date()
  const aov = Math.max(0, inputs.avg_check_kzt)
  const leadsM = Math.max(0, inputs.leads_per_month)
  const noShow = clamp01(inputs.no_show_rate ?? 0)
  const missed = clamp01(inputs.missed_rate ?? 0)

  // 1. no_show
  const noShowMonthly = noShow * aov * leadsM

  // 2. missed_incoming
  const missedMonthly = missed * aov * leadsM

  // 3. no_followup — clients with no 2nd purchase within Freq×1.5 days
  const freqDays = Math.max(1, inputs.freq_days ?? 90)
  const cutoffDays = freqDays * 1.5
  let noFollowupClients = 0
  for (const row of rows) {
    if (row.purchase_count >= 2) continue
    const age = daysSince(row.first_purchase_date, now)
    // Window already elapsed but no 2nd purchase materialised.
    if (age >= cutoffDays && age <= 365) noFollowupClients += 1
  }
  // Spread the annual count over 12 months → monthly potential loss.
  const noFollowupMonthly = (noFollowupClients * aov) / 12

  // 4. no_upsell — repeat clients * (target - actual) when actual < target
  const repeats = rows.filter((r) => r.purchase_count >= 2)
  const actualRepeatAOV = repeats.length === 0
    ? 0
    : repeats.reduce((s, r) => s + r.total_spent_kzt / r.purchase_count, 0)
      / repeats.length
  const target = inputs.target_aov_kzt ?? null
  const upsellMonthly =
    target != null && target > actualRepeatAOV && actualRepeatAOV > 0
      ? ((target - actualRepeatAOV) * repeats.length) / 12
      : 0

  // 5. no_reactivation — sleeping clients × AOV × recovery
  let sleepingCount = 0
  for (const row of rows) {
    const recency = daysSince(row.last_purchase_date, now)
    if (recency > 365 && row.purchase_count >= 2) sleepingCount += 1
  }
  const reactivationMonthly =
    (sleepingCount * aov * REACTIVATION_RECOVERY_RATE) / 12

  // 6. weak_nps — only fires when NPS<40
  const nps = inputs.nps ?? null
  const ltv = Math.max(0, inputs.ltv_kzt ?? 0)
  let weakNpsMonthly = 0
  if (nps != null && nps < 40 && ltv > 0 && rows.length > 0) {
    // Heuristic: every NPS point under 40 adds ~0.5% extra annual churn.
    const churnAddedPct = Math.max(0, (40 - nps) * 0.005)
    const churnAddedClients = rows.length * churnAddedPct
    weakNpsMonthly = (churnAddedClients * ltv) / 12
  }

  const buckets: LossBucket[] = [
    bucket('no_show',         noShowMonthly),
    bucket('missed_incoming', missedMonthly),
    bucket('no_followup',     noFollowupMonthly),
    bucket('no_upsell',       upsellMonthly),
    bucket('no_reactivation', reactivationMonthly),
    bucket('weak_nps',        weakNpsMonthly),
  ]

  const total = buckets.reduce((s, b) => s + b.loss_kzt_per_year, 0)

  return {
    buckets,
    total_loss_kzt_per_year: total,
    dominant_bucket: dominant(buckets),
    computed_at: now.toISOString(),
    has_client_base: rows.length > 0,
  }
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0
  if (n <= 0) return 0
  if (n >= 1) return n > 1.0001 ? Math.min(n / 100, 1) : 1 // accept 15 → 0.15
  return n
}
