/**
 * lib/diagnostics/scoring.ts — the Point A score inside the pipeline.
 *
 * R-034 (BI-47): the pipeline NEVER calculates or writes Point A itself. It
 * runs the one official recalculation (lib/point-a/snapshot.ts — v4 rules,
 * «балл только после отправки полной анкеты», «нет данных» = no score) and
 * links the resulting current diagnostic to the session. It used to run the
 * v1 engine on ≥1 answer and insert it as `is_current`: a score and stage
 * before the questionnaire was sent, unanswered blocks as «critical», and a
 * v1 row replacing the v4 one.
 *
 * When the snapshot says «nothing changed» the current row was verified
 * against the current inputs: its calculated_at moves to now (the overview
 * would otherwise call it «stale» right after a successful run).
 */
import { prisma } from '@/lib/db'
import type { PointAResolvedInputs } from '@/lib/point-a-engine'
import { officialDiagnosticRow, officialPointA, type OfficialPointA, type OfficialSnapshotRow } from '@/lib/point-a/official'
import type { SnapshotResult } from '@/lib/point-a/snapshot'
import { RESOLVED_INPUT_METRICS, resolvedInputsFromMetricRows, type ResolvedMetricRow } from '@/lib/point-a/resolved-inputs'
import type { BlockScore, DataGap, Insight, PointA, QuickWin, Risk } from '@/types/onboarding'
import { stableStringify } from '@/lib/agents/tools'

export interface CompanyProfile {
  id: string
  name: string | null
  ownerId: string | null
  industry: string | null
  stage: string | null
  size: string | null
  businessModel: string | null
}

export async function companyProfile(companyId: string): Promise<CompanyProfile | null> {
  const rows = await prisma.$queryRaw<Array<{ id: string; name: string | null; user_id: string | null; industry: string | null; stage: string | null; size: string | null; business_model: string | null }>>`
    SELECT id, name, user_id::text AS user_id, industry, stage, size, business_model
    FROM public.companies WHERE id = ${companyId}`
  const r = rows[0]
  if (!r) return null
  return { id: r.id, name: r.name, ownerId: r.user_id, industry: r.industry, stage: r.stage, size: r.size, businessModel: r.business_model }
}

export async function surveyAnswers(ownerId: string): Promise<Record<string, unknown>> {
  const rows = await prisma.$queryRaw<Array<{ question_key: string; answer: unknown }>>`
    SELECT question_key, answer FROM public.survey_answers WHERE user_id = ${ownerId}::uuid`
  const answers: Record<string, unknown> = {}
  for (const r of rows) {
    const a = r.answer
    answers[r.question_key] = a && typeof a === 'object' && !Array.isArray(a) && 'value' in a ? (a as { value: unknown }).value : a
  }
  return answers
}

export async function resolvedInputs(companyId: string): Promise<PointAResolvedInputs> {
  const ids = Object.values(RESOLVED_INPUT_METRICS).flat()
  const rows = await prisma.$queryRaw<ResolvedMetricRow[]>`
    SELECT metric_key, metric_value::text AS metric_value, source, computed_at::text AS computed_at
    FROM public.metrics WHERE company_id = ${companyId} AND metric_key = ANY(${ids}::text[])`
  return resolvedInputsFromMetricRows(rows)
}

export interface DiagnosticRow {
  id: string
  overall_score: string | null
  health_index: string | null
  stage: string | null
  finance_score: BlockScore | null
  sales_score: BlockScore | null
  operations_score: BlockScore | null
  marketing_score: BlockScore | null
  strategy_score: BlockScore | null
  risks: Risk[] | null
  insights: Insight[] | null
  quick_wins: QuickWin[] | null
  data_gaps: DataGap[] | null
  calculated_at: Date
}

/**
 * PointA view of a row for the agent steps (benchmarks, hypotheses,
 * recommendations). A block column without data stays NULL at runtime (R-034,
 * BI-47) — it used to become `{ score: 0, status: 'critical' }`, i.e. «нет
 * данных» read as «критично»; every agent step skips a block whose score is not
 * a number. Callers pass the row through officialDiagnosticRow first, so the
 * v1 zeros of blocks v4 found without data are null too. An overall without a
 * score reads 0 here — read `official` for it.
 */
const NO_BLOCK = null as unknown as BlockScore

