export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/export/report?type=gri|point-a|point-b|survey[&companyId=<id>]
 *
 * Renders a branded, Cyrillic-correct PDF of the caller's GRI / Точка А /
 * Точка Б / onboarding survey and streams it back as an attachment.
 *
 * AUTH:
 *   • The report always defaults to the CURRENT authenticated user's own data.
 *   • An optional `companyId` lets staff (expert / admin / super_admin) export a
 *     specific company's report (powers the SHARE feature + expert/admin views).
 *     Non-staff callers may pass companyId ONLY if they own that company; any
 *     other companyId is ignored and we fall back to their own data — so a
 *     client can never read another client's report (IDOR-safe).
 *
 * On missing data → 404 JSON { error: 'no_data' }.
 *
 * Data loading mirrors the existing v1 routes:
 *   • Point A      ← public.diagnostics (is_current) + ai_analysis  (see
 *                    app/api/v1/diagnostics/current + ai-status)
 *   • Point B      ← lib/point-b/engine.calculatePointBV2 over the latest
 *                    diagnostic + survey answers (see
 *                    app/api/v1/diagnostics/point-b/route.ts)
 *   • GRI          ← public.gri_assessments (is_current)  (see
 *                    app/api/v1/gri/assessment + app/api/gri/baseline)
 *   • Survey       ← public.survey_answers
 */

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase-server'
import { requireExpert } from '@/lib/expert-auth'
import {
  renderGriPdf,
  renderPointAPdf,
  renderPointBPdf,
  renderSurveyPdf,
  type ReportMeta,
  type GriPdfInput,
  type PointAPdfInput,
  type PointBPdfInput,
  type SurveyPdfInput,
} from '@/lib/reports/pdf'
import { calculatePointBV2, type PointBOptions } from '@/lib/point-b/engine'
import type { PointA, BlockScore, AIAnalysis } from '@/types/onboarding'
import type { PointBStrategy } from '@/types/point-b'

type ReportType = 'gri' | 'point-a' | 'point-b' | 'survey'
const VALID_TYPES = new Set<ReportType>(['gri', 'point-a', 'point-b', 'survey'])

const NO_DATA = NextResponse.json({ error: 'no_data' }, { status: 404 })

// ─── Block label maps ────────────────────────────────────────────────────────

const POINT_A_BLOCK_LABELS: Record<string, string> = {
  finance: 'Финансы',
  sales: 'Продажи',
  operations: 'Операции',
  marketing: 'Маркетинг',
  strategy: 'Стратегия',
}

// gri_assessments.section_avgs is keyed by SectionId (see lib/gri-assessment/sections.ts).
const GRI_SECTION_LABELS: Record<string, string> = {
  'product-demand': 'Продукт и спрос',
  'trust-positioning': 'Доверие и позиционирование',
  'business-model': 'Бизнес-модель',
  'cash-stability': 'Стабильность кэша',
  operations: 'Операции',
  team: 'Команда',
  'owner-readiness': 'Готовность собственника',
}
const GRI_SECTION_ORDER = [
  'product-demand',
  'trust-positioning',
  'business-model',
  'cash-stability',
  'operations',
  'team',
  'owner-readiness',
]

// ─── Helpers ─────────────────────────────────────────────────────────────────

const EMPTY_BLOCK: BlockScore = { score: 0, status: 'critical', top_issues: [], recommendations: [] }

function diagToPointA(diag: Record<string, unknown>): PointA {
  const block = (k: string): BlockScore => {
    const v = diag[k] as BlockScore | null
    return v && typeof v === 'object' ? v : EMPTY_BLOCK
  }
  return {
    overall_score: (diag.overall_score as number) ?? 0,
    health_index: (diag.health_index as number) ?? 0,
    stage: (diag.stage as PointA['stage']) ?? 'seed',
    blocks: {
      finance: block('finance_score'),
      marketing: block('marketing_score'),
      operations: block('operations_score'),
      strategy: block('strategy_score'),
      sales: block('sales_score'),
    },
    risks: (diag.risks as PointA['risks']) ?? [],
    insights: (diag.insights as PointA['insights']) ?? [],
    quick_wins: (diag.quick_wins as PointA['quick_wins']) ?? [],
    data_gaps: (diag.data_gaps as PointA['data_gaps']) ?? [],
  }
}

