export const dynamic = 'force-dynamic'
export const maxDuration = 60 // Allow up to 60s for AI generation

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase-server'
import { analyzePointA } from '@/lib/ai/point-a-analyzer'
import { calculatePointA } from '@/lib/point-a-engine'
import type { Company } from '@/types/onboarding'

/**
 * POST /api/v1/diagnostics/ai-analyze
 * Internal endpoint: runs AI analysis on an existing diagnostic.
 * Called asynchronously after rule-based recalculation completes.
 *
 * Body: { diagnostic_id, user_id }
 */
export async function POST(req: NextRequest) {
  try {
    const { diagnostic_id, user_id } = await req.json()
    if (!diagnostic_id || !user_id) {
      return NextResponse.json({ ok: false, error: 'diagnostic_id and user_id required' }, { status: 400 })
    }

    const sb = createServerClient()

    // 1. Mark as processing
    await sb
      .from('diagnostics')
      .update({ ai_status: 'processing' })
      .eq('id', diagnostic_id)

    // 2. Fetch survey answers
    const { data: rows } = await sb
      .from('survey_answers')
      .select('question_key, answer')
      .eq('user_id', user_id)

    const answers: Record<string, unknown> = {}
    for (const row of (rows ?? [])) {
      answers[row.question_key] = (row.answer as { value: unknown }).value
    }

    // 3. Fetch company
    const { data: company } = await sb
      .from('companies')
      .select('*')
      .eq('user_id', user_id)
      .maybeSingle()

    // 4. Run rule-based engine to get PointA structure
    const pointA = calculatePointA(answers)

    // 5. Run AI analysis
    const aiResult = await analyzePointA(answers, pointA, company as Company | null)

    if (aiResult) {
      // 6. Store result
      await sb
        .from('diagnostics')
        .update({ ai_analysis: aiResult, ai_status: 'completed' })
        .eq('id', diagnostic_id)

      return NextResponse.json({ ok: true, ai_status: 'completed' })
    } else {
      await sb
        .from('diagnostics')
        .update({ ai_status: 'failed' })
        .eq('id', diagnostic_id)

      return NextResponse.json({ ok: false, ai_status: 'failed', error: 'AI analysis returned null' })
    }
  } catch (error) {
    console.error('[ai-analyze] Error:', error)

    // Try to mark as failed if we have the diagnostic_id
    try {
      const body = await req.clone().json().catch(() => ({}))
      if (body.diagnostic_id) {
        const sb = createServerClient()
        await sb
          .from('diagnostics')
          .update({ ai_status: 'failed' })
          .eq('id', body.diagnostic_id)
      }
    } catch { /* best effort */ }

    return NextResponse.json({ ok: false, error: 'AI analysis failed' }, { status: 500 })
  }
}
