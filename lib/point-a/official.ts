/**
 * lib/point-a/official.ts — THE official Point A of a client (R-033, BI-02).
 *
 * One reader for every screen, bot, AI prompt and agent: the score the Point A
 * page shows, with «нет данных» as null — never a 0.
 *
 * Why it exists. public.diagnostics cannot say «нет данных»: a block v4 could
 * not score kept its v1 block there (unanswered = 0 → «Финансы 0 — критично»),
 * and readers that found no overall recalculated v1 from an incomplete survey
 * (`pointAFromDiagnosticRow(row) ?? calculatePointA(answers)`). The latest
 * point_a_snapshots row knows the truth: its `blocks` are the v4 blocks
 * (score null = no data), `v4.assessment` says whether the full questionnaire
 * was sent, `overall` / `stage` / `v4.health_index` are the v4 result.
 *
 * Rules (PO 2026-11-02, spec 2026-10-23 §7.2):
 *   • before the full questionnaire — `preliminary`: no score, no stage, no
 *     block scores (a «Снимок бизнеса» without numbers), whatever the engine;
 *   • v4 on (config_version «…|v4») — the v4 result of the snapshot is
 *     official; no v4 overall → `no_score` (the blocks that do have data keep
 *     their scores, the overall / stage / health stay null);
 *   • v4 off («…|v1») — the diagnostics row (v1) by the PO setting, but a
 *     block v4 found without data is still `no_data`, not a v1 zero;
 *   • no snapshot (before migration 111, legacy rows) — the diagnostics row;
 *     a missing overall or block column is null, never 0.
 *
 * Pure and client-safe: no runtime import of lib/point-a/v4/engine (node:crypto).
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import type { BlockScore, DataGap, DiagnosticStage, Insight, PointA, QuickWin, Risk } from '@/types/onboarding'
import { isPreliminary, type SnapshotQualityRow } from './blocks-without-data'

export type OfficialState =
  /** No Point A at all (no diagnostic, no snapshot). */
  | 'none'
  /** The full questionnaire is not sent: no numbers (PO 2026-11-02). */
  | 'preliminary'
  /** Sent, but too little data for an overall score (v4 rules). */
  | 'no_score'
  /** An official overall score and stage. */
  | 'scored'

export type OfficialBlockStatus = BlockScore['status'] | 'no_data'

export interface OfficialBlock {
  key: string
  title: string
  /** null = no data (never 0). */
  score: number | null
  status: OfficialBlockStatus
  top_issues: string[]
  recommendations: string[]
  /** Not part of the overall (v4 configuration). */
  informational: boolean
  /** Hidden from the client (expert-only block). */
  hiddenForClient: boolean
  /** 'inferred': an AI hypothesis confirmed by an expert, not facts. */
  basis?: 'facts' | 'inferred'
}

export interface OfficialPointA {
  state: OfficialState
  /** Where the numbers come from. */
  source: 'snapshot_v4' | 'diagnostic_v1' | 'diagnostic' | 'none'
  diagnosticId: string | null
  overall: number | null
  health_index: number | null
  stage: DiagnosticStage | null
  blocks: OfficialBlock[]
  /** Keys of the blocks without data. */
  blocksWithoutData: string[]
  risks: Risk[]
  insights: Insight[]
  quick_wins: QuickWin[]
  data_gaps: DataGap[]
}

/** The five blocks every diagnostics row has (v1 columns), in display order. */
export const CORE_BLOCKS: ReadonlyArray<{ key: string; column: string; title: string }> = [
  { key: 'finance', column: 'finance_score', title: 'Финансы' },
  { key: 'sales', column: 'sales_score', title: 'Продажи' },
  { key: 'operations', column: 'operations_score', title: 'Операции' },
  { key: 'marketing', column: 'marketing_score', title: 'Маркетинг' },
  { key: 'strategy', column: 'strategy_score', title: 'Стратегия' },
]

