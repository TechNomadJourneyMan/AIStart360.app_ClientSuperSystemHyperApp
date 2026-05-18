/**
 * Normalize a diagnostics row into a uniform block_scores map.
 *
 * The Supabase schema stores 5 separate JSONB columns (finance_score,
 * sales_score, marketing_score, operations_score, strategy_score). The
 * code historically read d.block_scores expecting a unified map — that
 * column doesn't exist, so every consumer got {}. This helper bridges.
 */

export interface BlockScoreShape {
  score: number
  max: number
  status?: string
  top_issues?: string[]
  recommendations?: string[]
}

const BLOCK_KEYS = ['finance', 'sales', 'marketing', 'operations', 'strategy'] as const
export type BlockKey = (typeof BLOCK_KEYS)[number]

const COLUMN_NAMES: Record<BlockKey, string> = {
  finance: 'finance_score',
  sales: 'sales_score',
  marketing: 'marketing_score',
  operations: 'operations_score',
  strategy: 'strategy_score',
}

/** Pull block scores from either the historical block_scores JSONB
 *  (if it ever existed) or the 5 split columns. Returns a unified map. */
export function readBlockScores(diag: Record<string, unknown> | null | undefined): Record<BlockKey, BlockScoreShape> {
  const out = {} as Record<BlockKey, BlockScoreShape>
  if (!diag) return out

  // Case 1: legacy/unified column actually populated
  const unified = diag.block_scores as Record<string, BlockScoreShape> | null | undefined
  if (unified && typeof unified === 'object' && Object.keys(unified).length > 0) {
    for (const k of BLOCK_KEYS) {
      if (unified[k]) out[k] = normalize(unified[k])
    }
    if (Object.keys(out).length > 0) return out
  }

  // Case 2: split JSONB columns (actual schema in 001_onboarding_system.sql)
  for (const k of BLOCK_KEYS) {
    const raw = diag[COLUMN_NAMES[k]] as BlockScoreShape | null | undefined
    if (raw) out[k] = normalize(raw)
  }
  return out
}

function normalize(raw: unknown): BlockScoreShape {
  if (!raw || typeof raw !== 'object') return { score: 0, max: 10 }
  const r = raw as Record<string, unknown>
  return {
    score: typeof r.score === 'number' ? r.score : 0,
    max: typeof r.max === 'number' ? r.max : 10,
    status: typeof r.status === 'string' ? r.status : undefined,
    top_issues: Array.isArray(r.top_issues) ? (r.top_issues as string[]) : undefined,
    recommendations: Array.isArray(r.recommendations) ? (r.recommendations as string[]) : undefined,
  }
}

export const BLOCK_LIST = [...BLOCK_KEYS]
