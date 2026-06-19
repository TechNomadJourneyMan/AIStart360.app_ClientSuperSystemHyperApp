export const dynamic = 'force-dynamic'
// Full Point A analysis is a large structured generation (~4-5K tokens) that can
// take 90-150s on Claude Sonnet. This route runs async (fire-and-forget from
// recalculate, polled via ai-status), so a generous budget is fine.
export const maxDuration = 300

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase-server'
import { analyzePointA } from '@/lib/ai/point-a-analyzer'
import type { GriExpertNotes } from '@/lib/ai/point-a-analyzer'
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

    // 4. Fetch GRI expert notes (step=0, gri_expert_* keys)
    const { data: expertRows } = await sb
      .from('survey_answers')
      .select('question_key, answer')
      .eq('user_id', user_id)
      .eq('step', 0)
      .like('question_key', 'gri_expert_%')

    const expertNotes: GriExpertNotes = {}
    for (const row of (expertRows ?? [])) {
      const block = row.question_key.replace('gri_expert_', '') as keyof GriExpertNotes
      const value = (row.answer as { value: unknown })?.value
      if (typeof value === 'string' && value.trim()) {
        expertNotes[block] = value
      }
    }

    // 5. Run rule-based engine to get PointA structure
    const pointA = calculatePointA(answers)

    // 6. Run AI analysis (with expert notes)
    const aiResult = await analyzePointA(answers, pointA, company as Company | null, expertNotes)

    if (aiResult) {
      // 7. Store result
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