/** Columns of public.diagnostics the official reader needs. */
export const OFFICIAL_DIAGNOSTIC_COLUMNS =
  'id, overall_score, health_index, stage, finance_score, marketing_score, operations_score, strategy_score, sales_score, risks, insights, quick_wins, data_gaps'

/** Columns of public.point_a_snapshots the official reader needs. */
export const OFFICIAL_SNAPSHOT_COLUMNS = 'engine, config_version, blocks, v4, overall, stage, diagnostic_id'

export interface OfficialSnapshotRow extends SnapshotQualityRow {
  overall?: unknown
  stage?: unknown
  diagnostic_id?: unknown
}

/** Same thresholds as the v1 engine and lib/point-a/v4/engine.ts blockScoreOf. */
export function statusOfScore(score: number): BlockScore['status'] {
  return score >= 85 ? 'excellent' : score >= 70 ? 'strong' : score >= 50 ? 'average' : score >= 30 ? 'weak' : 'critical'
}

const STAGES: ReadonlySet<string> = new Set(['seed', 'early', 'growth', 'scale', 'mature'])

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : null
}

function stageOf(v: unknown): DiagnosticStage | null {
  return typeof v === 'string' && STAGES.has(v) ? (v as DiagnosticStage) : null
}

function strings(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
}

function list<T>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : []
}

function noDataBlock(key: string, title: string, extra: Partial<OfficialBlock> = {}): OfficialBlock {
  return { key, title, score: null, status: 'no_data', top_issues: [], recommendations: [], informational: false, hiddenForClient: false, ...extra }
}

function scoredBlock(key: string, title: string, score: number, src: { top_issues?: unknown; recommendations?: unknown }, extra: Partial<OfficialBlock> = {}): OfficialBlock {
  return {
    key, title, score, status: statusOfScore(score),
    top_issues: strings(src.top_issues), recommendations: strings(src.recommendations),
    informational: false, hiddenForClient: false, ...extra,
  }
}

/** A diagnostics block column → official block (a missing / malformed column is no data). */
function blockFromColumn(key: string, title: string, v: unknown): OfficialBlock {
  const score = v && typeof v === 'object' ? num((v as BlockScore).score) : null
  return score === null ? noDataBlock(key, title) : scoredBlock(key, title, score, v as BlockScore)
}

interface SnapshotBlock {
  key?: unknown
  title?: unknown
  score?: unknown
  top_issues?: unknown
  recommendations?: unknown
  informational?: unknown
  hiddenForClient?: unknown
  order?: unknown
  basis?: unknown
}

/** The v4 blocks of the snapshot (core five first, then the extra blocks in their order). */
function blocksFromSnapshot(raw: unknown): OfficialBlock[] {
  const arr = (Array.isArray(raw) ? raw : []) as SnapshotBlock[]
  const out: OfficialBlock[] = []
  const seen = new Set<string>()
  const toBlock = (b: SnapshotBlock, fallbackTitle: string): OfficialBlock => {
    const key = String(b.key)
    const title = typeof b.title === 'string' && b.title ? b.title : fallbackTitle
    const extra: Partial<OfficialBlock> = {
      informational: b.informational === true,
      hiddenForClient: b.hiddenForClient === true,
      ...(b.basis === 'facts' || b.basis === 'inferred' ? { basis: b.basis } : {}),
    }
    const score = num(b.score)
    return score === null ? noDataBlock(key, title, extra) : scoredBlock(key, title, score, b, extra)
  }
  for (const core of CORE_BLOCKS) {
    const b = arr.find((x) => x?.key === core.key)
    out.push(b ? toBlock(b, core.title) : noDataBlock(core.key, core.title))
    seen.add(core.key)
  }
  const extras = arr
    .filter((b) => typeof b?.key === 'string' && !seen.has(b.key as string))
    .sort((a, b) => (num(a.order) ?? 0) - (num(b.order) ?? 0))
  for (const b of extras) out.push(toBlock(b, String(b.key)))
  return out
}