function num(v: unknown): number | null {
  if (v == null) return null
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : null
}

function mapGriTop5(raw: unknown): PointBOptions['griTop5'] {
  if (!Array.isArray(raw)) return undefined
  return raw
    .map((item, i) => {
      if (!item || typeof item !== 'object') return null
      const o = item as Record<string, unknown>
      const title = String(o.title ?? o.label ?? o.name ?? o.criterionText ?? o.criterion ?? '').trim()
      if (!title) return null
      return {
        rank: typeof o.rank === 'number' ? o.rank : i + 1,
        title,
        block: String(o.block ?? o.blockId ?? o.section ?? ''),
        severity: String(o.severity ?? o.level ?? 'high'),
      }
    })
    .filter((x): x is NonNullable<typeof x> => x !== null)
}

/** Build a survey answers map (question_key → unwrapped value) for a user. */
function answersFromRows(
  rows: Array<{ question_key: string; answer: unknown }> | null,
): Record<string, unknown> {
  const answers: Record<string, unknown> = {}
  for (const row of rows ?? []) {
    const a = row.answer as { value?: unknown } | unknown
    answers[row.question_key] =
      a && typeof a === 'object' && 'value' in a ? (a as { value?: unknown }).value : a
  }
  return answers
}

// ─── Subject resolution (whose report) ───────────────────────────────────────

interface Subject {
  userId: string
  companyName: string
  industry: string | null
  stage: string | null
  companyId: string | null
}

/**
 * Resolve the report subject. Defaults to the authenticated caller. A
 * `companyId` is honored only when the caller is staff OR owns that company.
 * Returns null when the requested company can't be resolved / authorized.
 */
