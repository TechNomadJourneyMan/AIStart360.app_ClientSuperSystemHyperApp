/**
 * Consensus resolution — pick the canonical value when multiple sources
 * disagree about the same (entity_type, period_year, period_quarter) slot.
 *
 * Rules (applied in order):
 *   1. Higher "priority score" wins:
 *        priority_score = source_priority(0..1) × confidence(0..1)
 *      Source priorities:
 *        document    → 0.9
 *        manual      → 0.8 (inserted via admin UI — not through extractors)
 *        survey      → 0.7
 *        calculated  → 0.5
 *   2. Ties broken by most-recent extracted_at.
 *   3. If gap between #1 and #2 values is > 20%, emit a `pending` conflict —
 *      UI shows a badge and lets the user resolve manually.
 *
 * Side effects:
 *   • Writes ai_conflicts rows (auto-resolved or pending).
 *   • Marks losers via ai_extractions.superseded_by = winner.id.
 *   • Inserts normalized numeric values into public.metrics with
 *     source='calculated' (the consensus winner, flagged calculated so the
 *     original survey/document rows coexist for audit).
 */

import { SOURCE_PRIORITY } from './extractors/base'
import type { ExtractedEntity, ExtractionSource, FiscalQuarter } from './extractors/types'

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

/** ai_extractions row shape after persistence. */
export interface PersistedExtraction {
  id: string
  entity_type: string
  value: unknown
  unit: string | null
  period_year: number | null
  period_quarter: FiscalQuarter | null
  confidence: number
  source_type: ExtractionSource
  source_doc_id: string | null
  source_field: string | null
  extractor_name: string
  extractor_version: string
  extracted_at: string // ISO
  superseded_by: string | null
}

export interface ConflictEntry {
  /** Group key: entity_type + period_year + period_quarter */
  key: string
  entity_type: string
  period_year: number | null
  period_quarter: FiscalQuarter | null
  winnerId: string
  contenders: Array<{
    extraction_id: string
    value: unknown
    confidence: number
    source_type: ExtractionSource
    extractor_name: string
    priority_score: number
  }>
  /** 'auto' — resolution picked without issue; 'pending' — gap > threshold. */
  resolution: 'auto' | 'pending'
  /** Relative gap between #1 and #2 (only meaningful for numeric entities). */
  gap?: number
}

export interface ConsensusResult {
  /** Canonical winners — one per (entity_type, period_year, period_quarter). */
  winners: PersistedExtraction[]
  /** ID of losers → winnerId mapping for superseded_by updates. */
  supersededBy: Record<string, string>
  /** Conflicts to persist to ai_conflicts. */
  conflicts: ConflictEntry[]
}

// -----------------------------------------------------------------------------
// Algorithm
// -----------------------------------------------------------------------------

const CONFLICT_GAP_THRESHOLD = 0.2 // 20 % — configurable via env in future

function groupKey(e: { entity_type: string; period_year: number | null; period_quarter: FiscalQuarter | null }): string {
  return `${e.entity_type}|${e.period_year ?? 'na'}|${e.period_quarter ?? 'na'}`
}

function priorityScore(e: PersistedExtraction): number {
  const srcWeight = SOURCE_PRIORITY[e.source_type] ?? 0.5
  return srcWeight * e.confidence
}

function numericGap(a: unknown, b: unknown): number | undefined {
  if (typeof a !== 'number' || typeof b !== 'number') return undefined
  if (a === 0 && b === 0) return 0
  const denom = Math.max(Math.abs(a), Math.abs(b))
  if (denom === 0) return 0
  return Math.abs(a - b) / denom
}

/**
 * Resolve consensus across a set of recently-extracted + existing-active
 * entities for the same company. Pure function — no DB I/O.
 *
 * @param extractions — merged list (new + already-active). Caller queries DB
 *                      with `WHERE superseded_by IS NULL` and adds fresh ones.
 */
export function resolveConsensus(extractions: PersistedExtraction[]): ConsensusResult {
  const groups = new Map<string, PersistedExtraction[]>()

  for (const e of extractions) {
    const k = groupKey(e)
    const bucket = groups.get(k) ?? []
    bucket.push(e)
    groups.set(k, bucket)
  }

  const winners: PersistedExtraction[] = []
  const supersededBy: Record<string, string> = {}
  const conflicts: ConflictEntry[] = []

  for (const [key, bucket] of groups) {
    if (bucket.length === 1) {
      winners.push(bucket[0])
      continue
    }

    // Rank by priority_score desc, then extracted_at desc
    const ranked = [...bucket].sort((a, b) => {
      const ps = priorityScore(b) - priorityScore(a)
      if (ps !== 0) return ps
      return new Date(b.extracted_at).getTime() - new Date(a.extracted_at).getTime()
    })

    const winner = ranked[0]
    const runnerUp = ranked[1]
    winners.push(winner)

    // Mark losers
    for (const loser of ranked.slice(1)) {
      supersededBy[loser.id] = winner.id
    }

    // Compute gap for numeric entities
    const gap = numericGap(winner.value, runnerUp.value)

    const resolution: ConflictEntry['resolution'] =
      gap !== undefined && gap > CONFLICT_GAP_THRESHOLD ? 'pending' : 'auto'

    conflicts.push({
      key,
      entity_type: winner.entity_type,
      period_year: winner.period_year,
      period_quarter: winner.period_quarter,
      winnerId: winner.id,
      contenders: ranked.map((e) => ({
        extraction_id: e.id,
        value: e.value,
        confidence: e.confidence,
        source_type: e.source_type,
        extractor_name: e.extractor_name,
        priority_score: Number(priorityScore(e).toFixed(3)),
      })),
      resolution,
      gap,
    })
  }

  return { winners, supersededBy, conflicts }
}

// -----------------------------------------------------------------------------
// Convenience: map winners into `metrics` table shape
// -----------------------------------------------------------------------------

export interface MetricUpsert {
  company_id: string
  metric_key: string
  metric_value: number
  metric_unit: string | null
  period_year: number | null
  period_quarter: FiscalQuarter | null
  /** Always 'calculated' — canonical consensus output. Original rows stay in source tier. */
  source: 'calculated'
}

/**
 * Project winning numeric extractions into `metrics` upsert rows.
 * Strips non-numeric / non-metric entities (those live only in ai_extractions).
 */
export function winnersToMetrics(
  winners: PersistedExtraction[],
  companyId: string
): MetricUpsert[] {
  const out: MetricUpsert[] = []
  for (const w of winners) {
    if (!w.entity_type.startsWith('metric.')) continue
    if (typeof w.value !== 'number') continue
    if (!Number.isFinite(w.value)) continue

    const metric_key = w.entity_type.slice('metric.'.length)

    out.push({
      company_id: companyId,
      metric_key,
      metric_value: w.value,
      metric_unit: w.unit,
      period_year: w.period_year,
      period_quarter: w.period_quarter,
      source: 'calculated',
    })
  }
  return out
}

/**
 * Take recent ExtractedEntity (un-persisted) + already-active PersistedExtraction
 * rows and deduplicate. Caller uses this before passing to resolveConsensus —
 * but typically the orchestrator persists fresh entities first then loads the
 * combined active set.
 */
export function mergeFresh(
  fresh: ExtractedEntity[],
  freshPersisted: PersistedExtraction[],
  existingActive: PersistedExtraction[]
): PersistedExtraction[] {
  // Caller has already INSERTed fresh → freshPersisted mirrors that.
  // We simply concat and let resolveConsensus dedupe by group key.
  return [...freshPersisted, ...existingActive]
}
