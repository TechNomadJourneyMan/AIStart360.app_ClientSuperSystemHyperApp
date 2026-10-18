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

import type { PointBV2 } from '@/lib/point-b/engine'
import { diagToPointA } from '@/lib/point-b/adapters'
import { loadPointBInputs } from '@/lib/point-b/inputs'
import { computePointB } from '@/lib/point-b/compute'
import { createServiceClient } from '@/lib/supabase-service'
import type { PointA, AIAnalysis } from '@/types/onboarding'

// ─── Service-role REST helper ─────────────────────────────────────────────────

function srBase() {
  return {
    url: (process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').replace(/\/$/, ''),
    key:
      process.env.SUPABASE_SERVICE_ROLE_KEY ?? '',
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
  // The same inputs and computation as the client's own page (lib/point-b):
  // revenue from the metrics registry (with its period), the Point A snapshot, goals.
  // Service role: the share link has no session; the token already authorised ONE company.
  const sb = createServiceClient()
  const inputs = await loadPointBInputs(sb, subject.userId, { companyId: subject.companyId })
  const pointB = computePointB(inputs)
  if (!pointB || !inputs.diagnostic) return null

  // Overlay any persisted AI strategy bridge (point_b_analysis.ai_strategy).
  const { data: pb } = await sb
    .from('point_b_analysis')
    .select('ai_strategy, ai_status')
    .eq('diagnostic_id', String(inputs.diagnostic.id))
    .eq('is_current', true)
    .maybeSingle()
  const row = pb as { ai_strategy?: unknown; ai_status?: string } | null
  if (row?.ai_status === 'completed' && row.ai_strategy) {
    pointB.ai_strategy = row.ai_strategy as Record<string, unknown>
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
