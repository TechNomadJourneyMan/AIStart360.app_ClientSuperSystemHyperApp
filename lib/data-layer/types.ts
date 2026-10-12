/**
 * lib/data-layer/types.ts — the period-aware data layer of Point A
 * (docs/superpowers/specs/2026-10-12-point-a-full-design.md §1).
 *
 * A Fact is one observation of a metric: a value for a period from one
 * source. The resolver (lib/metrics/resolver.ts) still picks ONE current
 * value per metric for public.metrics; facts keep every observation so that
 * periods can be compared and discrepancies between sources found.
 */

export type FactSourceKind = 'survey' | 'document' | 'manual' | 'integration' | 'assessment'

/** A calendar period: a year, a quarter of it or a month of it. */
export interface PeriodRef {
  year: number
  quarter: 1 | 2 | 3 | 4 | null
  /** 1..12 */
  month: number | null
  /** Year-to-date value (partial year): never compared with a full-year one. */
  ytd?: boolean
  /** Months a partial-year value covers («9 месяцев 2025» = 9), when known. */
  months?: number
}

export type FactFlag = 'invalid' | 'anomaly' | 'stale' | 'rescaled' | 'confirmed'

export interface Fact {
  metricId: string
  /** null = the period of the value is unknown. */
  period: PeriodRef | null
  /** '2024' | '2024-Q2' | '2024-03' | '2026-YTD' | 'unknown' */
  periodKey: string
  /** The value in the metric's unit and period (rescaled when the source period differs). */
  value: number
  unit: string
  sourceKind: FactSourceKind
  /** 'survey:s9n_revenue_2024' | 'survey:s8n_metrics_table#sales_amount/y2024' | 'document:<id>#<field>' | 'manual' | 'integration:<provider>' */
  sourceRef: string
  /** Every source that observed this value (after duplicates are merged). */
  sourceRefs: string[]
  /** 0..1 */
  confidence: number
  flags: FactFlag[]
  /** answered_at / uploaded_at / fetched_at */
  observedAt: string | null
  /** Survey value that describes the current situation (no year of its own). */
  current?: boolean
  note?: string
}

export type DiscrepancyKind = 'conflict' | 'invalid' | 'anomaly'

export interface DiscrepancyCandidate {
  value: number
  unit: string
  sourceKind: FactSourceKind
  sourceRef: string
  confidence: number
  note?: string
}

export interface DiscrepancyDraft {
  metricId: string
  periodKey: string
  kind: DiscrepancyKind
  /** Highest-priority source first. */
  candidates: DiscrepancyCandidate[]
  /** The value the calculation uses until the discrepancy is resolved. */
  chosenValue: number | null
  detail: string
}

/** Within one period: manual > survey > document > integration > assessment (spec §1.4). */
export const FACT_SOURCE_PRIORITY: Readonly<Record<FactSourceKind, number>> = {
  manual: 5,
  survey: 4,
  document: 3,
  integration: 2,
  assessment: 1,
}
