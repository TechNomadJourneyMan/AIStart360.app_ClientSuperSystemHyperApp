export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase-server'

// Total wizard steps in the onboarding survey (1..12).
const TOTAL_STEPS = 12

// GET /api/v1/onboarding/status
// Returns { survey: { completed_steps, total_steps, percent, current_goal_12m, current_goal_3y },
//           documents: { count, has_files } }
export async function GET() {
  const sb = createServerClient()
  const { data: userData, error: userErr } = await sb.auth.getUser()
  if (userErr || !userData?.user) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }
  const userId = userData.user.id

  const [{ data: survey }, { count: docCount }] = await Promise.all([
    sb
      .from('survey_answers')
      .select('step, question_key, answer')
      .eq('user_id', userId),
    sb
      .from('documents')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId),
  ])

  const steps = new Set<number>()
  let goal12m: string | null = null
  let goal3y: string | null = null
  for (const r of survey ?? []) {
    // step 0 is reserved for synthetic metadata (period goals) — skip it
    // from the survey progress calculation.
    if (typeof r.step === 'number' && r.step >= 1) steps.add(r.step)
    if (r.question_key === 's6_goal_12months') {
      const v = (r.answer as { value: unknown })?.value
      if (typeof v === 'string' && v.trim()) goal12m = v
    }
    if (r.question_key === 's6_goal_3years') {
      const v = (r.answer as { value: unknown })?.value
      if (typeof v === 'string' && v.trim()) goal3y = v
    }
  }

  const completed = steps.size
  const percent = Math.round((completed / TOTAL_STEPS) * 100)

  return NextResponse.json({
    ok: true,
    data: {
      survey: {
        completed_steps: completed,
        total_steps: TOTAL_STEPS,
        percent,
        is_complete: completed >= TOTAL_STEPS,
        current_goal_12m: goal12m,
        current_goal_3y: goal3y,
      },
      documents: {
        count: docCount ?? 0,
        has_files: (docCount ?? 0) > 0,
      },
    },
  })
}
