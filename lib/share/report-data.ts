/**
 * Service-role data loaders for the PUBLIC read-only share viewer (/r/[token]).
 *
 * A share link is consumed without a session, so these loaders read via the
 * Supabase service-role REST API (bypassing RLS) scoped to ONE company that the
 * share token already authorized. They mirror the exact reads the PDF export
 * route performs (app/api/export/report) so the shared view matches the PDF.
 *
 * NEVER call these from a path that hasn't first validated a share token — they
 * intentionally bypass RLS.
 */

import {
  calculatePointBV2,
  type PointBOptions,
  type PointBV2,
} from '@/lib/point-b/engine'
import type { PointA, BlockScore, AIAnalysis } from '@/types/onboarding'

// ─── Service-role REST helper ─────────────────────────────────────────────────

function srBase() {
  return {
    url: (process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').replace(/\/$/, ''),
    key:
      process.env.SUPABASE_SERVICE_ROLE_KEY ||
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
      '',
  }
}

async function srGet<T = unknown>(path: string): Promise<T | null> {
  const { url, key } = srBase()
  if (!url || !key) return null
  try {
    const res = await fetch(`${url}/rest/v1/${path}`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
      cache: 'no-store',
    })
    if (!res.ok) {
      console.error('[share/report-data] srGet', res.status, path)
      return null
    }
    return (await res.json()) as T
  } catch (err) {
    console.error('[share/report-data] srGet error:', err)
    return null
  }
}

function num(v: unknown): number | null {
  if (v == null) return null
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : null
}

// ─── Shared shapes ─────────────────────────────────────────────────────────────

export interface ReportSubject {
  companyId: string
  userId: string
  companyName: string
  industry: string | null
  stage: string | null
}

const POINT_A_BLOCK_LABELS: Record<string, string> = {
  finance: 'Финансы',
  sales: 'Продажи',
  operations: 'Операции',
  marketing: 'Маркетинг',
  strategy: 'Стратегия',
}

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

const EMPTY_BLOCK: BlockScore = {
  score: 0,
  status: 'critical',
  top_issues: [],
  recommendations: [],
}

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

