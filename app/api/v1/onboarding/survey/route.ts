export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase-server'
import { notifyAdmins } from '@/lib/notifications'
import { resolveTargetUserId } from '@/lib/api-identity'

// GET /api/v1/onboarding/survey — the caller's own survey answers (session user).
// SECURITY (audit 2026-07-02): identity is derived from the Supabase session,
// not a client-supplied `user_id` (was an IDOR: any caller could read another
// user's business-sensitive survey answers). Staff may still pass an explicit
// `user_id` to read a client's answers.
export async function GET(req: NextRequest) {
  const sb = createServerClient()
  const resolved = await resolveTargetUserId(sb, req.nextUrl.searchParams.get('user_id'))
  if ('error' in resolved) {
    return NextResponse.json({ ok: false, error: resolved.error }, { status: resolved.error === 'unauthorized' ? 401 : 403 })
  }
  const userId = resolved.userId

  const { data, error } = await sb
    .from('survey_answers')
    .select('*')
    .eq('user_id', userId)
    .order('answered_at', { ascending: true })

  if (error) return NextResponse.json({ ok: false, error: 'Failed to load answers' }, { status: 500 })

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

    if (!step || !answers) {
      return NextResponse.json({ ok: false, error: 'step, answers required' }, { status: 400 })
    }

    const sb = createServerClient()
    // SECURITY (audit 2026-07-02): write to the session user's own answers, not a
    // body-supplied `user_id` (was an IDOR write). Staff may target a client.
    const resolved = await resolveTargetUserId(sb, user_id)
    if ('error' in resolved) {
      return NextResponse.json({ ok: false, error: resolved.error }, { status: resolved.error === 'unauthorized' ? 401 : 403 })
    }
    const targetUserId = resolved.userId

    const rows = Object.entries(answers).map(([question_key, answer]) => ({
      user_id: targetUserId,
      company_id: company_id ?? null,
      step,
      question_key,
      answer,
    }))

    // Upsert (insert or update on conflict user_id + question_key)
    const { error } = await sb
      .from('survey_answers')
      .upsert(rows, { onConflict: 'user_id,question_key' })

    if (error) return NextResponse.json({ ok: false, error: 'Failed to save answers' }, { status: 500 })

    // Notify admins when the final survey step is completed (step 12)
    if (step >= 12) {
      notifyAdmins('survey_completed', {
        step,
        answersCount: rows.length,
      }, targetUserId)
    }

    return NextResponse.json({ ok: true, data: { saved: rows.length } })
  } catch (e) {
    return NextResponse.json({ ok: false, error: 'Invalid request body' }, { status: 400 })
  }
}