function v4HealthIndex(snap: OfficialSnapshotRow): number | null {
  const v4 = snap.v4
  return v4 && typeof v4 === 'object' ? num((v4 as { health_index?: unknown }).health_index) : null
}

function v4On(snap: OfficialSnapshotRow | null | undefined): boolean {
  return !!snap && typeof snap.config_version === 'string' && snap.config_version.endsWith('|v4')
}

const EMPTY: OfficialPointA = {
  state: 'none', source: 'none', diagnosticId: null, overall: null, health_index: null, stage: null,
  blocks: CORE_BLOCKS.map((b) => noDataBlock(b.key, b.title)), blocksWithoutData: CORE_BLOCKS.map((b) => b.key),
  risks: [], insights: [], quick_wins: [], data_gaps: [],
}

/**
 * The official Point A from the current diagnostics row and the company's
 * latest snapshot (either may be missing). Pure.
 */
export function officialPointA(
  diagnostic: Record<string, unknown> | null | undefined,
  snapshot: OfficialSnapshotRow | null | undefined,
): OfficialPointA {
  if (!diagnostic && !snapshot) return { ...EMPTY, blocks: EMPTY.blocks.map((b) => ({ ...b })), blocksWithoutData: [...EMPTY.blocksWithoutData] }
  const findings = {
    diagnosticId: diagnostic?.id !== undefined && diagnostic?.id !== null ? String(diagnostic.id) : null,
    risks: list<Risk>(diagnostic?.risks),
    insights: list<Insight>(diagnostic?.insights),
    quick_wins: list<QuickWin>(diagnostic?.quick_wins),
    data_gaps: list<DataGap>(diagnostic?.data_gaps),
  }
  const done = (o: Omit<OfficialPointA, 'blocksWithoutData' | keyof typeof findings>): OfficialPointA => ({
    ...o, ...findings, blocksWithoutData: o.blocks.filter((b) => b.score === null).map((b) => b.key),
  })

  // Before the full questionnaire: no numbers at all, whatever the engine.
  if (isPreliminary(snapshot)) {
    const blocks = Array.isArray(snapshot?.blocks)
      ? blocksFromSnapshot(snapshot!.blocks).map((b) => noDataBlock(b.key, b.title, { informational: b.informational, hiddenForClient: b.hiddenForClient }))
      : CORE_BLOCKS.map((b) => noDataBlock(b.key, b.title))
    return done({ state: 'preliminary', source: v4On(snapshot) ? 'snapshot_v4' : diagnostic ? 'diagnostic' : 'none', overall: null, health_index: null, stage: null, blocks })
  }

  // v4 on: the v4 result of the snapshot is the official Point A.
  if (snapshot && v4On(snapshot) && Array.isArray(snapshot.blocks)) {
    const overall = num(snapshot.overall)
    const blocks = blocksFromSnapshot(snapshot.blocks)
    if (overall === null) return done({ state: 'no_score', source: 'snapshot_v4', overall: null, health_index: null, stage: null, blocks })
    return done({ state: 'scored', source: 'snapshot_v4', overall, health_index: v4HealthIndex(snapshot), stage: stageOf(snapshot.stage), blocks })
  }

  // v4 off (or no snapshot): the diagnostics row, with v4's «нет данных» when known.
  if (!diagnostic) return done({ state: 'none', source: 'none', overall: null, health_index: null, stage: null, blocks: CORE_BLOCKS.map((b) => noDataBlock(b.key, b.title)) })
  const v4NoData = new Set<string>()
  if (snapshot && Array.isArray(snapshot.blocks)) {
    for (const b of snapshot.blocks as SnapshotBlock[]) if (typeof b?.key === 'string' && num(b.score) === null) v4NoData.add(b.key)
  }
  const blocks = CORE_BLOCKS.map((c) => (v4NoData.has(c.key) ? noDataBlock(c.key, c.title) : blockFromColumn(c.key, c.title, diagnostic[c.column])))
  const overall = num(diagnostic.overall_score)
  const source = snapshot ? 'diagnostic_v1' : 'diagnostic'
  if (overall === null) return done({ state: 'no_score', source, overall: null, health_index: null, stage: null, blocks })
  return done({ state: 'scored', source, overall, health_index: num(diagnostic.health_index), stage: stageOf(diagnostic.stage), blocks })
}

