export const dynamic = 'force-dynamic'
// Point B strategic bridge is a large structured generation (high complexity →
// Sonnet) that can take 90-150s. This route runs async (fire-and-forget from
// recalculate, polled via point-b/ai-status), so a generous budget is fine.
export const maxDuration = 300

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase-server'
import { analyzePointBStrategy } from '@/lib/ai/point-b-analyzer'
import { calculatePointBV2, type PointBOptions } from '@/lib/point-b/engine'
import type { PointA, BlockScore } from '@/types/onboarding'

/**
 * POST /api/v1/diagnostics/point-b/ai-generate
 * Internal endpoint: runs the Point B AI strategic-bridge analysis on a
 * diagnostic and persists it onto point_b_analysis (ai_strategy + ai_status).
 * Called asynchronously after rule-based recalculation completes (AUTO trigger).
 *
 * Body: { diagnostic_id?, user_id? } — falls back to the session user when omitted.
 *
 * HONEST DEGRADE: if the recomputed Point B has insufficient data, we set
 * ai_status='none' and return ok WITHOUT calling the LLM (never fabricate a plan).
 */

const EMPTY_BLOCK: BlockScore = { score: 0, status: 'critical', top_issues: [], recommendations: [] }

function diagToPointA(diag: Record<string, unknown>): PointA {
  const block = (k: string): BlockScore => {
    const v = diag[k] as BlockScore | null
    return v && typeof v === 'object' ? v : EMPTY_BLOCK
  }
  return {
    overall_score: (diag.overall_score as number) ?? 0,
    health_index: (diag.health_index as number) ?? 0,
    stage: ((diag.stage as PointA['stage']) ?? 'seed'),
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
      const title = String(o.title ?? o.label ?? o.name ?? o.criterion ?? '').trim()
      if (!title) return null
      return {
        rank: typeof o.rank === 'number' ? o.rank : i + 1,
        title,
        block: String(o.block ?? o.section ?? o.sectionId ?? ''),
        severity: String(o.severity ?? o.level ?? 'high'),
      }
    })
    .filter((x): x is NonNullable<typeof x> => x !== null)
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({} as Record<string, unknown>))
    let diagnosticId = (body.diagnostic_id as string | undefined) ?? undefined
    let userId = (body.user_id as string | undefined) ?? undefined

    const sb = createServerClient()

    // Resolve user from session when not passed (manual UI invocation).
    if (!userId) {
      const { data: { user } } = await sb.auth.getUser()
      if (!user) {
        return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
      }
      userId = user.id
    }

    // 1. Diagnostic (Point A). Resolve current one when not passed.
    const diagQuery = sb.from('diagnostics').select('*').eq('user_id', userId)
    const { data: diag } = diagnosticId
      ? await diagQuery.eq('id', diagnosticId).maybeSingle()
      : await diagQuery.eq('is_current', true).maybeSingle()

    if (!diag) {
      return NextResponse.json({ ok: false, error: 'No diagnostic found' }, { status: 404 })
    }
    diagnosticId = diag.id as string

    // 2. Survey answers → flat { question_key: value } map.
    const { data: surveyRows } = await sb
      .from('survey_answers')
      .select('question_key, answer')
      .eq('user_id', userId)

    const answers: Record<string, unknown> = {}
    for (const row of surveyRows ?? []) {
      const a = row.answer as { value?: unknown } | unknown
      answers[row.question_key as string] =
        a && typeof a === 'object' && 'value' in a ? (a as { value?: unknown }).value : a
    }

    // 3. GRI TOP-5 limits (optional enrichment; engine falls back to Point A blocks).
    const { data: gri } = await sb
      .from('gri_assessments')
      .select('top_5_limits')
      .eq('user_id', userId)
      .eq('is_current', true)
      .maybeSingle()

    const griTop5 = mapGriTop5(gri?.top_5_limits)

    // 4. Current revenue from the metrics layer. Best-effort: needs a linked company.
    let currentRevenueYear: number | null = null
    const companyId = (diag.company_id as string | null) ?? null
    if (companyId) {
      const { data: revRows } = await sb
        .from('metrics')
        .select('metric_value, period_year')
        .eq('company_id', companyId)
        .eq('metric_key', 'revenue')
        .gt('metric_value', 0)
        .order('period_year', { ascending: false })
        .limit(1)
      const v = revRows?.[0]?.metric_value
      if (v != null && Number.isFinite(Number(v))) currentRevenueYear = Number(v)
    }

    // 4b. Goals from the Point A goal widget (companies.target_revenue_12m/3y_kzt).
    let goal12mYear: number | null = null
    let goal3yYear: number | null = null
    const { data: comp } = await sb
      .from('companies')
      .select('name, industry, stage, target_revenue_12m_kzt, target_revenue_3y_kzt')
      .eq('user_id', userId)
      .maybeSingle()
    {
      const t12 = comp?.target_revenue_12m_kzt
      const t3y = comp?.target_revenue_3y_kzt
      if (t12 != null && Number.isFinite(Number(t12))) goal12mYear = Number(t12)
      if (t3y != null && Number.isFinite(Number(t3y))) goal3yYear = Number(t3y)
    }

    // 5. Recompute Point B.
    const pointA = diagToPointA(diag)
    const pointB = calculatePointBV2(pointA, answers, {
      diagnosticId,
      griTop5,
      currentRevenueYear,
      goal12mYear,
      goal3yYear,
    })

    // Service-role client — point_b_analysis RLS has no owner-write policy on
    // prod, so session writes silently no-op. Only ai_strategy + ai_status are
    // mutated here (read-then-merge in GET preserves everything else).
    const { createClient: createSrClient } = await import('@supabase/supabase-js')
    const admin = createSrClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    )

    const writeAi = async (
      aiStatus: 'none' | 'processing' | 'completed' | 'failed',
      aiStrategy: Record<string, unknown> | null,
    ) => {
      const { data: existing } = await admin
        .from('point_b_analysis')
        .select('id')
        .eq('diagnostic_id', diagnosticId as string)
        .eq('is_current', true)
        .maybeSingle()
      const patch = { ai_status: aiStatus, ai_strategy: aiStrategy }
      if (existing) {
        await admin.from('point_b_analysis').update(patch).eq('id', existing.id)
      } else {
        // No snapshot yet (GET hasn't run). Seed a minimal current row so the
        // ai fields have somewhere to live; GET will fill the rest on next read.
        await admin.from('point_b_analysis').insert({
          diagnostic_id: diagnosticId as string,
          is_current: true,
          ...patch,
        })
      }
    }

    // 6. HONEST DEGRADE — insufficient data: skip the LLM entirely.
    if (pointB.data_sufficiency.sufficient === false) {
      await writeAi('none', null)
      return NextResponse.json({ ok: true, ai_status: 'none', reason: 'insufficient_data' })
    }

    // 7. Mark processing, run AI, persist result.
    await writeAi('processing', null)

    const company = comp
      ? {
          name: (comp.name as string | null) ?? null,
          industry: (comp.industry as string | null) ?? null,
          stage: (comp.stage as string | null) ?? null,
        }
      : null

    const strategy = await analyzePointBStrategy(pointB, company)

    if (strategy) {
      await writeAi('completed', strategy as unknown as Record<string, unknown>)
      return NextResponse.json({ ok: true, ai_status: 'completed' })
    } else {
      await writeAi('failed', null)
      return NextResponse.json({ ok: false, ai_status: 'failed', error: 'AI analysis returned null' })
    }
  } catch (error) {
    console.error('[point-b/ai-generate] error:', error)

    // Best-effort: mark failed if we can resolve the diagnostic.
    try {
      const body = await req.clone().json().catch(() => ({} as Record<string, unknown>))
      const diagnosticId = body.diagnostic_id as string | undefined
      if (diagnosticId) {
        const { createClient: createSrClient } = await import('@supabase/supabase-js')
        const admin = createSrClient(
          process.env.NEXT_PUBLIC_SUPABASE_URL!,
          process.env.SUPABASE_SERVICE_ROLE_KEY!,
          { auth: { autoRefreshToken: false, persistSession: false } },
        )
        await admin
          .from('point_b_analysis')
          .update({ ai_status: 'failed' })
          .eq('diagnostic_id', diagnosticId)
          .eq('is_current', true)
      }
    } catch { /* best effort */ }

    return NextResponse.json({ ok: false, error: 'AI analysis failed' }, { status: 500 })
  }
}
