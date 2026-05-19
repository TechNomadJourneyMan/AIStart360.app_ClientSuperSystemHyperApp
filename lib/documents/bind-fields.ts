/**
 * Deterministic field → metric binder (Phase 2, primary path).
 *
 * Walks each ParsedDataField and tries to bind it to a stable `metric_id` from
 * the canonical registry (`lib/metrics/registry.ts`). The algorithm is:
 *
 *   1. Build a canonical field key via the synonym dictionary
 *      (`matchSynonym(field.key)` or `matchSynonym(field.label)`).
 *   2. Scan the registry for entries whose `sources` contain a document source
 *      that references the canonical field. Prefer exact `doc_type` matches;
 *      tiebreak by namespace (biz > kpi > goal > gri), then by label-synonym
 *      alignment (does the metric label itself resolve to the same canonical?),
 *      then by unit-vs-value-type compatibility, then by lexicographic id.
 *   3. If nothing matched and `opts.useAI` is true and the OpenRouter key is
 *      present, fall back to the AI binder (`bindFieldsWithAI`) for residual
 *      unbound fields with `confidence >= 0.7`. The AI module is dynamically
 *      imported to avoid a hard dependency cycle.
 *
 * Contract:
 *   - Never mutates the input array or its fields.
 *   - Never throws — degrades to "no bind" on every failure.
 *   - Fields with an existing `metric_id` are passed through (idempotent).
 *
 * Consumed by:
 *   - `lib/documents/extract.ts` (inline post-extraction step).
 *   - `app/api/v1/onboarding/documents/[id]/process/route.ts` (rebind flow).
 *
 * NOT to be confused with `bind-fields-ai.ts`, which is the LLM-only escape
 * hatch and is owned by a sister agent.
 */

import { matchSynonym } from '@/lib/documents/synonyms'
import type { ParsedDataField } from '@/lib/documents/extract'
import { hasOpenRouterKey } from '@/lib/ai/openrouter'
import { getMetricRegistry } from '@/lib/metrics/registry'
import type { MetricEntry } from '@/lib/metrics/types'
import type { MetricSource } from '@/lib/metrics/descriptions'

// ─── Public types ────────────────────────────────────────────

export interface BindFieldsOptions {
  /** When true, send still-unbound fields with `confidence>=0.7` through `bindFieldsWithAI`. Default false. */
  useAI?: boolean
  /** Per-document cache key forwarded to the AI binder for memoization. */
  cacheKey?: string
}

export interface BindStats {
  /** Total number of input fields. */
  total: number
  /** Fields that got `metric_id` from the deterministic synonym path. */
  deterministicHits: number
  /** Fields that got `metric_id` from the AI fallback path. */
  aiHits: number
  /** Fields still without a `metric_id` after both passes. */
  unbound: number
}

// ─── Internal: doc-source candidate index ────────────────────

interface DocCandidate {
  entry: MetricEntry
  source: MetricSource
}

/**
 * Lazy index from canonical field key (lowercased) → list of registry entries
 * that reference it via a `type='document'` source. Built once per process and
 * memoised because the registry itself is memoised too.
 */
let _docFieldIndex: Map<string, DocCandidate[]> | null = null

function getDocFieldIndex(): Map<string, DocCandidate[]> {
  if (_docFieldIndex) return _docFieldIndex
  const map = new Map<string, DocCandidate[]>()
  for (const entry of getMetricRegistry()) {
    for (const source of entry.sources) {
      if (source.type !== 'document') continue
      const field = (source.field ?? '').trim().toLowerCase()
      if (!field) continue
      const bucket = map.get(field) ?? []
      bucket.push({ entry, source })
      map.set(field, bucket)
    }
  }
  _docFieldIndex = map
  return map
}

/** Test-only: reset the index (paired with `__resetRegistryCache`). */
export function __resetBindFieldsCache(): void {
  _docFieldIndex = null
}

// ─── Tiebreak helpers ────────────────────────────────────────

const NAMESPACE_RANK: Record<string, number> = {
  biz: 0,
  kpi: 1,
  goal: 2,
  gri: 3,
}