/**
 * Drop-in for readers of the raw diagnostics row: the same row with the
 * OFFICIAL numbers — overall / health / stage null without an official score,
 * a block column null when the block has no data (or before the full
 * questionnaire), otherwise the official block. Findings stay as they are.
 * Readers that skip a null column (`typeof block.score !== 'number'`) then
 * stop showing «0 — критично» for blocks nobody answered.
 */
export function officialDiagnosticRow<T extends Record<string, unknown>>(row: T, o: OfficialPointA): T {
  const out: Record<string, unknown> = { ...row }
  const scored = o.state === 'scored'
  out.overall_score = scored ? o.overall : null
  out.health_index = scored ? o.health_index : null
  out.stage = scored ? o.stage : null
  const show = hasOfficialBlockScores(o)
  for (const c of CORE_BLOCKS) {
    if (!(c.column in row)) continue
    const b = o.blocks.find((x) => x.key === c.key)
    const prev = row[c.column] && typeof row[c.column] === 'object' ? (row[c.column] as Record<string, unknown>) : {}
    out[c.column] = show && b && b.score !== null && b.status !== 'no_data'
      ? { ...prev, score: b.score, status: b.status, top_issues: b.top_issues, recommendations: b.recommendations }
      : null
  }
  return out as T
}

/**
 * The legacy PointA shape of an OFFICIAL score, for code that still takes a
 * PointA (the AI analyzer, Point B engines). null unless `state === 'scored'`:
 * no overall → nothing to build on, never a v1 recalculation. A block without
 * data gets a placeholder (score 0) that the caller must NOT read as a score —
 * its key is in `blocksWithoutData`, pass that list on (I2, R-033).
 */
export function pointAFromOfficial(o: OfficialPointA): { pointA: PointA; blocksWithoutData: string[] } | null {
  if (o.state !== 'scored' || o.overall === null) return null
  const blockOf = (key: string): BlockScore => {
    const b = o.blocks.find((x) => x.key === key)
    if (!b || b.score === null || b.status === 'no_data') return { score: 0, status: 'critical', top_issues: [], recommendations: [] }
    return { score: b.score, status: b.status, top_issues: b.top_issues, recommendations: b.recommendations }
  }
  return {
    pointA: {
      overall_score: o.overall,
      health_index: o.health_index ?? o.overall,
      stage: o.stage ?? 'seed',
      blocks: { finance: blockOf('finance'), marketing: blockOf('marketing'), operations: blockOf('operations'), strategy: blockOf('strategy'), sales: blockOf('sales') },
      risks: o.risks, insights: o.insights, quick_wins: o.quick_wins, data_gaps: o.data_gaps,
    },
    blocksWithoutData: CORE_BLOCKS.map((c) => c.key).filter((k) => o.blocksWithoutData.includes(k)),
  }
}

/** The block scores may be shown (the full questionnaire was sent). */
export function hasOfficialBlockScores(o: OfficialPointA): boolean {
  return o.state === 'scored' || o.state === 'no_score'
}

export interface RedBlock {
  key: string
  label: string
  score: number
  status: 'critical' | 'weak'
}

/**
 * The «red zones»: blocks WITH data whose status is critical or weak —
 * critical first, then by score (R-035, BI-46). A block without data is never
 * a red zone; informational and expert-only blocks are left out. Nothing before
 * the full questionnaire.
 */
