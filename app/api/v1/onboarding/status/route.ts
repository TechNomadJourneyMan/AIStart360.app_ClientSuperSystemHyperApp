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

  // Goal text can live under legacy keys (s6_goal_*) or the current
  // 12-step form keys (s2n_goal_*). Read all known aliases and keep the
  // first non-empty answer, preferring the legacy key when both exist.
  const GOAL_12M_KEYS = ['s6_goal_12months', 's2n_goal_12m_what', 's2n_goal_12m_metrics']
  const GOAL_3Y_KEYS = ['s6_goal_3years', 's2n_goal_3y_what', 's2n_goal_3y_metrics']
  const goal12mByKey: Record<string, string> = {}
  const goal3yByKey: Record<string, string> = {}

  const steps = new Set<number>()
  for (const r of survey ?? []) {
    // Onboarding wizard steps are 1..12; step 0 is reserved for synthetic
    // metadata (period goals) and is not a real questionnaire step, so it
    // never counts toward progress. If a medical/alternate path ever needs
    // step 0 counted, add it explicitly here.
    if (typeof r.step === 'number' && r.step >= 1) steps.add(r.step)

    const v = (r.answer as { value: unknown })?.value
    if (typeof v === 'string' && v.trim()) {
      if (GOAL_12M_KEYS.includes(r.question_key)) goal12mByKey[r.question_key] = v
      if (GOAL_3Y_KEYS.includes(r.question_key)) goal3yByKey[r.question_key] = v
    }
  }

  const goal12m = GOAL_12M_KEYS.map((k) => goal12mByKey[k]).find(Boolean) ?? null
  const goal3y = GOAL_3Y_KEYS.map((k) => goal3yByKey[k]).find(Boolean) ?? null

  // Completion % = distinct answered wizard steps (1..12) / TOTAL_STEPS.
  // Steps are deduped via the Set so multiple answers in one step count once.
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
