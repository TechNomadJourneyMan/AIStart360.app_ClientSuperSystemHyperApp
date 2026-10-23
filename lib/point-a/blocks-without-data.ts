/**
 * lib/point-a/blocks-without-data.ts — which Point A blocks have NO data, for
 * every reader of the current diagnostic (spec 2026-10-23 §7.2, §17 «v1-нули»).
 *
 * The diagnostics row cannot say «нет данных»: a block v4 could not score keeps
 * its v1 block there (lib/point-a/v4/engine.ts toCompatPointA), and when v4 has
 * no overall at all the whole row is v1 — where an unanswered question is 0.
 * After the express flow that is most blocks: read as scores they become
 * «weak» blocks, the goal realism drops a level and Reality Check reports
 * «Точка А оценивает финансы в 12/100 (критично)» for a block nobody answered.
 *
 * The latest point_a_snapshots row knows better: its `blocks` are always the
 * v4 blocks (score null = no data). They are the truth when the row is v4,
 * and also when the row is a v1 FALLBACK (v4 on, `config_version` ends with
 * «|v4», but no v4 overall). Only with v4 switched off does the v1 row stand,
 * and then a block is «without data» only when its column is missing.
 */
import type { SupabaseClient } from '@supabase/supabase-js'

/** v1 block columns of public.diagnostics. */
export const DIAGNOSTIC_BLOCK_COLUMNS: ReadonlyArray<readonly [string, string]> = [
  ['finance', 'finance_score'],
  ['sales', 'sales_score'],
  ['operations', 'operations_score'],
  ['marketing', 'marketing_score'],
  ['strategy', 'strategy_score'],
]

export interface SnapshotQualityRow {
  engine?: unknown
  config_version?: unknown
  blocks?: unknown
}

/** The diagnostics row is v1 only because v4 had no overall (v4 is on). */
export function isV1Fallback(snap: SnapshotQualityRow | null | undefined): boolean {
  return !!snap && snap.engine === 'v1' && typeof snap.config_version === 'string' && snap.config_version.endsWith('|v4')
}

/** Blocks (keys) without data. */
export function blocksWithoutDataOf(snap: SnapshotQualityRow | null | undefined, diagnostic: Record<string, unknown> | null | undefined): string[] {
  if (snap && Array.isArray(snap.blocks) && (snap.engine === 'v4' || isV1Fallback(snap))) {
    const out: string[] = []
    for (const b of snap.blocks as Array<{ key?: unknown; score?: unknown; informational?: unknown }>) {
      if (typeof b?.key === 'string' && (b.score === null || b.score === undefined)) out.push(b.key)
    }
    return out
  }
  if (!diagnostic) return []
  return DIAGNOSTIC_BLOCK_COLUMNS.filter(([, col]) => { const v = diagnostic[col]; return !v || typeof v !== 'object' }).map(([key]) => key)
}

export interface PointAQuality {
  blocksWithoutData: string[]
  /** The diagnostics row is a v1 fallback: its overall / health index are v1 zeros-for-unanswered. */
  v1Fallback: boolean
}

/** The latest snapshot of the user's company → quality of the current diagnostic. Errors → nothing known. */
export async function loadPointAQuality(client: Pick<SupabaseClient, 'from'>, userId: string): Promise<PointAQuality> {
  try {
    const { data: company } = await client.from('companies').select('id').eq('user_id', userId).maybeSingle()
    const companyId = (company as { id?: string } | null)?.id
    if (!companyId) return { blocksWithoutData: [], v1Fallback: false }
    const { data, error } = await client
      .from('point_a_snapshots')
      .select('engine, config_version, blocks')
      .eq('company_id', companyId)
      .order('created_at', { ascending: false })
      .limit(1)
    if (error) return { blocksWithoutData: [], v1Fallback: false }
    const snap = ((data ?? []) as SnapshotQualityRow[])[0] ?? null
    return { blocksWithoutData: blocksWithoutDataOf(snap, null), v1Fallback: isV1Fallback(snap) }
  } catch {
    return { blocksWithoutData: [], v1Fallback: false }
  }
}
