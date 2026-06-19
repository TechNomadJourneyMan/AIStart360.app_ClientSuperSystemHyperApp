/**
 * lib/assistant/context.ts — buildAssistantContext().
 *
 * Assembles the curated {@link AssistantContext} snapshot from the EXISTING data
 * layer, reusing the exact reads already proven in
 * app/api/v1/diagnostics/point-b/route.ts:
 *   - diagnostics (current row)            → Point A (via diagToPointA shape)
 *   - survey_answers flat-map (answer.value unwrap)
 *   - gri_assessments.top_5_limits / gri_index
 *   - companies.target_revenue_12m/3y_kzt
 *   - metrics 'revenue'                    → current revenue
 *   - calculatePointBV2()                  → gap / realism / data_sufficiency
 *
 * CRITICAL ANTI-HALLUCINATION BOUNDARY: the object returned here is the ONLY
 * thing later serialized into an LLM prompt. Never hand raw DB rows to the LLM —
 * always go through this snapshot. It honestly carries nulls when data is
 * missing; downstream code must surface "insufficient_data", never invent.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { PointA, BlockScore } from '@/types/onboarding'
import { calculatePointBV2, type PointBOptions } from '@/lib/point-b/engine'
import type {
  AssistantContext,
  AssistantBlock,
  AssistantPointA,
  AssistantPointB,
  AssistantGri,
} from './types'

// ─── Point A reconstruction (mirrors point-b/route.ts diagToPointA) ─────────

const EMPTY_BLOCK: BlockScore = { score: 0, status: 'critical', top_issues: [], recommendations: [] }

const BLOCK_LABELS: Record<string, string> = {
  finance: 'Финансы',
  sales: 'Продажи',
  operations: 'Операции',
  marketing: 'Маркетинг',
  strategy: 'Стратегия',
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

/** Normalize gri_assessments.top_5_limits into a stable shape (tolerant of
 *  the {criterionText, blockName, score} GRI calculator shape AND the
 *  {title, block, severity} shape used elsewhere — same tolerance as the
 *  point-b route's mapGriTop5). */
function mapGriTop5(raw: unknown): AssistantGri['top_5_limits'] {
  if (!Array.isArray(raw)) return []
  return raw
    .map((item, i) => {
      if (!item || typeof item !== 'object') return null
      const o = item as Record<string, unknown>
      const title = String(o.title ?? o.criterionText ?? o.label ?? o.name ?? o.criterion ?? '').trim()
      if (!title) return null
      const scoreRaw = o.score
      const score =
        scoreRaw != null && Number.isFinite(Number(scoreRaw)) ? Number(scoreRaw) : null
      return {
        rank: typeof o.rank === 'number' ? o.rank : i + 1,
        title,
        block: String(o.block ?? o.blockName ?? o.blockId ?? o.section ?? ''),
        score,
      }
    })
    .filter((x): x is NonNullable<typeof x> => x !== null)
}

/** Map GRI top-5 into the Point B engine's griTop5 option shape. */
function griTop5ToOption(top5: AssistantGri['top_5_limits']): PointBOptions['griTop5'] {
  if (!top5.length) return undefined
  return top5.map((t) => ({ rank: t.rank, title: t.title, block: t.block, severity: 'high' }))
}

function toAssistantBlocks(pointA: PointA): AssistantBlock[] {
  const order = ['finance', 'sales', 'operations', 'marketing', 'strategy'] as const
  return order.map((key) => {
    const b = pointA.blocks[key] ?? EMPTY_BLOCK
    return { key, label: BLOCK_LABELS[key] ?? key, score: b.score, status: b.status }
  })
}

// ─── buildAssistantContext ──────────────────────────────────────────────────

/**
 * Build the curated snapshot for `userId`. `sb` must be a session-scoped client
 * (createServerClient()) so RLS keeps the read to the caller's own rows — never
 * accept a user_id from a client request param (IDOR-safe, per point-b/route.ts).
 */
