export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase-server'
import { surveyProgressFromRows } from '@/lib/survey/steps'

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

  // Goal text can live under legacy keys (s6_goal_*) or the current
  // 12-step form keys (s2n_goal_*). Read all known aliases and keep the
  // first non-empty answer, preferring the legacy key when both exist.
  const GOAL_12M_KEYS = ['s6_goal_12months', 's2n_goal_12m_what', 's2n_goal_12m_metrics']
  const GOAL_3Y_KEYS = ['s6_goal_3years', 's2n_goal_3y_what', 's2n_goal_3y_metrics']
  const goal12mByKey: Record<string, string> = {}
  const goal3yByKey: Record<string, string> = {}

  for (const r of survey ?? []) {
    const v = (r.answer as { value: unknown })?.value
    if (typeof v === 'string' && v.trim()) {
      if (GOAL_12M_KEYS.includes(r.question_key)) goal12mByKey[r.question_key] = v
      if (GOAL_3Y_KEYS.includes(r.question_key)) goal3yByKey[r.question_key] = v
    }
  }

  const goal12m = GOAL_12M_KEYS.map((k) => goal12mByKey[k]).find(Boolean) ?? null
  const goal3y = GOAL_3Y_KEYS.map((k) => goal3yByKey[k]).find(Boolean) ?? null

  // Completion = distinct answered wizard steps (1..12). The step is derived
  // from the question key (lib/survey/steps.ts), NOT from the stored `step`
  // column — that column was overwritten on every save and made the whole
  // portal report "1/12" while the wizard itself was complete.
  const progress = surveyProgressFromRows(survey ?? [])

  return NextResponse.json({
    ok: true,
    data: {
      survey: {
        completed_steps: progress.completed,
        total_steps: progress.total_steps,
        percent: progress.percent,
        is_complete: progress.is_complete,
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
