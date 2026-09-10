export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase-server'
import { notifyAdmins } from '@/lib/notifications'
import { resolveTargetUserId } from '@/lib/api-identity'
import {
  completedStepsFromRows,
  isWizardVisibleKey,
  isWritableSurveyKey,
  stepForQuestionKey,
  surveyProgressFromRows,
  type SurveyStepRow,
} from '@/lib/survey/steps'
import { buildSurveySummary, syncSurveyToGoogleSheet } from '@/lib/survey/export'
import { spreadsheetUrl } from '@/lib/integrations/google-sheets'
import { annualGoalFromAnswers } from '@/lib/survey/targets'
import { claimCompletionNotice, shouldAnnounceCompletion } from '@/lib/survey/completion-notice'
import { createServiceClient } from '@/lib/supabase-service'
import { runInBackground } from '@/lib/background'

// GET /api/v1/onboarding/survey — the caller's own survey answers (session user).
// SECURITY (audit 2026-07-02): identity is derived from the Supabase session,
// not a client-supplied `user_id` (was an IDOR: any caller could read another
// user's business-sensitive survey answers). Staff may still pass an explicit
// `user_id` to read a client's answers.
//
// Only survey-family keys are returned. survey_answers also stores staff-only
// expert notes (gri_expert_*) and dashboard widget data (goal_*_v2); returning
// them leaked expert notes to the client, and the wizard then POSTed them back
// re-stamped with a wizard step — which hid them from the expert panel.
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

  const rows = (data ?? []).filter((row) => isWizardVisibleKey(String(row.question_key)))
  const answers: Record<string, unknown> = {}
  for (const row of rows) {
    answers[row.question_key] = (row.answer as { value: unknown } | null)?.value
  }
  const completedSteps = completedStepsFromRows(rows)

  return NextResponse.json({
    ok: true,
    data: {
      answers,
      completed_steps: completedSteps,
      current_step: Math.max(0, ...completedSteps) + 1,
    }
  })
}

// POST /api/v1/onboarding/survey
// Body: { user_id?, company_id?, step, answers: Record<string, { value: unknown }>, final?: boolean }
//
// Latency budget: the response returns right after the upsert + target sync.
// The Google Sheets mirror and the «анкета пройдена» alert run in the
// background — in the QA run they made every «Далее» take 6–19 s.
export async function POST(req: NextRequest) {
  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid request body' }, { status: 400 })
  }
  const { user_id, company_id, step, answers } = body as {
    user_id?: string | null
    company_id?: string | null
    step?: unknown
    answers?: unknown
  }
  const finalSubmitted = body.final === true

  const bodyStep = Number(step)
  if (!Number.isInteger(bodyStep) || bodyStep < 1 || bodyStep > 12) {
    return NextResponse.json({ ok: false, error: 'step must be an integer 1..12' }, { status: 400 })
  }
  if (!answers || typeof answers !== 'object' || Array.isArray(answers)) {
    return NextResponse.json({ ok: false, error: 'answers must be an object' }, { status: 400 })
  }

  const sb = createServerClient()
  // SECURITY (audit 2026-07-02): write to the session user's own answers, not a
  // body-supplied `user_id` (was an IDOR write). Staff may target a client.
  const resolved = await resolveTargetUserId(sb, user_id ?? null)
  if ('error' in resolved) {
    return NextResponse.json({ ok: false, error: resolved.error }, { status: resolved.error === 'unauthorized' ? 401 : 403 })
  }
  const targetUserId = resolved.userId

  const { data: beforeData, error: beforeErr } = await sb
    .from('survey_answers')
    .select('question_key, step, answer')
    .eq('user_id', targetUserId)
  if (beforeErr) return NextResponse.json({ ok: false, error: 'Failed to load answers' }, { status: 500 })
  const beforeRows = (beforeData ?? []) as SurveyStepRow[]
  const existingStep = new Map(beforeRows.map((r) => [r.question_key, r.step == null ? null : Number(r.step)]))
  const wasComplete = surveyProgressFromRows(beforeRows).is_complete

  // Only survey keys may be written here (never gri_expert_* / goal_*_v2 …).
  // Wizard keys get the step that OWNS them; other intake keys keep the step
  // they already have and fall back to the body step only when new.
  const accepted = Object.entries(answers as Record<string, unknown>).filter(([k]) => isWritableSurveyKey(k))
  const ignored = Object.keys(answers as Record<string, unknown>).length - accepted.length
  const rows = accepted.map(([question_key, answer]) => ({
    user_id: targetUserId,
    company_id: company_id ?? null,
    step: stepForQuestionKey(question_key, null) ?? existingStep.get(question_key) ?? bodyStep,
    question_key,
    answer,
    answered_at: new Date().toISOString(),
  }))

  if (rows.length) {
    const { error } = await sb
      .from('survey_answers')
      .upsert(rows, { onConflict: 'user_id,question_key' })
    if (error) return NextResponse.json({ ok: false, error: 'Failed to save answers' }, { status: 500 })
  }

  // State after the write, computed in memory (saves a round-trip).
  const merged = new Map(beforeRows.map((r) => [r.question_key, r]))
  for (const r of rows) merged.set(r.question_key, { question_key: r.question_key, step: r.step, answer: r.answer })
  const allRows = Array.from(merged.values())
  const progress = surveyProgressFromRows(allRows)

  // Keep companies.target_revenue_* in sync with the step-1 goals — including
  // later edits, as long as the stored target still came from the survey.
  const beforeAnswers: Record<string, unknown> = {}
  for (const r of beforeRows) beforeAnswers[r.question_key] = r.answer
  await syncCompanyTargetsFromAnswers(sb, targetUserId, Object.fromEntries(accepted), beforeAnswers)

  const announce = shouldAnnounceCompletion({
    finalSubmitted,
    isCompleteNow: progress.is_complete,
    wasCompleteBefore: wasComplete,
  })

  runInBackground('survey-mirror', () => mirrorAndAnnounce(targetUserId, announce, Number(step)))

  return NextResponse.json({
    ok: true,
    data: {
      saved: rows.length,
      ignored,
      completed_steps: progress.completed,
      total_steps: progress.total_steps,
      percent: progress.percent,
      is_complete: progress.is_complete,
    },
  })
}

