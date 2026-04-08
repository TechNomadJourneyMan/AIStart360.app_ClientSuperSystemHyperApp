export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase-server'
import { calculatePointA } from '@/lib/point-a-engine'
import { calculatePointB } from '@/lib/point-b-engine'

/**
 * GET /api/v1/diagnostics/point-b?user_id=xxx
 * Returns Point B calculation based on latest Point A + survey answers.
 */
export async function GET(req: NextRequest) {
  const userId = req.nextUrl.searchParams.get('user_id')
  if (!userId) return NextResponse.json({ ok: false, error: 'user_id required' }, { status: 400 })

  try {
    const sb = createServerClient()

    // 1. Get latest diagnostic (Point A)
    const { data: diag } = await sb
      .from('diagnostics')
      .select('*')
      .eq('user_id', userId)
      .eq('is_current', true)
      .maybeSingle()

    if (!diag) {
      return NextResponse.json({ ok: true, data: null, reason: 'no_diagnostic' })
    }

    // 2. Get survey answers
    const { data: surveyRows } = await sb
      .from('survey_answers')
      .select('question_key, answer')
      .eq('user_id', userId)

    const answers: Record<string, unknown> = {}
    for (const row of surveyRows ?? []) {
      answers[row.question_key] = (row.answer as { value?: unknown })?.value ?? row.answer
    }

    // 3. Reconstruct Point A from diagnostic
    const pointA = {
      overall_score: diag.overall_score ?? 0,
      health_index: diag.health_index ?? 0,
      stage: diag.stage ?? 'seed',
      blocks: {
        finance: diag.finance_score ?? { score: 0, status: 'critical', top_issues: [], recommendations: [] },
        sales: diag.sales_score ?? { score: 0, status: 'critical', top_issues: [], recommendations: [] },
        operations: diag.operations_score ?? { score: 0, status: 'critical', top_issues: [], recommendations: [] },
        marketing: diag.marketing_score ?? { score: 0, status: 'critical', top_issues: [], recommendations: [] },
        strategy: diag.strategy_score ?? { score: 0, status: 'critical', top_issues: [], recommendations: [] },
      },
      risks: diag.risks ?? [],
      insights: diag.insights ?? [],
      quick_wins: diag.quick_wins ?? [],
      data_gaps: diag.data_gaps ?? [],
    }

    // 4. Calculate Point B
    const pointB = calculatePointB(pointA, answers)
    pointB.diagnostic_id = diag.id

    return NextResponse.json({ ok: true, data: pointB })
  } catch (error) {
    console.error('[point-b] error:', error)
    return NextResponse.json({ ok: false, error: 'Internal server error' }, { status: 500 })
  }
}
