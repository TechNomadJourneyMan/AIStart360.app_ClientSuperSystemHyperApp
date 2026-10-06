/**
 * lib/diagnostics/scoring.ts — the Point A score inside the pipeline.
 *
 * Same calculation as POST /api/v1/diagnostics/recalculate (rule engine over
 * the owner's survey answers, materialised non-survey metric values first),
 * with one difference: when the result equals the current diagnostic (the
 * engine is deterministic, so equal inputs give an equal result), the current
 * row is reused and linked to the session instead of creating an identical
 * new version — it keeps its AI analysis and history stays meaningful.
 */
import { prisma } from '@/lib/db'
import { calculatePointA, type PointAResolvedInputs } from '@/lib/point-a-engine'
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

interface DiagnosticRow {
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

const EMPTY_BLOCK: BlockScore = { score: 0, status: 'critical', top_issues: [], recommendations: [] }

function rowToPointA(r: DiagnosticRow): PointA {
  return {
    overall_score: Number(r.overall_score ?? 0),
    health_index: Number(r.health_index ?? 0),
    stage: (r.stage ?? 'seed') as PointA['stage'],
    blocks: {
      finance: r.finance_score ?? EMPTY_BLOCK,
      sales: r.sales_score ?? EMPTY_BLOCK,
      operations: r.operations_score ?? EMPTY_BLOCK,
      marketing: r.marketing_score ?? EMPTY_BLOCK,
      strategy: r.strategy_score ?? EMPTY_BLOCK,
    },
    risks: r.risks ?? [],
    insights: r.insights ?? [],
    quick_wins: r.quick_wins ?? [],
    data_gaps: r.data_gaps ?? [],
  }
}

const DIAG_COLUMNS = `id, overall_score::text, health_index::text, stage, finance_score, sales_score, operations_score,
  marketing_score, strategy_score, risks, insights, quick_wins, data_gaps, calculated_at`

/** A diagnostics row as Point A, by id, restricted to the company. */
export async function diagnosticById(companyId: string, id: string): Promise<{ id: string; pointA: PointA; calculatedAt: Date } | null> {
  const rows = await prisma.$queryRawUnsafe<DiagnosticRow[]>(
    `SELECT ${DIAG_COLUMNS} FROM public.diagnostics WHERE id = $1::uuid AND company_id = $2`, id, companyId)
  const r = rows[0]
  return r ? { id: r.id, pointA: rowToPointA(r), calculatedAt: r.calculated_at } : null
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
  pointA: PointA
  calculatedAt: Date
  answeredKeys: number
}

export class NoSurveyDataError extends Error {
  constructor() {
    super('Анкета компании не заполнена — индекс Точки А не из чего считать')
    this.name = 'NoSurveyDataError'
  }
}

/**
 * Score the company for a session: reuse the current diagnostic when nothing
 * changed since it was calculated, otherwise calculate and store a new current
 * version (the previous one stays as history).
 */
export async function scoreCompany(companyId: string, sessionId: string | null): Promise<ScoreResult> {
  const company = await companyProfile(companyId)
  if (!company?.ownerId) throw new NoSurveyDataError()
  const answers = await surveyAnswers(company.ownerId)
  const answeredKeys = Object.keys(answers).length
  if (answeredKeys === 0) throw new NoSurveyDataError()

  const pointA = calculatePointA(answers, await resolvedInputs(companyId))
  const currentRows = await prisma.$queryRawUnsafe<DiagnosticRow[]>(
    `SELECT ${DIAG_COLUMNS} FROM public.diagnostics WHERE user_id = $1::uuid AND is_current ORDER BY calculated_at DESC LIMIT 1`,
    company.ownerId)
  const current = currentRows[0]
  if (current && samePointA(rowToPointA(current), pointA)) {
    await prisma.$executeRaw`
      UPDATE public.diagnostics SET session_id = ${sessionId}::uuid, company_id = coalesce(company_id, ${companyId})
      WHERE id = ${current.id}::uuid`
    return { diagnosticId: current.id, reused: true, pointA: rowToPointA(current), calculatedAt: current.calculated_at, answeredKeys }
  }

  const j = (v: unknown) => JSON.stringify(v ?? null)
  const inserted = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`
      UPDATE public.diagnostics SET is_current = FALSE WHERE user_id = ${company.ownerId}::uuid AND is_current`
    return tx.$queryRaw<Array<{ id: string; calculated_at: Date }>>`
      INSERT INTO public.diagnostics
        (user_id, company_id, session_id, overall_score, health_index, stage,
         finance_score, marketing_score, operations_score, strategy_score, sales_score,
         risks, insights, quick_wins, data_gaps, is_current, ai_status)
      VALUES (${company.ownerId}::uuid, ${companyId}, ${sessionId}::uuid,
              ${String(pointA.overall_score)}::text::numeric, ${String(pointA.health_index)}::text::numeric, ${pointA.stage},
              ${j(pointA.blocks.finance)}::jsonb, ${j(pointA.blocks.marketing)}::jsonb, ${j(pointA.blocks.operations)}::jsonb,
              ${j(pointA.blocks.strategy)}::jsonb, ${j(pointA.blocks.sales)}::jsonb,
              ${j(pointA.risks)}::jsonb, ${j(pointA.insights)}::jsonb, ${j(pointA.quick_wins)}::jsonb, ${j(pointA.data_gaps)}::jsonb,
              TRUE, 'none')
      RETURNING id, calculated_at`
  })
  return { diagnosticId: inserted[0].id, reused: false, pointA, calculatedAt: inserted[0].calculated_at, answeredKeys }
}