/**
 * Heuristic: does the metric's own label resolve back to the same canonical
 * synonym? Acts as a strong tiebreaker — e.g. for canonical `revenue` the
 * label "Выручка (год)" resolves to `revenue` while "Выручка с продажника"
 * resolves to `revenue_per_seller`, so the former wins.
 */
function labelMatchesCanonical(entry: MetricEntry, canonical: string): boolean {
  const labelCanon = matchSynonym(entry.label)
  return labelCanon === canonical
}

/**
 * Coarse unit compatibility check between the metric's declared unit and the
 * raw extracted value. Currently:
 *   - "%" units pair best with values that look like percentages
 *     (string ending in "%", or numbers in [0,100] from a percent-y label).
 *   - "₸" / numeric units pair with numeric values.
 *   - Empty unit is neutral.
 */
function unitCompatibility(entry: MetricEntry, value: ParsedDataField['value']): number {
  const unit = (entry.unit ?? '').trim()
  if (!unit) return 0

  const isPercentString =
    typeof value === 'string' && /%\s*$/.test(value)
  const isNumber = typeof value === 'number'

  if (unit === '%') {
    if (isPercentString) return 2
    if (isNumber && (value as number) >= 0 && (value as number) <= 100) return 1
    return 0
  }
  if (unit === '₸') {
    if (isNumber) return 1
    return 0
  }
  if (unit === 'count') {
    if (isNumber && Number.isInteger(value as number)) return 1
    return 0
  }
  if (unit === 'days') {
    if (isNumber) return 1
    return 0
  }
  return 0
}

// ─── Candidate ranking ───────────────────────────────────────

interface RankedCandidate {
  entry: MetricEntry
  /** Higher = better. */
  score: number
}

function rankRegistryCandidates(
  canonical: string,
  docType: string,
  rawValue: ParsedDataField['value']
): RankedCandidate[] {
  const idx = getDocFieldIndex()
  const buckets = idx.get(canonical.toLowerCase()) ?? []
  if (buckets.length === 0) return []

  const docTypeNorm = (docType ?? '').trim().toLowerCase()

  const scored: RankedCandidate[] = buckets.map(({ entry, source }) => {
    let score = 0

    // (a) Exact doc_type match is the strongest signal.
    const srcDocType = (source.doc_type ?? '').trim().toLowerCase()
    if (docTypeNorm && srcDocType === docTypeNorm) score += 100
    else if (docTypeNorm && srcDocType && srcDocType.includes(docTypeNorm)) score += 30
    else if (!srcDocType) score += 5 // generic source

    // (b) Namespace preference: biz first.
    const nsRank = NAMESPACE_RANK[entry.namespace] ?? 9
    score += 20 - nsRank * 4

    // (c) Label-synonym alignment is a strong tiebreaker.
    if (labelMatchesCanonical(entry, canonical)) score += 15

    // (d) Unit ↔ value compatibility.
    score += unitCompatibility(entry, rawValue)

    return { entry, score }
  })

  // When the user specified a doc_type, restrict to candidates whose document
  // source matches exactly OR is generic (no doc_type set). If neither group is
  // non-empty, return [] so the field stays unbound — preferring "no answer"
  // over a cross-doc-type misbind (e.g. revenue in a marketing_report doc must
  // NOT silently snap to the pl_report revenue metric).
  if (docTypeNorm) {
    const filtered = scored.filter((c) =>
      c.entry.sources.some(
        (s) =>
          s.type === 'document' &&
          (s.field ?? '').toLowerCase() === canonical.toLowerCase() &&
          ((s.doc_type ?? '').toLowerCase() === docTypeNorm ||
            !(s.doc_type ?? '').trim())
      )
    )
    filtered.sort((a, b) => b.score - a.score || a.entry.id.localeCompare(b.entry.id))
    return filtered
  }

  scored.sort((a, b) => b.score - a.score || a.entry.id.localeCompare(b.entry.id))
  return scored
}

// ─── Single-field deterministic bind ─────────────────────────

/**
 * Returns the best registry id for a single field, or `null` if no deterministic
 * candidate clears the bar. Exported for unit-testing the resolver in isolation.
 */
