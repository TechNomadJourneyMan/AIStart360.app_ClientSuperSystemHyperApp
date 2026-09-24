/**
 * lib/point-a/analysis-cache.ts — skip the Point A AI analysis when its input
 * did not change (F-070, idea M15).
 *
 * `analyzePointA` makes 4 parallel LLM calls (Sonnet + Haiku) — the most
 * expensive AI path on the platform — and every "recalculate" used to re-run
 * it even when the answers were identical. We hash the exact analysis input
 * (answers + rule-based Point A + company profile + expert notes + locale +
 * prompt version) and reuse a previous completed analysis with the same hash
 * (`diagnostics.narrative_input_hash`, migration 091).
 */

import { createHash } from 'node:crypto'

/** Bump when the analyzer prompts/schemas change so old results are not reused. */
export const POINT_A_ANALYSIS_VERSION = 'point-a-analysis/v1'

/** Company columns that change without changing the analysis input. */
const VOLATILE_COMPANY_KEYS = new Set(['id', 'user_id', 'created_at', 'updated_at'])

/** JSON.stringify with sorted object keys (so key order never changes the hash). */
export function stableStringify(value: unknown): string {
  if (value === undefined) return 'null'
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null'
  if (Array.isArray(value)) return `[${value.map((v) => stableStringify(v)).join(',')}]`
  const obj = value as Record<string, unknown>
  const keys = Object.keys(obj).filter((k) => obj[k] !== undefined).sort()
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(',')}}`
}

export interface PointAAnalysisInput {
  answers: Record<string, unknown>
  pointA: unknown
  company: Record<string, unknown> | null
  expertNotes?: Record<string, unknown> | null
  locale: string
}

export function pointAAnalysisInputHash(input: PointAAnalysisInput): string {
  const company = input.company
    ? Object.fromEntries(Object.entries(input.company).filter(([k]) => !VOLATILE_COMPANY_KEYS.has(k)))
    : null
  const payload = stableStringify({
    v: POINT_A_ANALYSIS_VERSION,
    answers: input.answers,
    pointA: input.pointA,
    company,
    expertNotes: input.expertNotes ?? null,
    locale: input.locale,
  })
  return createHash('sha256').update(payload).digest('hex')
}

export interface CachedAnalysisDeps<T> {
  /** A previous completed analysis for exactly this input, or null. */
  findCached: (hash: string) => Promise<T | null>
  /** The real (LLM) analysis. */
  analyze: () => Promise<T | null>
  /** Called on a cache hit (records a 0-token usage row). */
  onCacheHit?: () => Promise<void> | void
}

/** Reuse a cached analysis for `hash`, otherwise run `analyze`. Cache errors = miss. */
export async function analyzeWithInputCache<T>(
  hash: string,
  deps: CachedAnalysisDeps<T>,
): Promise<{ result: T | null; cached: boolean }> {
  let cached: T | null = null
  try {
    cached = await deps.findCached(hash)
  } catch {
    cached = null
  }
  if (cached) {
    try { await deps.onCacheHit?.() } catch { /* accounting is best-effort */ }
    return { result: cached, cached: true }
  }
  return { result: await deps.analyze(), cached: false }
}