export async function buildAssistantContext(
  userId: string,
  sb: SupabaseClient,
): Promise<AssistantContext> {
  // 1. Latest diagnostic (Point A). RLS scopes the row; we also filter by user.
  const { data: diag } = await sb
    .from('diagnostics')
    .select('*')
    .eq('user_id', userId)
    .eq('is_current', true)
    .maybeSingle()

  const hasDiagnostic = !!diag
  const pointA = diag ? diagToPointA(diag as Record<string, unknown>) : diagToPointA({})
  const diagnosticId = (diag?.id as string | undefined) ?? null

  // 2. Survey answers → flat { question_key: value } map (answer.value unwrap —
  //    identical to point-b/route.ts).
  const { data: surveyRows } = await sb
    .from('survey_answers')
    .select('question_key, answer')
    .eq('user_id', userId)

  const answers: Record<string, unknown> = {}
  for (const row of surveyRows ?? []) {
    const a = (row as { answer?: unknown }).answer as { value?: unknown } | unknown
    answers[(row as { question_key: string }).question_key] =
      a && typeof a === 'object' && 'value' in a ? (a as { value?: unknown }).value : a
  }

  // 3. GRI TOP-5 limits + index (gri_index is 0–10).
  const { data: gri } = await sb
    .from('gri_assessments')
    .select('top_5_limits, gri_index')
    .eq('user_id', userId)
    .eq('is_current', true)
    .maybeSingle()

  const griTop5 = mapGriTop5((gri as { top_5_limits?: unknown } | null)?.top_5_limits)
  const griIndexRaw = (gri as { gri_index?: unknown } | null)?.gri_index
  const griIndex =
    griIndexRaw != null && Number.isFinite(Number(griIndexRaw)) ? Number(griIndexRaw) : null

  // 4. Company targets/identity (companies.id is TEXT — Prisma-owned).
  const { data: comp } = await sb
    .from('companies')
    .select(
      'id, name, industry, stage, employee_count, target_revenue_12m_kzt, target_revenue_3y_kzt',
    )
    .eq('user_id', userId)
    .maybeSingle()

  const company = comp as Record<string, unknown> | null
  const num = (v: unknown): number | null =>
    v != null && Number.isFinite(Number(v)) ? Number(v) : null

  const target12m = num(company?.target_revenue_12m_kzt)
  const target3y = num(company?.target_revenue_3y_kzt)

  // 5. Current revenue from the metrics layer (newer s1_* survey captures only
  //    goals). Best-effort — needs a linked company. Same read as point-b route.
  let currentRevenueYear: number | null = null
  let revenueYear: number | null = null
  const companyId =
    ((diag?.company_id as string | null) ?? (company?.id as string | null)) ?? null
  if (companyId) {
    const { data: revRows } = await sb
      .from('metrics')
      .select('metric_value, period_year')
      .eq('company_id', companyId)
      .eq('metric_key', 'revenue')
      .gt('metric_value', 0)
      .order('period_year', { ascending: false })
      .limit(1)
    const r = (revRows as Array<{ metric_value?: unknown; period_year?: unknown }> | null)?.[0]
    const v = r?.metric_value
    if (v != null && Number.isFinite(Number(v))) {
      currentRevenueYear = Number(v)
      revenueYear = num(r?.period_year)
    }
  }

  // 6. Compute Point B (gap / realism / data_sufficiency) — never fabricated.
  const pointBV2 = calculatePointBV2(pointA, answers, {
    diagnosticId,
    griTop5: griTop5ToOption(griTop5),
    currentRevenueYear,
    goal12mYear: target12m,
    goal3yYear: target3y,
  })

  // ── Assemble the curated snapshot ──────────────────────────────────────────

  const blocks = toAssistantBlocks(pointA)
  const weakest = [...blocks].sort((a, b) => a.score - b.score)

  const assistantPointA: AssistantPointA = {
    has_diagnostic: hasDiagnostic,
    overall_score: hasDiagnostic ? pointA.overall_score : null,
    health_index: hasDiagnostic ? pointA.health_index : null,
    stage: hasDiagnostic ? pointA.stage : null,
    blocks,
    weakest_blocks: weakest.slice(0, 3),
    risks: pointA.risks.map((r) => ({ level: r.level, area: r.area, text: r.text })),
    data_gaps: pointA.data_gaps.map((g) => ({ field: g.field, step: g.step, impact: g.impact })),
    quick_wins: pointA.quick_wins.map((q) => ({
      action: q.action,
      timeline: q.timeline,
      area: q.area,
    })),
  }

  const gap12 = pointBV2.gap.find((g) => g.horizon === '12m')
  const assistantPointB: AssistantPointB = {
    has_goal:
      pointBV2.goals.goal_12m_revenue_year != null ||
      pointBV2.goals.goal_3y_revenue_year != null,
    current_revenue_year: pointBV2.goals.current_revenue_year,
    goal_12m_revenue_year: pointBV2.goals.goal_12m_revenue_year,
    goal_3y_revenue_year: pointBV2.goals.goal_3y_revenue_year,
    gap: {
      multiplier: gap12?.multiplier ?? null,
      required_cagr: gap12?.required_cagr ?? null,
      required_mom_growth: gap12?.required_mom_growth ?? null,
      data_complete: gap12?.data_complete ?? false,
    },
    realism: {
      level: pointBV2.realism.level,
      score: pointBV2.realism.score,
      rationale: pointBV2.realism.rationale,
      weak_blocks: pointBV2.realism.weak_blocks,
    },
    data_sufficiency: {
      sufficient: pointBV2.data_sufficiency.sufficient,
      confidence: pointBV2.data_sufficiency.confidence,
      missing: pointBV2.data_sufficiency.missing,
      have: pointBV2.data_sufficiency.have,
    },
    levers: pointBV2.levers.map((l) => ({
      key: l.key,
      label: l.label,
      expected_effect: l.expected_effect,
      data_available: l.data_available,
    })),
    top5_limits: pointBV2.top5_limits.map((t) => ({
      rank: t.rank,
      title: t.title,
      block: t.block,
      severity: t.severity,
    })),
  }

  const assistantGri: AssistantGri = {
    has_assessment: !!gri,
    gri_index: griIndex,
    top_5_limits: griTop5.slice(0, 5),
  }

  return {
    userId,
    diagnosticId,
    generatedAt: new Date().toISOString(),
    company: {
      id: (company?.id as string | null) ?? companyId,
      name: (company?.name as string | null) ?? null,
      stage: (company?.stage as string | null) ?? null,
      industry: (company?.industry as string | null) ?? null,
      employee_count: num(company?.employee_count),
      target_revenue_12m_kzt: target12m,
      target_revenue_3y_kzt: target3y,
    },
    answers,
    pointA: assistantPointA,
    pointB: assistantPointB,
    gri: assistantGri,
    metrics: { revenue: currentRevenueYear, revenue_year: revenueYear },
    llm_analysis: null,
  }
}