export function resolveMetricIdForField(
  field: ParsedDataField,
  docType: string
): string | null {
  if ((field as ParsedDataField & { metric_id?: string | null }).metric_id) {
    return (field as ParsedDataField & { metric_id?: string | null }).metric_id ?? null
  }

  const candidatesFor = (canonical: string): RankedCandidate[] =>
    rankRegistryCandidates(canonical, docType, field.value)

  // (1a) Try canonical via the key first, then label.
  const canonFromKey = field.key ? matchSynonym(field.key) : null
  const canonFromLabel = field.label ? matchSynonym(field.label) : null
  const tried = new Set<string>()

  for (const canon of [canonFromKey, canonFromLabel]) {
    if (!canon || tried.has(canon)) continue
    tried.add(canon)
    const ranked = candidatesFor(canon)
    if (ranked.length > 0) return ranked[0].entry.id
  }

  // (1c) Literal scan: field.key === source.field exactly (no synonym lookup).
  if (field.key) {
    const literal = field.key.trim().toLowerCase()
    if (literal && !tried.has(literal)) {
      const ranked = rankRegistryCandidates(literal, docType, field.value)
      if (ranked.length > 0) return ranked[0].entry.id
    }
  }

  return null
}

// ─── Public API ──────────────────────────────────────────────

/**
 * Bind every field in `fields` to a canonical metric id. Returns a new array
 * (input is never mutated) plus a stats summary.
 */
export async function bindFieldsToMetrics(
  fields: ParsedDataField[],
  docType: string,
  opts?: BindFieldsOptions
): Promise<{ fields: ParsedDataField[]; stats: BindStats }> {
  if (!Array.isArray(fields) || fields.length === 0) {
    return {
      fields: [],
      stats: { total: 0, deterministicHits: 0, aiHits: 0, unbound: 0 },
    }
  }

  let deterministicHits = 0
  let aiHits = 0

  // (1) Deterministic pass.
  const pass1: ParsedDataField[] = fields.map((f) => {
    const existing = (f as ParsedDataField & { metric_id?: string | null }).metric_id
    if (existing) {
      // Already-bound passthrough — count as deterministic hit so stats still balance.
      deterministicHits += 1
      return { ...f, metric_id: existing }
    }
    const id = resolveMetricIdForField(f, docType)
    if (id) {
      deterministicHits += 1
      return { ...f, metric_id: id } as ParsedDataField & { metric_id: string }
    }
    return { ...f, metric_id: null } as ParsedDataField & { metric_id: null }
  })

  // (2) Optional AI fallback for residual unbound, confident fields.
  let finalFields = pass1
  if (opts?.useAI === true && hasOpenRouterKey()) {
    const needsAi: number[] = []
    for (let i = 0; i < pass1.length; i++) {
      const f = pass1[i] as ParsedDataField & { metric_id?: string | null }
      if (f.metric_id) continue
      const conf = typeof f.confidence === 'number' ? f.confidence : 1
      if (conf < 0.7) continue
      needsAi.push(i)
    }

    if (needsAi.length > 0) {
      try {
        // Dynamic import to avoid a hard module-cycle: extract.ts imports
        // bind-fields.ts, and bind-fields-ai.ts imports types from extract.ts.
        const { bindFieldsWithAI } = await import('@/lib/documents/bind-fields-ai')
        const subset = needsAi.map((i) => pass1[i])
        const aiBound = await bindFieldsWithAI(subset, docType, {
          cacheKey: opts.cacheKey,
        })

        const merged = pass1.slice()
        for (let j = 0; j < needsAi.length; j++) {
          const dst = needsAi[j]
          const candidate = aiBound[j] as ParsedDataField & { metric_id?: string | null }
          if (candidate && candidate.metric_id) {
            merged[dst] = { ...candidate }
            aiHits += 1
          }
        }
        finalFields = merged
      } catch (err) {
        console.warn('[bind-fields] AI fallback failed; deterministic results stand', err)
      }
    }
  }

  const unbound = finalFields.reduce((n, f) => {
    const id = (f as ParsedDataField & { metric_id?: string | null }).metric_id
    return id ? n : n + 1
  }, 0)

  return {
    fields: finalFields,
    stats: {
      total: fields.length,
      deterministicHits,
      aiHits,
      unbound,
    },
  }
}
