// ============================================================
// types/point-a-v3.ts
// Canonical 6-block Point A v3 type system — matches the spec
// described in AIStart360_Metrics_Guide.docx.txt (Part 3).
//
// English identifiers are used in code; Russian labels appear in
// the block / metric definitions for UI consumption.
//
// This file is purely additive — it does NOT replace
// `types/onboarding.ts` PointA.
// ============================================================

/** All six block identifiers in spec order. */
export type V3BlockId =
  | 'sales'
  | 'client'
  | 'retention'
  | 'finance'
  | 'funnel'
  | 'ai_comms'

/**
 * Status that every metric receives.
 *  - excellent: meets or exceeds the spec target with margin
 *  - good:      meets the spec target
 *  - warning:   below the spec target but recoverable
 *  - critical:  significantly below the target / red zone
 *  - no_data:   the resolver could not produce a value
 */
export type V3MetricStatus =
  | 'excellent'
  | 'good'
  | 'warning'
  | 'critical'
  | 'no_data'

/** Where the value came from — used for provenance + UI badge. */
export type V3MetricSource = 'survey' | 'document' | 'computed' | 'ai_comms'

/** Units used across the six blocks. `null` means dimensionless ratio/count-of-unit. */
export type V3MetricUnit = '₸' | '%' | 'count' | 'days' | 'sec' | null

/**
 * A single resolved metric. `target` is either a number (e.g. 75 for "> 75%")
 * or a string when the spec uses a qualitative phrase (e.g. "Рост +20%/год").
 */
export interface V3Metric {
  /** Engineering identifier — stable across versions, e.g. "sales.aov". */
  key: string
  /** Short Russian label for the UI. */
  label_ru: string
  /** Short English label for analytics / logs. */
  label_en: string
  /** Resolved value. `null` when no data. */
  value: number | null
  /** Spec target — number or qualitative phrase. */
  target: number | string
  /** Health status, derived from value vs target. */
  status: V3MetricStatus
  /** Where the value came from. */
  source: V3MetricSource
  /** Human-readable formula text (mirrors the spec table). */
  formula: string
  /** Unit hint for formatting. */
  unit: V3MetricUnit
}

// ─── Block 1 — Sales ─────────────────────────────────────────
export interface SalesBlock {
  N: V3Metric
  Rev: V3Metric
  AOV: V3Metric
  New: V3Metric
  RevNew: V3Metric
  AOVnew: V3Metric
  Ret: V3Metric
  RevRet: V3Metric
}

// ─── Block 2 — Client metrics ───────────────────────────────
export interface ClientBlock {
  LTV: V3Metric
  CAC: V3Metric
  CPL: V3Metric
  LTV_CAC: V3Metric
  ROMI: V3Metric
}

// ─── Block 3 — Retention ────────────────────────────────────
export interface RetentionBlock {
  TotalC: V3Metric
  Active: V3Metric
  NewY: V3Metric
  Sleep: V3Metric
  RetRate: V3Metric
  AvgPurch: V3Metric
  Freq: V3Metric
  Churn: V3Metric
}

// ─── Block 4 — Finance ──────────────────────────────────────
export interface FinanceBlock {
  GrossRev: V3Metric
  GrossProfit: V3Metric
  GrossMargin: V3Metric
  EBITDA: V3Metric
  NetProfit: V3Metric
  NetMargin: V3Metric
  COGS_pct: V3Metric
  Payroll_pct: V3Metric
  Mktg_pct: V3Metric
  BEP: V3Metric
}

// ─── Block 5 — Funnel ───────────────────────────────────────
export interface FunnelBlock {
  Leads: V3Metric
  CR1: V3Metric
  CR2: V3Metric
  RT: V3Metric
  Missed: V3Metric
  NoShow: V3Metric
  OptIn: V3Metric
}

// ─── Block 6 — AI Comms ─────────────────────────────────────
export interface AiCommsBlock {
  ConfRate: V3Metric
  NoShowDown: V3Metric
  FUpCR: V3Metric
  AvgReply: V3Metric
  React: V3Metric
  NPS: V3Metric
  NPSResp: V3Metric
  Ref: V3Metric
}

/** Top-level v3 payload — all six blocks plus the compute timestamp. */
export interface PointAV3 {
  blocks: {
    sales: SalesBlock
    client: ClientBlock
    retention: RetentionBlock
    finance: FinanceBlock
    funnel: FunnelBlock
    ai_comms: AiCommsBlock
  }
  computed_at: string
}

// ─── Block definition (static metadata) ─────────────────────
export interface V3BlockDefinition {
  id: V3BlockId
  /** Spec-order index (1..6). */
  order: number
  label_ru: string
  label_en: string
  description_ru: string
  /** Engineering keys of metrics inside this block, spec order. */
  metric_keys: string[]
}

// ─── RFM Segmentation ───────────────────────────────────────
/**
 * The 7 canonical RFM segments from AIStart360_Metrics_Guide
 * "Часть 3 — Сегментация".  Codes are English / stable;
 * `label_ru` is for the UI.
 */
export type RFMSegmentId =
  | 'vip_retention'
  | 'vip_reactivation'
  | 'loyal_active'
  | 'churn_risk'
  | 'sleeping'
  | 'onetime_fresh'
  | 'onetime_old'

export interface RFMSegmentRow {
  segment: RFMSegmentId
  label_ru: string
  count: number
  share_pct: number
  total_revenue_kzt: number
  avg_check_kzt: number
  avg_recency_days: number
  suggested_action_ru: string
}

export interface RFMResult {
  segments: RFMSegmentRow[]
  total_clients: number
  total_revenue_kzt: number
  computed_at: string
  has_client_base: boolean
}

// ─── Retention curve ─────────────────────────────────────────
export type RetentionHorizon = 30 | 60 | 90 | 180 | 365

export interface RetentionPoint {
  horizon_days: RetentionHorizon
  /** % of clients (0..100) whose first_purchase was horizon..365d ago who made another purchase within `horizon` days. */
  current: number
  /** Yearly plan / (365 / horizon). Slice of the annual plan expressed in clients-per-horizon. */
  plan_slice: number
  /** Actual number of purchases in the last `horizon` days. */
  fact: number
  /** Spec target percentage (30→75, 60→65, 90→60, 180→50, 365→40). */
  target_pct: number
}

export interface RetentionCurve {
  points: RetentionPoint[]
  computed_at: string
  has_client_base: boolean
}

// ─── Loss map ────────────────────────────────────────────────
export type LossBucketId =
  | 'no_show'
  | 'missed_incoming'
  | 'no_followup'
  | 'no_upsell'
  | 'no_reactivation'
  | 'weak_nps'

export type LossSeverity = 'critical' | 'high' | 'medium' | 'low'

export interface LossBucket {
  bucket: LossBucketId
  label_ru: string
  loss_kzt_per_month: number
  loss_kzt_per_year: number
  severity: LossSeverity
  recommendation_ru: string
  /** Free-text origin — e.g. "funnel.NoShow × AOV × Leads/мес". */
  data_source: string
}

export interface LossMap {
  buckets: LossBucket[]
  total_loss_kzt_per_year: number
  dominant_bucket: LossBucketId | null
  computed_at: string
  has_client_base: boolean
}
