export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase-server'
import { calculatePointBV2, type PointBOptions } from '@/lib/point-b/engine'
import type { PointA, BlockScore } from '@/types/onboarding'

/**
 * GET /api/v1/diagnostics/point-b
 *
 * Goal-driven Point B for the CURRENT authenticated user. The user is taken
 * from the session — never from a `user_id` query param — so one user can't
 * read another's plan (see technical-audit A5 / IDOR). Expert/admin views of a
 * specific client go through /api/clients/[id]/analysis/point-b instead.
 *
 * Computed on the fly from the latest diagnostic (Point A) + survey answers +
 * GRI TOP-5. Nothing is fabricated: missing goals/revenue surface as an honest
 * "insufficient data" state, not a made-up target.
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

export async function GET(_req: NextRequest) {
  const sb = createServerClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  }

  try {
    // 1. Latest diagnostic (Point A). RLS scopes the row; we also filter by user.
    const { data: diag } = await sb
      .from('diagnostics')
      .select('*')
      .eq('user_id', user.id)
      .eq('is_current', true)
      .maybeSingle()

    if (!diag) {
      return NextResponse.json({ ok: true, data: null, reason: 'no_diagnostic' })
    }

    // 2. Survey answers → flat { question_key: value } map.
    const { data: surveyRows } = await sb
      .from('survey_answers')
      .select('question_key, answer')
      .eq('user_id', user.id)

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
      .eq('user_id', user.id)
      .eq('is_current', true)
      .maybeSingle()

    const griTop5 = mapGriTop5(gri?.top_5_limits)

    // 4. Current revenue from the metrics layer (the newer s1_* survey captures
    //    only goals, not current revenue). Best-effort: needs a linked company.
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

    // 4b. Goals from the Point A goal widget (companies.target_revenue_12m/3y_kzt,
    //     annual KZT). Canonical source — keeps Точка Б in sync with Точка А.
    let goal12mYear: number | null = null
    let goal3yYear: number | null = null
    {
      const { data: comp } = await sb
        .from('companies')
        .select('target_revenue_12m_kzt, target_revenue_3y_kzt')
        .eq('user_id', user.id)
        .maybeSingle()
      const t12 = comp?.target_revenue_12m_kzt
      const t3y = comp?.target_revenue_3y_kzt
      if (t12 != null && Number.isFinite(Number(t12))) goal12mYear = Number(t12)
      if (t3y != null && Number.isFinite(Number(t3y))) goal3yYear = Number(t3y)
    }

    // 5. Compute.
    const pointA = diagToPointA(diag)
    const pointB = calculatePointBV2(pointA, answers, {
      diagnosticId: diag.id as string,
      griTop5,
      currentRevenueYear,
      goal12mYear,
      goal3yYear,
    })

    // 6. Persist the current snapshot. One is_current row per diagnostic — full
    //    PointBV2 lives in `roadmap`; scalar columns mirror it for queryability.
    //    Writes via the SERVICE ROLE (point_b_analysis RLS has no owner-write
    //    policy on prod, which silently no-op'd session writes). Non-fatal.
    try {
      const { createClient: createSrClient } = await import('@supabase/supabase-js')
      const admin = createSrClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!,
        { auth: { autoRefreshToken: false, persistSession: false } },
      )
      const payload = {
        diagnostic_id: diag.id as string,
        horizon_months: 36,
        target_overall: pointB.target_overall_score,
        target_health: pointB.target_health_index,
        target_stage: pointB.target_stage,
        target_blocks: pointB.target_blocks,
        target_kpis: pointB.levers,
        gap_analysis: pointB.gap,
        roadmap: pointB,
        ai_strategy: pointB.ai_strategy,
        ai_status: pointB.ai_status,
        is_current: true,
        calculated_at: pointB.generated_at,
      }
      const { data: existing } = await admin
        .from('point_b_analysis')
        .select('id')
        .eq('diagnostic_id', diag.id as string)
        .eq('is_current', true)
        .maybeSingle()
      if (existing) {
        await admin.from('point_b_analysis').update(payload).eq('id', existing.id)
      } else {
        await admin.from('point_b_analysis').insert(payload)
      }
    } catch (persistErr) {
      console.error('[point-b] persist failed (non-fatal):', persistErr)
    }

    // 7. Latest approved expert correction (so the client sees the expert version).
    const { data: ev } = await sb
      .from('point_b_versions')
      .select('expert_notes, author_name, created_at')
      .eq('diagnostic_id', diag.id as string)
      .eq('is_approved', true)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    return NextResponse.json({ ok: true, data: pointB, expert_version: ev ?? null })
  } catch (error) {
    console.error('[point-b] error:', error)
    return NextResponse.json({ ok: false, error: 'Internal server error' }, { status: 500 })
  }
}