async function resolveSubject(
  sb: ReturnType<typeof createServerClient>,
  callerId: string,
  requestedCompanyId: string | null,
): Promise<Subject | null> {
  // No companyId → the caller exports their own report.
  if (!requestedCompanyId) {
    const { data: comp } = await sb
      .from('companies')
      .select('id, name, industry, stage')
      .eq('user_id', callerId)
      .limit(1)
      .maybeSingle()
    return {
      userId: callerId,
      companyName: (comp?.name as string) || 'Компания',
      industry: (comp?.industry as string) ?? null,
      stage: (comp?.stage as string) ?? null,
      companyId: (comp?.id as string) ?? null,
    }
  }

  // companyId provided → look it up (RLS scopes the row to owned companies for
  // a non-staff caller; staff are resolved via service-role below).
  const { data: ownComp } = await sb
    .from('companies')
    .select('id, user_id, name, industry, stage')
    .eq('id', requestedCompanyId)
    .maybeSingle()

  if (ownComp && (ownComp.user_id as string) === callerId) {
    return {
      userId: callerId,
      companyName: (ownComp.name as string) || 'Компания',
      industry: (ownComp.industry as string) ?? null,
      stage: (ownComp.stage as string) ?? null,
      companyId: (ownComp.id as string) ?? null,
    }
  }

  // Not the owner — only staff may target another company.
  const viewer = await requireExpert()
  if (!viewer) return null

  // Service-role read so the staff viewer can see a company they don't own.
  const { url, key } = {
    url: (process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').replace(/\/$/, ''),
    key: process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '',
  }
  if (!url || !key) return null
  try {
    const res = await fetch(
      `${url}/rest/v1/companies?id=eq.${encodeURIComponent(requestedCompanyId)}&select=id,user_id,name,industry,stage&limit=1`,
      { headers: { apikey: key, Authorization: `Bearer ${key}` }, cache: 'no-store' },
    )
    if (!res.ok) return null
    const rows = (await res.json()) as Array<Record<string, unknown>>
    const c = rows?.[0]
    if (!c) return null
    return {
      userId: String(c.user_id),
      companyName: (c.name as string) || 'Компания',
      industry: (c.industry as string) ?? null,
      stage: (c.stage as string) ?? null,
      companyId: String(c.id),
    }
  } catch {
    return null
  }
}

// ─── Loaders per report type ─────────────────────────────────────────────────

async function loadGri(
  sb: ReturnType<typeof createServerClient>,
  subject: Subject,
): Promise<GriPdfInput | null> {
  const { data } = await sb
    .from('gri_assessments')
    .select('gri_index, section_avgs, top_5_limits, action_plan_90d')
    .eq('user_id', subject.userId)
    .order('is_current', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!data) return null

  // section_avgs + gri_index are on a 0–10 scale → normalize to 0–100.
  const sectionAvgs = (data.section_avgs as Record<string, unknown>) ?? {}
  const blocks = GRI_SECTION_ORDER.filter((id) => id in sectionAvgs).map((id) => ({
    key: id,
    label: GRI_SECTION_LABELS[id] ?? id,
    score: Math.round((num(sectionAvgs[id]) ?? 0) * 10),
  }))
  const overall = Math.round((num(data.gri_index) ?? 0) * 10)

  const top5 = Array.isArray(data.top_5_limits)
    ? (data.top_5_limits as Array<Record<string, unknown>>).map((t, i) => ({
        rank: typeof t.rank === 'number' ? t.rank : i + 1,
        title: String(t.criterionText ?? t.title ?? t.label ?? '').trim()
          ? `${String(t.criterionText ?? t.title ?? t.label)}${t.blockName ? ` (${t.blockName})` : ''}`
          : `Ограничение ${i + 1}`,
        severity: (num(t.score) ?? 10) <= 3 ? 'critical' : (num(t.score) ?? 10) <= 5 ? 'high' : 'medium',
      }))
    : []

  // action_plan_90d: { days_1_30, days_31_60, days_61_90: ActionCard[] }
  const plan = data.action_plan_90d as
    | { days_1_30?: unknown[]; days_31_60?: unknown[]; days_61_90?: unknown[] }
    | null
  const actionPlan: GriPdfInput['actionPlan'] = []
  const pushCards = (cards: unknown[] | undefined, horizon: string) => {
    for (const c of cards ?? []) {
      if (!c || typeof c !== 'object') continue
      const o = c as Record<string, unknown>
      actionPlan.push({
        title: String(o.limitation ?? o.focus ?? 'Действие'),
        detail: typeof o.focus === 'string' && o.focus !== o.limitation ? o.focus : undefined,
        horizon,
      })
    }
  }
  if (plan) {
    pushCards(plan.days_1_30, 'Дни 1–30')
    pushCards(plan.days_31_60, 'Дни 31–60')
    pushCards(plan.days_61_90, 'Дни 61–90')
  }

  const meta: ReportMeta = {
    companyName: subject.companyName,
    industry: subject.industry,
    stage: subject.stage,
  }

  return { meta, overall, blocks, top5, actionPlan }
}

async function loadPointA(
  sb: ReturnType<typeof createServerClient>,
  subject: Subject,
): Promise<PointAPdfInput | null> {
  const { data: diag } = await sb
    .from('diagnostics')
    .select('*')
    .eq('user_id', subject.userId)
    .eq('is_current', true)
    .maybeSingle()

  if (!diag) return null

  const pointA = diagToPointA(diag as Record<string, unknown>)
  const ai = (diag as Record<string, unknown>).ai_analysis as AIAnalysis | null

  const blockOrder: Array<keyof PointA['blocks']> = ['finance', 'sales', 'operations', 'marketing', 'strategy']
  const blocks: PointAPdfInput['blocks'] = blockOrder.map((key) => {
    const aiBlock = ai?.blocks?.[key]
    return {
      key,
      label: POINT_A_BLOCK_LABELS[key] ?? key,
      score: pointA.blocks[key]?.score ?? 0,
      diagnosis: aiBlock?.diagnosis,
      benchmark_comparison: aiBlock?.benchmark_comparison,
      key_risk: aiBlock?.key_risk,
      top_recommendation: aiBlock?.top_recommendation,
    }
  })

  const meta: ReportMeta = {
    companyName: subject.companyName,
    industry: subject.industry,
    stage: subject.stage ?? pointA.stage,
    generatedAt: (diag as Record<string, unknown>).calculated_at as string | undefined,
  }

  return {
    meta,
    overallScore: pointA.overall_score,
    healthIndex: pointA.health_index,
    stage: subject.stage ?? pointA.stage,
    executiveSummary: ai?.executive_summary ?? null,
    industryContext: ai?.industry_context ?? null,
    blocks,
    strategicPriorities: ai?.strategic_priorities,
    growthRoadmap: ai?.growth_roadmap,
    risks: pointA.risks,
  }
}

async function loadPointB(
  sb: ReturnType<typeof createServerClient>,
  subject: Subject,
): Promise<PointBPdfInput | null> {
  // Latest diagnostic (Point A foundation).
  const { data: diag } = await sb
    .from('diagnostics')
    .select('*')
    .eq('user_id', subject.userId)
    .eq('is_current', true)
    .maybeSingle()

  if (!diag) return null

  // Survey answers.
  const { data: surveyRows } = await sb
    .from('survey_answers')
    .select('question_key, answer')
    .eq('user_id', subject.userId)
  const answers = answersFromRows(surveyRows)

  // GRI TOP-5.
  const { data: gri } = await sb
    .from('gri_assessments')
    .select('top_5_limits')
    .eq('user_id', subject.userId)
    .eq('is_current', true)
    .maybeSingle()
  const griTop5 = mapGriTop5(gri?.top_5_limits)

  // Current revenue (metrics layer) + canonical goals (companies.target_*).
  let currentRevenueYear: number | null = null
  if (subject.companyId) {
    const { data: revRows } = await sb
      .from('metrics')
      .select('metric_value, period_year')
      .eq('company_id', subject.companyId)
      .eq('metric_key', 'revenue')
      .gt('metric_value', 0)
      .order('period_year', { ascending: false })
      .limit(1)
    currentRevenueYear = num(revRows?.[0]?.metric_value)
  }

  let goal12mYear: number | null = null
  let goal3yYear: number | null = null
  {
    const { data: comp } = await sb
      .from('companies')
      .select('target_revenue_12m_kzt, target_revenue_3y_kzt')
      .eq('user_id', subject.userId)
      .maybeSingle()
    goal12mYear = num(comp?.target_revenue_12m_kzt)
    goal3yYear = num(comp?.target_revenue_3y_kzt)
  }

  const pointA = diagToPointA(diag as Record<string, unknown>)
  const pointB = calculatePointBV2(pointA, answers, {
    diagnosticId: (diag as Record<string, unknown>).id as string,
    griTop5,
    currentRevenueYear,
    goal12mYear,
    goal3yYear,
  })

  // Persisted AI strategy bridge (point_b_analysis.ai_strategy), best-effort.
  let aiStrategy: PointBStrategy | null = null
  {
    const { data: pb } = await sb
      .from('point_b_analysis')
      .select('ai_strategy, ai_status')
      .eq('diagnostic_id', (diag as Record<string, unknown>).id as string)
      .eq('is_current', true)
      .maybeSingle()
    if (pb?.ai_status === 'completed' && pb?.ai_strategy) {
      aiStrategy = pb.ai_strategy as PointBStrategy
    }
  }

  const meta: ReportMeta = {
    companyName: subject.companyName,
    industry: subject.industry,
    stage: subject.stage,
    generatedAt: pointB.generated_at,
  }

  return {
    meta,
    goals: {
      current_revenue_year: pointB.goals.current_revenue_year,
      goal_12m_revenue_year: pointB.goals.goal_12m_revenue_year,
      goal_3y_revenue_year: pointB.goals.goal_3y_revenue_year,
      goal_12m_text: pointB.goals.goal_12m_text,
      goal_3y_text: pointB.goals.goal_3y_text,
      main_pain: pointB.goals.main_pain,
    },
    gap: pointB.gap.map((g) => ({
      horizon: g.horizon,
      current_revenue: g.current_revenue,
      target_revenue: g.target_revenue,
      multiplier: g.multiplier,
      required_cagr: g.required_cagr,
    })),
    realism: pointB.realism
      ? {
          level: pointB.realism.level,
          score: pointB.realism.score,
          rationale: pointB.realism.rationale,
          risk_factors: pointB.realism.risk_factors,
          weak_blocks: pointB.realism.weak_blocks,
        }
      : null,
    scenarios: pointB.scenarios.map((s) => ({
      label: s.label,
      target_revenue_12m: s.target_revenue_12m,
      target_revenue_3y: s.target_revenue_3y,
      confidence: s.confidence,
    })),
    top5Limits: pointB.top5_limits.map((t) => ({ rank: t.rank, title: t.title, severity: t.severity })),
    growthDecomposition: pointB.growth_decomposition
      ? {
          required_multiplier: pointB.growth_decomposition.required_multiplier,
          summary: pointB.growth_decomposition.summary,
          steps: pointB.growth_decomposition.steps.map((s) => ({ label: s.label, note: s.note })),
        }
      : null,
    aiStrategy: aiStrategy
      ? {
          strategic_bridge_summary: aiStrategy.strategic_bridge_summary,
          gap_bridge: aiStrategy.gap_bridge,
          milestones: aiStrategy.milestones,
          risk_mitigations: aiStrategy.risk_mitigations,
        }
      : null,
  }
}

async function loadSurvey(
  sb: ReturnType<typeof createServerClient>,
  subject: Subject,
): Promise<SurveyPdfInput | null> {
  const { data: rows } = await sb
    .from('survey_answers')
    .select('question_key, answer')
    .eq('user_id', subject.userId)

  if (!rows || rows.length === 0) return null

  const answers = answersFromRows(rows)
  const meta: ReportMeta = {
    companyName: subject.companyName,
    industry: subject.industry,
    stage: subject.stage,
  }
  return { meta, answers }
}

// ─── Handler ─────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const type = req.nextUrl.searchParams.get('type') as ReportType | null
  if (!type || !VALID_TYPES.has(type)) {
    return NextResponse.json(
      { error: 'invalid_type', valid: Array.from(VALID_TYPES) },
      { status: 400 },
    )
  }

  const sb = createServerClient()
  const {
    data: { user },
  } = await sb.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const requestedCompanyId = req.nextUrl.searchParams.get('companyId')
  const subject = await resolveSubject(sb, user.id, requestedCompanyId)
  if (!subject) {
    // Either the company doesn't exist or the caller isn't authorized to view it.
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  let pdf: Buffer | null = null
  try {
    switch (type) {
      case 'gri': {
        const input = await loadGri(sb, subject)
        if (!input) return NO_DATA
        pdf = await renderGriPdf(input)
        break
      }
      case 'point-a': {
        const input = await loadPointA(sb, subject)
        if (!input) return NO_DATA
        pdf = await renderPointAPdf(input)
        break
      }
      case 'point-b': {
        const input = await loadPointB(sb, subject)
        if (!input) return NO_DATA
        pdf = await renderPointBPdf(input)
        break
      }
      case 'survey': {
        const input = await loadSurvey(sb, subject)
        if (!input) return NO_DATA
        pdf = await renderSurveyPdf(input)
        break
      }
    }
  } catch (err) {
    console.error('[export/report] render failed:', err)
    return NextResponse.json({ error: 'render_failed' }, { status: 500 })
  }

  if (!pdf) return NO_DATA

  // Fresh ArrayBuffer for a clean BlobPart (avoids SharedArrayBuffer typing).
  const ab = new ArrayBuffer(pdf.byteLength)
  new Uint8Array(ab).set(pdf)

  return new NextResponse(ab, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="aistart360-${type}.pdf"`,
      'Cache-Control': 'no-store',
    },
  })
}
