export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase-server'
import { calculatePointA } from '@/lib/point-a-engine'
import { notifyAdmins } from '@/lib/notifications'

// POST /api/v1/diagnostics/recalculate
// Body: { user_id }
export async function POST(req: NextRequest) {
  try {
    const { user_id } = await req.json()
    if (!user_id) return NextResponse.json({ ok: false, error: 'user_id required' }, { status: 400 })

    const sb = createServerClient()

    // Fetch all survey answers for this user
    const { data: rows, error: surveyErr } = await sb
      .from('survey_answers')
      .select('question_key, answer')
      .eq('user_id', user_id)

    if (surveyErr) return NextResponse.json({ ok: false, error: surveyErr.message }, { status: 500 })

    // Build flat answers map
    const answers: Record<string, unknown> = {}
    for (const row of (rows ?? [])) {
      answers[row.question_key] = (row.answer as { value: unknown }).value
    }

    if (Object.keys(answers).length === 0) {
      return NextResponse.json({ ok: false, error: 'No survey answers found — complete the wizard first' }, { status: 422 })
    }

    // Get company_id
    const { data: company } = await sb
      .from('companies')
      .select('id')
      .eq('user_id', user_id)
      .single()

    // Calculate Point A
    const result = calculatePointA(answers)

    // Store in diagnostics table
    const { data: diag, error: diagErr } = await sb
      .from('diagnostics')
      .insert({
        user_id,
        company_id: company?.id ?? null,
        overall_score: result.overall_score,
        health_index: result.health_index,
        stage: result.stage,
        finance_score: result.blocks.finance,
        marketing_score: result.blocks.marketing,
        operations_score: result.blocks.operations,
        strategy_score: result.blocks.strategy,
        sales_score: result.blocks.sales,
        risks: result.risks,
        insights: result.insights,
        quick_wins: result.quick_wins,
        data_gaps: result.data_gaps,
        is_current: true,
        ai_status: process.env.ANTHROPIC_API_KEY ? 'processing' : 'none',
      })
      .select()
      .single()

    if (diagErr) return NextResponse.json({ ok: false, error: diagErr.message }, { status: 500 })

    // Fire async AI analysis (non-blocking)
    if (process.env.ANTHROPIC_API_KEY && diag?.id) {
      const baseUrl = req.nextUrl.origin
      fetch(`${baseUrl}/api/v1/diagnostics/ai-analyze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ diagnostic_id: diag.id, user_id }),
      }).catch(err => console.error('[recalculate] Failed to fire AI analysis:', err))
    }

    // Notify admins about diagnostic recalculation
    notifyAdmins('diagnostic_recalculated', {
      overallScore: result.overall_score,
      stage: result.stage ?? null,
      diagnosticId: diag?.id,
    }, user_id)

    return NextResponse.json({ ok: true, data: { diagnostic: diag, point_a: result } })
  } catch (e) {
    return NextResponse.json({ ok: false, error: 'Internal error' }, { status: 500 })
  }
}
