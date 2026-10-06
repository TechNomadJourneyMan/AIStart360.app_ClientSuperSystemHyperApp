/**
 * lib/point-a/ai-analysis.ts — the two AI texts stored on a diagnostics row.
 *
 *   diagnostics.ai_analysis   AIAnalysis of POST /api/v1/diagnostics/ai-analyze
 *                             (status: ai_status); may also carry keys other
 *                             writers own (the expert routes read `gri` and
 *                             `pulse`), which a rewrite must keep
 *   diagnostics.ai_narrative  PointANarrative of POST /api/v1/point-a/narrative
 *                             (migration 091)
 *
 * Before 091 both writers overwrote ai_analysis with their own shape. These
 * guards let readers tell the shapes apart, so rows written before the
 * migration stay readable: a narrative found in ai_analysis is served as the
 * narrative and never shown as an analysis.
 */
import type { AIAnalysis } from '@/types/onboarding'
import type { PointANarrative } from './narrative'

/** Keys the AIAnalysis writer owns; everything else in ai_analysis belongs to someone else. */
const ANALYSIS_KEYS = new Set(['executive_summary', 'blocks', 'strategic_priorities', 'growth_roadmap', 'industry_context', 'model_used', 'generated_at'])
/** Keys of a narrative stored in ai_analysis before 091 — never carried into a new analysis. */
const NARRATIVE_KEYS = new Set(['strengths_text', 'weaknesses_text', 'risks_text', 'opportunities_text', 'next_steps'])

function isObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v)
}

export function isPointANarrative(v: unknown): v is PointANarrative {
  return isObject(v) && typeof v.strengths_text === 'string' && typeof v.executive_summary === 'string' && !('blocks' in v)
}

export function isAIAnalysis(v: unknown): v is AIAnalysis {
  if (!isObject(v) || isPointANarrative(v)) return false
  return isObject(v.blocks) || Array.isArray(v.strategic_priorities) || Array.isArray(v.growth_roadmap) || typeof v.executive_summary === 'string'
}

/** ai_analysis as an analysis, or null (empty, or a narrative written there before 091). */
export function readAiAnalysis(v: unknown): AIAnalysis | null {
  return isAIAnalysis(v) ? v : null
}

/** The narrative of a row: its own column, else a legacy narrative left in ai_analysis. */
export function readNarrative(row: { ai_narrative?: unknown; ai_analysis?: unknown } | null | undefined): PointANarrative | null {
  if (!row) return null
  if (isPointANarrative(row.ai_narrative)) return row.ai_narrative
  if (isPointANarrative(row.ai_analysis)) return row.ai_analysis
  return null
}

/** Keys of the current ai_analysis that the analysis writer does not own (e.g. `gri`, `pulse`). */
export function foreignAnalysisKeys(existing: unknown): Record<string, unknown> {
  if (!isObject(existing)) return {}
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(existing)) {
    if (!ANALYSIS_KEYS.has(k) && !NARRATIVE_KEYS.has(k)) out[k] = v
  }
  return out
}

/** What ai-analyze stores: the new analysis on top of the keys other writers own. */
export function mergeAiAnalysis(existing: unknown, next: AIAnalysis): Record<string, unknown> {
  return { ...foreignAnalysisKeys(existing), ...next }
}

/** A diagnostics row for API responses: ai_analysis only when it really is an analysis. */
export function withReadableAiAnalysis<T extends { ai_analysis?: unknown }>(row: T): T {
  return { ...row, ai_analysis: readAiAnalysis(row.ai_analysis) }
}
