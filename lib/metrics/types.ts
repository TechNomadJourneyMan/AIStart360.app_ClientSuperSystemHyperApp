// ============================================================
// lib/metrics/types.ts
// Resolver / Materialization domain types for the Point A
// real-time intelligence layer. Kept separate from
// `types/metrics.ts` (UI-facing) and `lib/metrics/descriptions.ts`
// (catalog) to avoid circular imports.
// ============================================================

import type { MetricPeriod, MetricSource } from './format'

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
  /** Unit: "₸" | "%" | "days" | "count" | "" (inferred) or an explicit one from the description ("ч/день", "из 10", "раз/год"). */
  unit: string
  /** 'flag' = the value is 1/0 (есть / нет); absent = an ordinary number. */
  valueKind?: 'number' | 'flag'
  /**
   * Period of a flow metric («Выручка (год)» = 'year', «Лидов в мес» =
   * 'month'). Source values of another period are rescaled to it. Absent =
   * point-in-time value, ratio or average (never rescaled).
   */
  period?: MetricPeriod
  /** Plausible range [min, max] of a value (NPS −100..100, a share 0..100, a score 0..10). */
  range?: readonly [number, number]
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

  /**
   * Section averages (0..10) of the company's current GRI assessment
   * (gri_assessments.section_avgs), keyed by section id ('cash-stability' …).
   */
  griSections?: Record<string, unknown> | null
  /** created_at of that assessment. */
  griAssessedAt?: string | null

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
  /** Original file name — a period hint («P&L 2025 Q1.xlsx»). */
  fileName?: string | null
}

/** Field-level provenance written by the document pipeline (lib/documents/extract.ts FieldProvenance). */
export interface ParsedFieldProvenance {
  document_id?: string
  method?: string
  quote?: string | null
  quote_verified?: boolean
  page?: number | null
  sheet?: string | null
  slide?: number | null
  ocr?: boolean
  ocr_engine?: string | null
  ocr_page_confidence?: number | null
  binding?: string | null
}

export interface ParsedDataShape {
  summary?: string
  raw_text_preview?: string
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
    /** Unit as stated in the document (₸, %, $ …). */
    unit?: string | null
    /** Period as stated («2025», «2025-Q1», «март 2025», «итого»). */
    period?: string | null
    provenance?: ParsedFieldProvenance
  }>
  /** Client registry rows (client_base / ecommerce_customers). */
  client_rows?: unknown[]
  /** How the text was obtained (lib/documents/pipeline.ts sourceInfo); `ocr` set for OCR'd scans. */
  source?: { ocr?: unknown } & Record<string, unknown>
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
  /** Period handling of the value: what it referred to and how it was rescaled. */
  period?: AttemptPeriod
  /** type 'document': where the value was read (OCR engine, page, quote …). */
  document?: AttemptDocument
  /** type 'formula': the inputs the value was calculated from. */
  inputs?: FormulaInput[]
  /** Survey key that was read (legacy keys are flagged). */
  legacy?: boolean
  /** type 'external' fed by a connected integration: provider, period, fetch time. */
  external?: AttemptExternal
}

/** Provenance of a value from an integration (lib/integrations/signals.ts). */
export interface AttemptExternal {
  provider: string
  period_start: string
  period_end: string
  fetched_at: string
  days: number
  basis: string
}

export interface AttemptPeriod {
  /** Period the source value referred to ('year' / 'quarter' / 'month' / 'months:9'). */
  source: string | null
  /** The metric's period (null = point-in-time / ratio, never rescaled). */
  target: string | null
  /** Multiplier applied (12 for a month value of a yearly metric). */
  factor: number
  year?: number | null
  quarter?: string | null
  month?: number | null
  /** Where the period came from: field label, document metadata, document text, survey answer. */
  basis?: 'field' | 'document' | 'text' | 'answer' | 'source' | null
}

export interface AttemptDocument {
  document_id: string
  doc_type: string
  field_key: string
  field_label?: string | null
  unit?: string | null
  /** e.g. «доля 0.34 → 34%». */
  unit_conversion?: string | null
  method?: string | null
  quote?: string | null
  page?: number | null
  sheet?: string | null
  ocr?: boolean
  ocr_engine?: string | null
  ocr_page_confidence?: number | null
  uploaded_at?: string | null
}

export interface FormulaInput {
  metricId: string
  label: string
  value: number
  unit: string
  /** Source type of the input value ('survey', 'document', 'formula' …). */
  source: string
  /** Survey key / document field the input came from. */
  sourceKey?: string | null
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
  /** Unresolved: what the owner can provide to get the value («нужно: …»). */
  needs?: string[]
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
