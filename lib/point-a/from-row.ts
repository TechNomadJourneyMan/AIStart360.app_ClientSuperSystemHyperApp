/**
 * lib/point-a/from-row.ts — the stored Point A of a public.diagnostics row.
 *
 * Point A is calculated once (lib/point-a/snapshot.ts, recalculate route) and
 * READ everywhere else: an AI analysis, the next best action or Point B that
 * recalculated it from the survey alone used another score than the client
 * sees (no document / manual values, no v4).
 */
import type { BlockScore, PointA } from '@/types/onboarding'

export const DIAGNOSTIC_POINT_A_COLUMNS =
  'id, overall_score, health_index, stage, finance_score, marketing_score, operations_score, strategy_score, sales_score, risks, insights, quick_wins, data_gaps'

function block(v: unknown): BlockScore | null {
  return v && typeof v === 'object' && typeof (v as BlockScore).score === 'number' ? (v as BlockScore) : null
}

export function pointAFromDiagnosticRow(row: Record<string, unknown> | null | undefined): PointA | null {
  if (!row || row.overall_score === null || row.overall_score === undefined) return null
  const finance = block(row.finance_score)
  const marketing = block(row.marketing_score)
  const operations = block(row.operations_score)
  const strategy = block(row.strategy_score)
  const sales = block(row.sales_score)
  if (!finance || !marketing || !operations || !strategy || !sales) return null
  const list = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : [])
  return {
    overall_score: Number(row.overall_score),
    health_index: Number(row.health_index ?? 0),
    stage: (row.stage as PointA['stage']) ?? 'seed',
    blocks: { finance, marketing, operations, strategy, sales },
    risks: list(row.risks),
    insights: list(row.insights),
    quick_wins: list(row.quick_wins),
    data_gaps: list(row.data_gaps),
  }
}
