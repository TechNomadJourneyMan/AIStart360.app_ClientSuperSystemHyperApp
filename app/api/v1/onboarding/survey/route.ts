export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase-server'
import { notifyAdmins } from '@/lib/notifications'

// GET /api/v1/onboarding/survey?user_id=xxx
export async function GET(req: NextRequest) {
  const userId = req.nextUrl.searchParams.get('user_id')
  if (!userId) return NextResponse.json({ ok: false, error: 'user_id required' }, { status: 400 })

  const sb = createServerClient()
  const { data, error } = await sb
    .from('survey_answers')
    .select('*')
    .eq('user_id', userId)
    .order('answered_at', { ascending: true })

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })

  // Transform to { question_key: value } map
  const answers: Record<string, unknown> = {}
  const steps: Record<number, boolean> = {}
  for (const row of (data ?? [])) {
    answers[row.question_key] = (row.answer as { value: unknown }).value
    steps[row.step] = true
  }

  return NextResponse.json({
    ok: true,
    data: {
      answers,
      completed_steps: Object.keys(steps).map(Number),
      current_step: Math.max(0, ...Object.keys(steps).map(Number)) + 1,
    }
  })
}

// POST /api/v1/onboarding/survey
// Body: { user_id, company_id?, step, answers: Record<string, { value: unknown }> }
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { user_id, company_id, step, answers } = body

    if (!user_id || !step || !answers) {
      return NextResponse.json({ ok: false, error: 'user_id, step, answers required' }, { status: 400 })
    }

    const sb = createServerClient()

    const rows = Object.entries(answers).map(([question_key, answer]) => ({
      user_id,
      company_id: company_id ?? null,
      step,
      question_key,
      answer,
    }))

    // Upsert (insert or update on conflict user_id + question_key)
    const { error } = await sb
      .from('survey_answers')
      .upsert(rows, { onConflict: 'user_id,question_key' })

    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })

    // Notify admins when the final survey step is completed (step 12)
    if (step >= 12) {
      notifyAdmins('survey_completed', {
        step,
        answersCount: rows.length,
      }, user_id)
    }

    return NextResponse.json({ ok: true, data: { saved: rows.length } })
  } catch (e) {
    return NextResponse.json({ ok: false, error: 'Invalid request body' }, { status: 400 })
  }
}
