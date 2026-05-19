/**
 * Point A history & diff utilities.
 *
 * Reads versioned diagnostic snapshots from `public.diagnostics` (Supabase
 * direct-SQL owned table). Each user has multiple diagnostic rows ordered by
 * `version DESC`; `is_current = true` marks the latest.
 *
 * `computeDiff` is a pure function (no I/O) so it is trivially unit-testable.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type {
  PointA,
  DiagnosticStage,
  BlockScore,
  Risk,
} from '@/types/onboarding'

// ─── Types (locally scoped — do NOT export to types/onboarding.ts) ────────────

export interface PointASnapshot {
  id: string
  version: number
  calculatedAt: string
  overallScore: number | null
  healthIndex: number | null
  stage: string | null
  isCurrent: boolean
}

export interface PointADiff {
  fromVersion: number
  toVersion: number
  overallDelta: number
  /**
   * Per-block score deltas keyed by block name (finance, sales, marketing,
   * operations, strategy). next.score − prev.score.
   */
  blockDeltas: Record<string, number>
  risksAdded: number
  risksResolved: number
}

// Internal row shape from `public.diagnostics`. Kept loose because the table
// is owned by direct SQL and not by Prisma; we only depend on the columns we
// actually read.
interface DiagnosticRow {
  id: string
  version: number
  calculated_at: string
  overall_score: number | null
  health_index: number | null
  stage: string | null
  is_current: boolean
  finance_score?: BlockScore | null
  marketing_score?: BlockScore | null
  operations_score?: BlockScore | null
  strategy_score?: BlockScore | null
  sales_score?: BlockScore | null
  risks?: Risk[] | null
  insights?: PointA['insights'] | null
  quick_wins?: PointA['quick_wins'] | null
  data_gaps?: PointA['data_gaps'] | null
}

const BLOCK_KEYS = [
  'finance',
  'marketing',
  'operations',
  'strategy',
  'sales',
] as const

type BlockKey = (typeof BLOCK_KEYS)[number]

// ─── Mapping helpers ─────────────────────────────────────────────────────────

function rowToSnapshot(row: DiagnosticRow): PointASnapshot {
  return {
    id: row.id,
    version: row.version,
    calculatedAt: row.calculated_at,
    overallScore: row.overall_score,
    healthIndex: row.health_index,
    stage: row.stage,
    isCurrent: row.is_current,
  }
}

function emptyBlock(): BlockScore {
  return { score: 0, status: 'critical', top_issues: [], recommendations: [] }
}

function rowToPointA(row: DiagnosticRow): PointA {
  return {
    overall_score: row.overall_score ?? 0,
    health_index: row.health_index ?? 0,
    stage: (row.stage as DiagnosticStage) ?? 'seed',
    blocks: {
      finance: row.finance_score ?? emptyBlock(),
      marketing: row.marketing_score ?? emptyBlock(),
      operations: row.operations_score ?? emptyBlock(),
      strategy: row.strategy_score ?? emptyBlock(),
      sales: row.sales_score ?? emptyBlock(),
    },
    risks: row.risks ?? [],
    insights: row.insights ?? [],
    quick_wins: row.quick_wins ?? [],
    data_gaps: row.data_gaps ?? [],
  }
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * List snapshot summaries for a user, newest version first.
 * Returns `[]` on error or no rows.
 */
export async function listPointASnapshots(
  supabase: SupabaseClient,
  userId: string,
  limit?: number,
): Promise<PointASnapshot[]> {
  let query = supabase
    .from('diagnostics')
    .select(
      'id, version, calculated_at, overall_score, health_index, stage, is_current',
    )
    .eq('user_id', userId)
    .order('version', { ascending: false })

  if (typeof limit === 'number' && limit > 0) {
    query = query.limit(limit)
  }

  const { data, error } = await query
  if (error || !data) return []
  return (data as DiagnosticRow[]).map(rowToSnapshot)
}

/**
 * Load a specific version's full PointA payload. Returns `null` if not found.
 */
export async function getPointAByVersion(
  supabase: SupabaseClient,
  userId: string,
  version: number,
): Promise<PointA | null> {
  const { data, error } = await supabase
    .from('diagnostics')
    .select('*')
    .eq('user_id', userId)
    .eq('version', version)
    .maybeSingle()

  if (error || !data) return null
  return rowToPointA(data as DiagnosticRow)
}

/**
 * Risk identity used to count added/resolved across versions. Uses
 * `area + text` because diagnostics may regenerate risks without stable ids.
 */
function riskKey(r: Risk): string {
  return `${r.area}::${r.text}`
}

/**
 * Pure diff. No I/O.
 *
 * - `overallDelta` = next.overall_score − prev.overall_score
 * - `blockDeltas[k]` = next.blocks[k].score − prev.blocks[k].score
 * - `risksAdded`    = risks in next that weren't in prev (by area+text)
 * - `risksResolved` = risks in prev that aren't in next
 *
 * `fromVersion` / `toVersion` are not derivable from PointA itself, so the
 * caller stamps them in. We default to 0 to keep the function self-contained
 * for the simplest "are these equal?" usage in tests.
 */
export function computeDiff(
  prev: PointA,
  next: PointA,
  fromVersion = 0,
  toVersion = 0,
): PointADiff {
  const blockDeltas: Record<string, number> = {}
  for (const k of BLOCK_KEYS) {
    const key = k as BlockKey
    const prevScore = prev.blocks?.[key]?.score ?? 0
    const nextScore = next.blocks?.[key]?.score ?? 0
    blockDeltas[key] = nextScore - prevScore
  }

  const prevKeys = new Set((prev.risks ?? []).map(riskKey))
  const nextKeys = new Set((next.risks ?? []).map(riskKey))

  let risksAdded = 0
  for (const k of nextKeys) if (!prevKeys.has(k)) risksAdded++
  let risksResolved = 0
  for (const k of prevKeys) if (!nextKeys.has(k)) risksResolved++

  return {
    fromVersion,
    toVersion,
    overallDelta: (next.overall_score ?? 0) - (prev.overall_score ?? 0),
    blockDeltas,
    risksAdded,
    risksResolved,
  }
}