function rowToPointA(r: DiagnosticRow): PointA {
  return {
    overall_score: Number(r.overall_score ?? 0),
    health_index: Number(r.health_index ?? 0),
    stage: (r.stage ?? 'seed') as PointA['stage'],
    blocks: {
      finance: r.finance_score ?? NO_BLOCK,
      sales: r.sales_score ?? NO_BLOCK,
      operations: r.operations_score ?? NO_BLOCK,
      marketing: r.marketing_score ?? NO_BLOCK,
      strategy: r.strategy_score ?? NO_BLOCK,
    },
    risks: r.risks ?? [],
    insights: r.insights ?? [],
    quick_wins: r.quick_wins ?? [],
    data_gaps: r.data_gaps ?? [],
  }
}

const DIAG_COLUMNS = `id, overall_score::text, health_index::text, stage, finance_score, sales_score, operations_score,
  marketing_score, strategy_score, risks, insights, quick_wins, data_gaps, calculated_at`

/** The snapshot that wrote a diagnostic (or the company's latest one); null before migration 111. */
async function snapshotFor(companyId: string, diagnosticId: string | null): Promise<OfficialSnapshotRow | null> {
  try {
    const rows = diagnosticId
      ? await prisma.$queryRaw<OfficialSnapshotRow[]>`
          SELECT engine, config_version, blocks, v4, overall::text AS overall, stage, diagnostic_id::text AS diagnostic_id
          FROM public.point_a_snapshots WHERE company_id = ${companyId} AND diagnostic_id = ${diagnosticId}::uuid
          ORDER BY created_at DESC LIMIT 1`
      : await prisma.$queryRaw<OfficialSnapshotRow[]>`
          SELECT engine, config_version, blocks, v4, overall::text AS overall, stage, diagnostic_id::text AS diagnostic_id
          FROM public.point_a_snapshots WHERE company_id = ${companyId}
          ORDER BY created_at DESC LIMIT 1`
    return rows[0] ?? null
  } catch {
    return null
  }
}

/**
 * A diagnostics row as Point A, by id, restricted to the company. `official`
 * is the honest reading (lib/point-a/official.ts): «нет данных» = null.
 */
export async function diagnosticById(companyId: string, id: string): Promise<{ id: string; pointA: PointA; official: OfficialPointA; calculatedAt: Date } | null> {
  const rows = await prisma.$queryRawUnsafe<DiagnosticRow[]>(
    `SELECT ${DIAG_COLUMNS} FROM public.diagnostics WHERE id = $1::uuid AND company_id = $2`, id, companyId)
  const r = rows[0]
  if (!r) return null
  const official = officialPointA(r as unknown as Record<string, unknown>, await snapshotFor(companyId, r.id))
  return { id: r.id, pointA: rowToPointA(officialDiagnosticRow(r as unknown as Record<string, unknown>, official) as unknown as DiagnosticRow), official, calculatedAt: r.calculated_at }
}

/** Equal engine output (after a JSON round trip, as stored in jsonb columns). */
export function samePointA(a: PointA, b: PointA): boolean {
  const norm = (p: PointA) => stableStringify(JSON.parse(JSON.stringify({
    overall_score: Number(p.overall_score), health_index: Number(p.health_index), stage: p.stage, blocks: p.blocks,
    risks: p.risks, insights: p.insights, quick_wins: p.quick_wins, data_gaps: p.data_gaps,
  })))
  return norm(a) === norm(b)
}

export interface ScoreResult {
  diagnosticId: string
  reused: boolean
  /** PointA view of the official row: a block without data is null; an overall without a score reads 0 — use `official`. */
  pointA: PointA
  /** The official Point A (R-033): null score / stage / blocks where there is no data. */
  official: OfficialPointA
  calculatedAt: Date
  answeredKeys: number
}

export class NoSurveyDataError extends Error {
  constructor() {
    super('Анкета компании не заполнена — индекс Точки А не из чего считать')
    this.name = 'NoSurveyDataError'
  }
}

/** The official recalculation produced no current diagnostic (busy with none yet, before migration 111). */
export class PointAUnavailableError extends Error {
  constructor(reason: string) {
    super(`Точка А компании пока не рассчитана (${reason}) — пересчёт идёт через официальный снимок`)
    this.name = 'PointAUnavailableError'
  }
}