// ─── background: Google Sheets mirror + completion alert ─────────────────────

async function mirrorAndAnnounce(userId: string, announce: boolean, step: number): Promise<void> {
  const service = createServiceClient()
  // Re-read the latest answers so a slow background run never mirrors a stale snapshot.
  const [{ data: rowsData }, { data: profile }] = await Promise.all([
    service.from('survey_answers').select('question_key, step, answer').eq('user_id', userId),
    service.from('profiles').select('email').eq('id', userId).maybeSingle(),
  ])
  const rows = ((rowsData ?? []) as SurveyStepRow[]).filter((r) => isWizardVisibleKey(r.question_key))
  const progress = surveyProgressFromRows(rows)

  // Sheet email = the CLIENT's email (profile), never the session user's —
  // staff saving on behalf of a client used to put their own email there.
  const sheet = await syncSurveyToGoogleSheet(rows, {
    userId,
    email: (profile as { email?: string | null } | null)?.email ?? null,
  })
  if (!sheet.ok && !sheet.skipped) console.error('[onboarding/survey] sheet mirror failed:', sheet.error)

  if (!announce) return
  const summary = buildSurveySummary(rows)
  const first = await claimCompletionNotice(service, userId, {
    completedSteps: progress.completed,
    totalSteps: progress.total_steps,
    company: summary.company,
  })
  if (!first) return
  await notifyAdmins('survey_completed', {
    step,
    completedSteps: progress.completed,
    totalSteps: progress.total_steps,
    company: summary.company,
    contact: summary.contact,
    phone: summary.phone,
    contactEmail: summary.email,
    industry: summary.industry,
    revenue: summary.revenue,
    goal12m: summary.goal12m,
    sheetUrl: sheet.url ?? spreadsheetUrl(),
  }, userId)
}

// ─── helpers ─────────────────────────────────────────────────────────────────

const unwrap = (v: unknown) =>
  v !== null && typeof v === 'object' && !Array.isArray(v) && 'value' in (v as object) ? (v as { value: unknown }).value : v

/**
 * Fill or follow `companies.target_revenue_*` from the step-1 goals.
 * A stored target is replaced only when it is empty or still equals the goal
 * derived from the PREVIOUS survey answers (i.e. it came from the survey);
 * a target the owner typed on the dashboard is never overwritten.
 */
async function syncCompanyTargetsFromAnswers(
  sb: ReturnType<typeof createServerClient>,
  userId: string,
  newAnswers: Record<string, unknown>,
  beforeAnswers: Record<string, unknown>,
): Promise<void> {
  const now: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(beforeAnswers)) now[k] = unwrap(v)
  for (const [k, v] of Object.entries(newAnswers)) now[k] = unwrap(v)
  const prev: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(beforeAnswers)) prev[k] = unwrap(v)

  const touchesGoals = Object.keys(newAnswers).some((k) => k.startsWith('s1_goal_'))
  if (!touchesGoals) return

  const goal12 = annualGoalFromAnswers(now, 's1_goal_12m_revenue_year', 's1_goal_12m_revenue_month', 12)
  const goal3y = annualGoalFromAnswers(now, 's1_goal_3y_revenue_year', 's1_goal_3y_revenue_month', 12)
  const prev12 = annualGoalFromAnswers(prev, 's1_goal_12m_revenue_year', 's1_goal_12m_revenue_month', 12)
  const prev3y = annualGoalFromAnswers(prev, 's1_goal_3y_revenue_year', 's1_goal_3y_revenue_month', 12)
  if (!goal12 && !goal3y) return
  try {
    const { data: company } = await sb
      .from('companies')
      .select('id, target_revenue_12m_kzt, target_revenue_3y_kzt')
      .eq('user_id', userId)
      .maybeSingle()
    if (!company) return
    const followsSurvey = (stored: unknown, previous: number | null) =>
      stored == null || (previous != null && Number(stored) === previous)
    const patch: Record<string, number | string> = {}
    if (goal12 && Number(company.target_revenue_12m_kzt) !== goal12 && followsSurvey(company.target_revenue_12m_kzt, prev12)) {
      patch.target_revenue_12m_kzt = goal12
    }
    if (goal3y && Number(company.target_revenue_3y_kzt) !== goal3y && followsSurvey(company.target_revenue_3y_kzt, prev3y)) {
      patch.target_revenue_3y_kzt = goal3y
    }
    if (!Object.keys(patch).length) return
    patch.updated_at = new Date().toISOString()
    await sb.from('companies').update(patch).eq('id', company.id)
  } catch (e) {
    console.error('[onboarding/survey] target sync failed', e)
  }
}