export function officialRedBlocks(o: OfficialPointA, opts: { includeHidden?: boolean } = {}): RedBlock[] {
  if (!hasOfficialBlockScores(o)) return []
  const rank = (s: string) => (s === 'critical' ? 0 : 1)
  return o.blocks
    .filter((b) => b.score !== null && (b.status === 'critical' || b.status === 'weak') && !b.informational && (opts.includeHidden || !b.hiddenForClient))
    .map((b) => ({ key: b.key, label: b.title, score: b.score as number, status: b.status as 'critical' | 'weak' }))
    .sort((a, b) => rank(a.status) - rank(b.status) || a.score - b.score)
}

/** One block's official score (null = no data or not shown yet). */
export function officialBlockScore(o: OfficialPointA, key: string): number | null {
  if (!hasOfficialBlockScores(o)) return null
  return o.blocks.find((b) => b.key === key)?.score ?? null
}

/** The official overall score, or null (no score / no data). */
export function officialScore(o: OfficialPointA): number | null {
  return o.state === 'scored' ? o.overall : null
}

/**
 * SQL readers (prisma $queryRaw) join the company's latest snapshot as
 * `snap_*` columns (the join below) and turn them back into
 * the snapshot row here. No snapshot joined → null (the row alone).
 *
 *   LEFT JOIN LATERAL (SELECT ps.engine AS snap_engine, ps.config_version AS snap_config_version,
 *     ps.blocks AS snap_blocks, ps.v4 AS snap_v4, ps.overall::float AS snap_overall, ps.stage AS snap_stage
 *     FROM public.point_a_snapshots ps WHERE ps.company_id = <company id>
 *     ORDER BY ps.created_at DESC LIMIT 1) s ON true
 */
export function snapshotFromJoined(row: Record<string, unknown> | null | undefined): OfficialSnapshotRow | null {
  if (!row || (row.snap_config_version == null && row.snap_engine == null && row.snap_blocks == null)) return null
  return { engine: row.snap_engine, config_version: row.snap_config_version, blocks: row.snap_blocks, v4: row.snap_v4, overall: row.snap_overall, stage: row.snap_stage }
}

/**
 * The latest snapshot of the user's company, for officialPointA. Any failure
 * (no company, before migration 111, a read error) → null: the row alone.
 */
export async function loadOfficialSnapshot(client: Pick<SupabaseClient, 'from'>, userId: string): Promise<OfficialSnapshotRow | null> {
  try {
    const { data: company } = await client.from('companies').select('id').eq('user_id', userId).maybeSingle()
    const companyId = (company as { id?: string } | null)?.id
    if (!companyId) return null
    const { data, error } = await client
      .from('point_a_snapshots')
      .select(OFFICIAL_SNAPSHOT_COLUMNS)
      .eq('company_id', companyId)
      .order('created_at', { ascending: false })
      .limit(1)
    if (error) return null
    return ((data ?? []) as unknown as OfficialSnapshotRow[])[0] ?? null
  } catch {
    return null
  }
}

/**
 * Load the official Point A of a user: the current diagnostics row and the
 * latest snapshot of the user's company. A failed snapshot read degrades to
 * the row alone (missing columns stay null); a failed row read is thrown.
 */
export async function getOfficialPointA(client: Pick<SupabaseClient, 'from'>, userId: string): Promise<OfficialPointA> {
  const { data: rows, error } = await client
    .from('diagnostics')
    .select(OFFICIAL_DIAGNOSTIC_COLUMNS)
    .eq('user_id', userId)
    .eq('is_current', true)
    .order('calculated_at', { ascending: false })
    .limit(1)
  if (error) throw new Error(`point-a/official: diagnostic read failed (${error.code ?? 'unknown'})`)
  const diagnostic = ((rows ?? []) as unknown as Array<Record<string, unknown>>)[0] ?? null
  return officialPointA(diagnostic, await loadOfficialSnapshot(client, userId))
}