/** What scoreViaSnapshot needs from the world (prisma in production, fakes in tests). */
export interface ScoringIO {
  profile: (companyId: string) => Promise<CompanyProfile | null>
  answeredKeys: (ownerId: string) => Promise<number>
  /** The ONE official recalculation (lib/point-a/snapshot.ts). */
  snapshot: (companyId: string) => Promise<SnapshotResult>
  currentRow: (ownerId: string) => Promise<DiagnosticRow | null>
  snapshotRow: (companyId: string, diagnosticId: string) => Promise<OfficialSnapshotRow | null>
  /** Link the row to the session; `verified` also moves calculated_at to now. Returns the new calculated_at. */
  link: (row: DiagnosticRow, o: { sessionId: string | null; companyId: string; verified: boolean }) => Promise<Date>
}

/**
 * Score the company for a session through the official snapshot only (R-034).
 * No v1 calculation, no insert of its own: the row is whatever the snapshot
 * path wrote — v4, preliminary (no score) before the full questionnaire, or
 * no score when v4 found too little data.
 */
export async function scoreViaSnapshot(io: ScoringIO, companyId: string, sessionId: string | null): Promise<ScoreResult> {
  const company = await io.profile(companyId)
  if (!company?.ownerId) throw new NoSurveyDataError()
  const answeredKeys = await io.answeredKeys(company.ownerId)
  if (answeredKeys === 0) throw new NoSurveyDataError()

  const r = await io.snapshot(companyId).catch((err: unknown) => {
    console.error('[diagnostics/scoring] snapshot failed', err instanceof Error ? err.message : err)
    return null
  })
  if (r?.status === 'skipped' && (r.reason === 'no_answers' || r.reason === 'no_owner')) throw new NoSurveyDataError()

  const row = await io.currentRow(company.ownerId)
  if (!row) throw new PointAUnavailableError(r ? (r.status === 'skipped' ? r.reason : r.status) : 'error')
  const calculatedAt = await io.link(row, { sessionId, companyId, verified: r?.status === 'unchanged' })
  const official = officialPointA(row as unknown as Record<string, unknown>, await io.snapshotRow(companyId, row.id))
  const pointA = rowToPointA(officialDiagnosticRow(row as unknown as Record<string, unknown>, official) as unknown as DiagnosticRow)
  return { diagnosticId: row.id, reused: r?.status !== 'written', pointA, official, calculatedAt, answeredKeys }
}

const prismaIO: ScoringIO = {
  profile: companyProfile,
  answeredKeys: async (ownerId) => Object.keys(await surveyAnswers(ownerId)).length,
  snapshot: async (companyId) => {
    const { buildPointASnapshot } = await import('@/lib/point-a/snapshot')
    return buildPointASnapshot(companyId, { trigger: 'event', reasons: ['DIAGNOSTIC_PIPELINE'], lock: true, fromPipeline: true })
  },
  currentRow: async (ownerId) => {
    const rows = await prisma.$queryRawUnsafe<DiagnosticRow[]>(
      `SELECT ${DIAG_COLUMNS} FROM public.diagnostics WHERE user_id = $1::uuid AND is_current ORDER BY calculated_at DESC LIMIT 1`, ownerId)
    return rows[0] ?? null
  },
  snapshotRow: (companyId, diagnosticId) => snapshotFor(companyId, diagnosticId),
  link: async (row, { sessionId, companyId, verified }) => {
    const touched = verified
      ? await prisma.$queryRaw<Array<{ calculated_at: Date }>>`
          UPDATE public.diagnostics SET session_id = ${sessionId}::uuid, company_id = coalesce(company_id, ${companyId}), calculated_at = now()
          WHERE id = ${row.id}::uuid RETURNING calculated_at`
      : await prisma.$queryRaw<Array<{ calculated_at: Date }>>`
          UPDATE public.diagnostics SET session_id = ${sessionId}::uuid, company_id = coalesce(company_id, ${companyId})
          WHERE id = ${row.id}::uuid RETURNING calculated_at`
    return touched[0]?.calculated_at ?? row.calculated_at
  },
}

/**
 * Score the company for a session (R-034): the official snapshot recalculation
 * (a no-op when the inputs are unchanged), then the current diagnostic linked
 * to the session. `io` is for tests.
 */
export async function scoreCompany(companyId: string, sessionId: string | null, io: Partial<ScoringIO> = {}): Promise<ScoreResult> {
  return scoreViaSnapshot({ ...prismaIO, ...io }, companyId, sessionId)
}
