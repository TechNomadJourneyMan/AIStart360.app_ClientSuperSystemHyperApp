/**
 * Core types for the extractor framework.
 *
 * An Extractor is a pure function that turns some input (parsed document,
 * survey answers, calculated aggregates) into an array of ExtractedEntity
 * records, each carrying provenance, confidence, and typing info.
 *
 * Extractors know nothing about persistence, async backbones, or slot mapping.
 * They are composed by the orchestrator.
 */

/** Source tier used for consensus priority (document > manual > survey > calculated). */
export type ExtractionSource = 'document' | 'survey' | 'calculated'

/** Quarter shorthand — matches public.metrics.period_quarter CHECK constraint. */
export type FiscalQuarter = 'Q1' | 'Q2' | 'Q3' | 'Q4'

/**
 * One extracted fact. Write-target is ai_extractions table.
 * Numerical facts with (entity_type starting with "metric.") also flow into
 * public.metrics after consensus.
 */
export interface ExtractedEntity {
  /** Dot-namespaced entity type. Examples:
   *    'metric.revenue'
   *    'metric.gross_margin'
   *    'metric.cac'
   *    'segment.rfm_vip_retention'
   *    'bundle.reactivation'
   *    'loss.no_shows'
   *    'asset.logo_url'
   *    'asset.palette'
   *    'summary.executive'
   *    'insight.cohort_drop'
   */
  entity_type: string

  /** Extracted value. JSONB in DB — can be number, string, array, object. */
  value: unknown

  /** Optional unit annotation. 'KZT' | 'USD' | '%' | 'days' | 'count'. */
  unit?: string

  /** Period (for time-series metrics). */
  period_year?: number
  period_quarter?: FiscalQuarter

  /** 0..1 — LLM's own confidence in the extraction, or heuristic for deterministic extractors. */
  confidence: number

  /** Where this came from. */
  source_type: ExtractionSource

  /** If source_type='document', the documents.id. Otherwise null. */
  source_doc_id?: string

  /** Free-form locator within source: 'xlsx.sheet2.cellC12' | 'survey.s2_revenue_2024' | 'aggregate.monthly_seasonality'. */
  source_field?: string

  /** Extractor identifier (name@version). Also written separately to columns. */
  extractor_name: string
  extractor_version: string

  /** Evidence quote — first 200 chars of context around the extracted value. For UI clickthrough. */
  raw_excerpt?: string
}

/** Context passed to every extractor. */
export interface ExtractorContext {
  userId: string
  companyId: string
  documentId?: string
  vertical: 'generic' | 'medical'
  /** Correlation ID: ai_runs.id. All entities get tagged with this run. */
  runId: string
  /** Optional hints: classified doc_type if upload said 'other' and classifier ran. */
  classifiedType?: string
  classificationConf?: number
}

/**
 * An Extractor is a named, versioned transformer. Versioning is critical —
 * when an extractor version bumps, previously extracted entities become
 * candidates for re-extraction (see documents.extractor_version).
 */
export interface Extractor<TInput = unknown> {
  /** Stable identifier, e.g. 'generic.sales-report', 'medical.patient-base'. */
  name: string

  /** Semver. Bump when output shape or heuristics change. */
  version: string

  /** Optional: human-readable label for UI/admin. */
  label?: string

  /**
   * Does this extractor handle the given context? Used by the dispatcher to
   * pick an extractor when multiple are registered for the same vertical.
   *
   * Typical impl checks classifiedType / upload doc_type / file extension.
   */
  supports(ctx: ExtractorContext): boolean

  /** Do the work. Must be idempotent for the same (input, ctx). */
  extract(input: TInput, ctx: ExtractorContext): Promise<ExtractedEntity[]>
}

/**
 * Registry shape — one map per vertical. Dispatcher looks up by doc_type.
 * Fallback slot 'unknown' catches unclassified files.
 */
export type ExtractorRegistry = {
  [vertical in 'generic' | 'medical']: {
    [docType: string]: Extractor
  }
}

/** Shape of one step in ai_runs.steps JSONB array. */
export interface AiRunStep {
  name: string
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped'
  duration_ms?: number
  model?: string
  cost_usd?: number
  error?: string
  /** Step-specific metadata. */
  meta?: Record<string, unknown>
}