function mapGriTop5(raw: unknown): PointBOptions['griTop5'] {
  if (!Array.isArray(raw)) return undefined
  return raw
    .map((item, i) => {
      if (!item || typeof item !== 'object') return null
      const o = item as Record<string, unknown>
      const title = String(
        o.title ?? o.label ?? o.name ?? o.criterionText ?? o.criterion ?? '',
      ).trim()
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

function answersFromRows(
  rows: Array<{ question_key: string; answer: unknown }> | null,
): Record<string, unknown> {
  const answers: Record<string, unknown> = {}
  for (const row of rows ?? []) {
    const a = row.answer as { value?: unknown } | unknown
    answers[row.question_key] =
      a && typeof a === 'object' && 'value' in a
        ? (a as { value?: unknown }).value
        : a
  }
  return answers
}

// ─── Subject resolution ─────────────────────────────────────────────────────────

/** Resolve company name / industry / stage / owner for a (token-authorized) id. */
export async function loadSubject(
  companyId: string,
): Promise<ReportSubject | null> {
  const rows = await srGet<Array<Record<string, unknown>>>(
    `companies?id=eq.${encodeURIComponent(companyId)}&select=id,user_id,name,industry,stage&limit=1`,
  )
  const c = rows?.[0]
  if (!c) return null
  return {
    companyId: String(c.id),
    userId: String(c.user_id ?? ''),
    companyName: (c.name as string) || 'Компания',
    industry: (c.industry as string) ?? null,
    stage: (c.stage as string) ?? null,
  }
}

// ─── GRI ──────────────────────────────────────────────────────────────────────

export interface GriView {
  overall: number
  blocks: Array<{ key: string; label: string; score: number }>
  top5: Array<{ rank: number; title: string; severity: string }>
  actionPlan: Array<{ title: string; detail?: string; horizon: string }>
}

export async function loadGriView(
  subject: ReportSubject,
): Promise<GriView | null> {
  const rows = await srGet<Array<Record<string, unknown>>>(
    `gri_assessments?user_id=eq.${encodeURIComponent(subject.userId)}&select=gri_index,section_avgs,top_5_limits,action_plan_90d&order=is_current.desc,created_at.desc&limit=1`,
  )
  const data = rows?.[0]
  if (!data) return null

  const sectionAvgs = (data.section_avgs as Record<string, unknown>) ?? {}
  const blocks = GRI_SECTION_ORDER.filter((id) => id in sectionAvgs).map((id) => ({
    key: id,
    label: GRI_SECTION_LABELS[id] ?? id,
    score: Math.round((num(sectionAvgs[id]) ?? 0) * 10),
  }))
  const overall = Math.round((num(data.gri_index) ?? 0) * 10)

  const top5 = Array.isArray(data.top_5_limits)
    ? (data.top_5_limits as Array<Record<string, unknown>>).map((t, i) => {
        const titleRaw = String(t.criterionText ?? t.title ?? t.label ?? '').trim()
        const title = titleRaw
          ? `${titleRaw}${t.blockName ? ` (${t.blockName})` : ''}`
          : `Ограничение ${i + 1}`
        const score = num(t.score) ?? 10
        const severity = score <= 3 ? 'critical' : score <= 5 ? 'high' : 'medium'
        return { rank: typeof t.rank === 'number' ? t.rank : i + 1, title, severity }
      })
    : []

  const plan = data.action_plan_90d as
    | { days_1_30?: unknown[]; days_31_60?: unknown[]; days_61_90?: unknown[] }
    | null
  const actionPlan: GriView['actionPlan'] = []
  const pushCards = (cards: unknown[] | undefined, horizon: string) => {
    for (const c of cards ?? []) {
      if (!c || typeof c !== 'object') continue
      const o = c as Record<string, unknown>
      actionPlan.push({
        title: String(o.limitation ?? o.focus ?? 'Действие'),
        detail:
          typeof o.focus === 'string' && o.focus !== o.limitation
            ? o.focus
            : undefined,
        horizon,
      })
    }
  }
  if (plan) {
    pushCards(plan.days_1_30, 'Дни 1–30')
    pushCards(plan.days_31_60, 'Дни 31–60')
    pushCards(plan.days_61_90, 'Дни 61–90')
  }

  return { overall, blocks, top5, actionPlan }
}

// ─── Точка А ─────────────────────────────────────────────────────────────────

export interface PointAView {
  overallScore: number
  healthIndex: number
  executiveSummary: string | null
  industryContext: string | null
  blocks: Array<{
    key: string
    label: string
    score: number
    diagnosis?: string
    benchmark_comparison?: string
    key_risk?: string
    top_recommendation?: string
  }>
  risks: PointA['risks']
  strategicPriorities: Array<{
    title: string
    rationale?: string
    expected_impact?: string
  }>
  growthRoadmap: Array<{ horizon: string; actions: string[] }>
  quickWins: PointA['quick_wins']
}

export async function loadPointAView(
  subject: ReportSubject,
): Promise<PointAView | null> {
  const rows = await srGet<Array<Record<string, unknown>>>(
    `diagnostics?user_id=eq.${encodeURIComponent(subject.userId)}&is_current=eq.true&select=*&limit=1`,
  )
  const diag = rows?.[0]
  if (!diag) return null

  const pointA = diagToPointA(diag)
  const ai = diag.ai_analysis as AIAnalysis | null

  const blockOrder: Array<keyof PointA['blocks']> = [
    'finance',
    'sales',
    'operations',
    'marketing',
    'strategy',
  ]
  const blocks: PointAView['blocks'] = blockOrder.map((key) => {
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

  const strategicPriorities = Array.isArray(ai?.strategic_priorities)
    ? ai!.strategic_priorities
        .map((p) => ({
          title: String(p?.title ?? '').trim(),
          rationale: p?.rationale ? String(p.rationale) : undefined,
          expected_impact: p?.expected_impact
            ? String(p.expected_impact)
            : undefined,
        }))
        .filter((p) => p.title.length > 0)
    : []

  const growthRoadmap = Array.isArray(ai?.growth_roadmap)
    ? ai!.growth_roadmap
        .map((r) => ({
          horizon: String(r?.horizon ?? ''),
          actions: Array.isArray(r?.actions)
            ? r.actions.map((a) => String(a)).filter((a) => a.trim().length > 0)
            : [],
        }))
        .filter((r) => r.actions.length > 0)
    : []

  return {
    overallScore: pointA.overall_score,
    healthIndex: pointA.health_index,
    executiveSummary: ai?.executive_summary ?? null,
    industryContext: ai?.industry_context ?? null,
    blocks,
    risks: pointA.risks,
    strategicPriorities,
    growthRoadmap,
    quickWins: pointA.quick_wins,
  }
}

// ─── Точка Б ─────────────────────────────────────────────────────────────────

export async function loadPointBView(
  subject: ReportSubject,
): Promise<PointBV2 | null> {
  const diagRows = await srGet<Array<Record<string, unknown>>>(
    `diagnostics?user_id=eq.${encodeURIComponent(subject.userId)}&is_current=eq.true&select=*&limit=1`,
  )
  const diag = diagRows?.[0]
  if (!diag) return null

  const surveyRows = await srGet<Array<{ question_key: string; answer: unknown }>>(
    `survey_answers?user_id=eq.${encodeURIComponent(subject.userId)}&select=question_key,answer`,
  )
  const answers = answersFromRows(surveyRows)

  const griRows = await srGet<Array<Record<string, unknown>>>(
    `gri_assessments?user_id=eq.${encodeURIComponent(subject.userId)}&is_current=eq.true&select=top_5_limits&limit=1`,
  )
  const griTop5 = mapGriTop5(griRows?.[0]?.top_5_limits)

  // Current revenue (metrics layer) + canonical goals (companies.target_*).
  let currentRevenueYear: number | null = null
  {
    const revRows = await srGet<Array<Record<string, unknown>>>(
      `metrics?company_id=eq.${encodeURIComponent(subject.companyId)}&metric_key=eq.revenue&metric_value=gt.0&select=metric_value,period_year&order=period_year.desc&limit=1`,
    )
    currentRevenueYear = num(revRows?.[0]?.metric_value)
  }

  let goal12mYear: number | null = null
  let goal3yYear: number | null = null
  {
    const compRows = await srGet<Array<Record<string, unknown>>>(
      `companies?user_id=eq.${encodeURIComponent(subject.userId)}&select=target_revenue_12m_kzt,target_revenue_3y_kzt&limit=1`,
    )
    goal12mYear = num(compRows?.[0]?.target_revenue_12m_kzt)
    goal3yYear = num(compRows?.[0]?.target_revenue_3y_kzt)
  }

  const pointA = diagToPointA(diag)
  const pointB = calculatePointBV2(pointA, answers, {
    diagnosticId: diag.id as string,
    griTop5,
    currentRevenueYear,
    goal12mYear,
    goal3yYear,
  })

  // Overlay any persisted AI strategy bridge (point_b_analysis.ai_strategy).
  const pbRows = await srGet<Array<Record<string, unknown>>>(
    `point_b_analysis?diagnostic_id=eq.${encodeURIComponent(diag.id as string)}&is_current=eq.true&select=ai_strategy,ai_status&limit=1`,
  )
  const pb = pbRows?.[0]
  if (pb?.ai_status === 'completed' && pb?.ai_strategy) {
    pointB.ai_strategy = pb.ai_strategy as Record<string, unknown>
    pointB.ai_status = 'completed'
  }

  return pointB
}

// ─── Survey ─────────────────────────────────────────────────────────────────

export interface SurveyView {
  answers: Record<string, unknown>
}

export async function loadSurveyView(
  subject: ReportSubject,
): Promise<SurveyView | null> {
  const rows = await srGet<Array<{ question_key: string; answer: unknown }>>(
    `survey_answers?user_id=eq.${encodeURIComponent(subject.userId)}&select=question_key,answer`,
  )
  if (!rows || rows.length === 0) return null
  return { answers: answersFromRows(rows) }
}
