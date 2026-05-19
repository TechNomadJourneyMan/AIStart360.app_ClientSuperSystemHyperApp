// ============================================================
// lib/metrics/types.ts
// Resolver / Materialization domain types for the Point A
// real-time intelligence layer. Kept separate from
// `types/metrics.ts` (UI-facing) and `lib/metrics/descriptions.ts`
// (catalog) to avoid circular imports.
// ============================================================

import type { MetricSource } from './descriptions'

export type MetricNamespace = 'biz' | 'kpi' | 'gri' | 'goal'

export type PeriodQuarter = 'Q1' | 'Q2' | 'Q3' | 'Q4'

/**
 * Flat representation of a metric in the catalog. Built by
 * `lib/metrics/registry.ts` from the four declaration objects
 * in `lib/metrics/descriptions.ts`.
 */
export interface MetricEntry {
  /** Stable namespaced id: "biz.finance.vyruchka_god", "kpi.roe", "gri.product", "goal.01.win_rate". */
  id: string
  namespace: MetricNamespace
  /** For namespace="biz": Russian department label, e.g. "Финансы". */
  department?: string
  /** For namespace="goal": goal number "01".."11". */
  goalNumber?: string
  /** Human-readable Russian label as it appears in the catalog. */
  label: string
  /** Inferred unit: "₸" | "%" | "days" | "count" | "". */
  unit: string
  /** Optional formula text for goal metrics. */
  formula?: string
  /** Declared sources from descriptions.ts. */
  sources: MetricSource[]
}

/**
 * Context object the resolver operates over. All data is pre-fetched
 * by `gatherResolverContext(...)` so that `resolveMetric(...)` itself
 * can be a pure function — easy to unit-test without a DB.
 */
export interface ResolverContext {
  companyId: string
  userId: string

  /** Flat map: question_key → answer.value (e.g. "s2_revenue_2024" → 84200000). */
  surveyAnswers: Record<string, unknown>

  /** Documents the company has uploaded, newest first. */
  documents: ResolverDocument[]

  /** Pre-fetched Prisma signals keyed by "Model.field" (e.g. "PulseMetric.churnProb"). */
  prismaSignals?: Record<string, unknown>

  /** Pre-fetched external signals keyed by `system` (e.g. "GA", "KASE"). */
  externalSignals?: Record<string, unknown>

  /** Manual user overrides keyed by metric id. */
  manualOverrides?: Record<string, unknown>

  /** Period filter — if set, prefer values for this period. */
  preferPeriodYear?: number
  preferPeriodQuarter?: PeriodQuarter

  /** Injected clock — defaults to `new Date()`. Lets tests freeze time. */
  now: Date
}

export interface ResolverDocument {
  id: string
  docType: string
  parsedData: ParsedDataShape | null
  periodYear: number | null
  periodQuarter: PeriodQuarter | null
  uploadedAt: string
}

export interface ParsedDataShape {
  summary?: string
  fields?: Array<{
    key: string
    label?: string
    value: unknown
    target_tab?: string
    target_parameter?: string
    /** Phase 2 will populate this: the resolved metric id this field binds to. */
    metric_id?: string | null
    confidence?: number
    source?: string
  }>
}

export type SourceAttemptStatus = 'hit' | 'miss' | 'error'

export interface SourceAttempt {
  source: MetricSource
  status: SourceAttemptStatus
  /** Raw value if status="hit". */
  value?: unknown
  /** Numeric coercion if value was numeric. */
  numeric?: number | null
  /** Confidence weight for this source (before global weighting). */
  confidence?: number
  /** Why miss/error — for debugging. */
  reason?: string
}

/**
 * Result of resolving a single metric. Carries enough provenance
 * to render a "where did this number come from?" tooltip and to
 * write to `public.metrics` with a complete audit trail.
 */
export interface MetricValue {
  metricId: string
  /** Raw resolved value (string|number|boolean|null). */
  value: number | string | boolean | null
  /** Best-effort numeric coercion. Null if not numeric. */
  numeric: number | null
  unit: string
  /** 0..1 — combined confidence of the picked source. */
  confidence: number
  /** Which source won. Null if every source missed. */
  picked: MetricSource | null
  /** Every source that was attempted, in priority order. */
  considered: SourceAttempt[]
  periodYear: number | null
  periodQuarter: PeriodQuarter | null
  /** ISO timestamp of when the value was computed. */
  computedAt: string
  /** Optional resolver-level note (e.g. "fell back to heuristic"). */
  notes?: string
}

/**
 * Row shape for INSERT into `public.metrics`. The materialize layer
 * maps `MetricValue` → `MaterializedRow` then upserts.
 */
export interface MaterializedRow {
  company_id: string
  metric_key: string
  metric_value: number | null
  metric_unit: string | null
  period_year: number | null
  period_quarter: PeriodQuarter | null
  source: string
  confidence: number | null
  provenance: unknown
  computed_at: string
}
