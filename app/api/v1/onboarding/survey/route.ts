export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase-server'
import { notifyAdmins } from '@/lib/notifications'
import { resolveTargetUserId } from '@/lib/api-identity'
import { completedStepsFromRows, stepForQuestionKey, surveyProgressFromRows } from '@/lib/survey/steps'
import { buildSurveySummary, syncSurveyToGoogleSheet } from '@/lib/survey/export'
import { spreadsheetUrl } from '@/lib/integrations/google-sheets'
import { annualGoalFromAnswers } from '@/lib/survey/targets'
import { claimCompletionNotice, shouldAnnounceCompletion } from '@/lib/survey/completion-notice'
import { createServiceClient } from '@/lib/supabase-service'

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

  // Transform to { question_key: value } map. Completed steps are derived
  // from the question key (lib/survey/steps.ts), not the stored `step`.
  const answers: Record<string, unknown> = {}
  for (const row of (data ?? [])) {
    answers[row.question_key] = (row.answer as { value: unknown }).value
  }
  const completedSteps = completedStepsFromRows(data ?? [])

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

    // Every row carries the step that OWNS its question key. The client sends
    // the whole accumulated answer map with the step it is standing on, so
    // trusting `step` from the body overwrote the column on every row (the
    // «1/12 шагов» bug). Unknown keys (medical / e-commerce intakes) keep the
    // body step.
    const bodyStep = Number(step)
    const safeBodyStep = Number.isFinite(bodyStep) && bodyStep >= 0 && bodyStep <= 12 ? bodyStep : 0
    const rows = Object.entries(answers as Record<string, unknown>).map(([question_key, answer]) => ({
      user_id: targetUserId,
      company_id: company_id ?? null,
      step: stepForQuestionKey(question_key, safeBodyStep) ?? safeBodyStep,
      question_key,
      answer,
    }))

    // Completion state BEFORE the write — the Telegram alert fires on the
    // transition to complete, not on every re-save of an already full survey.
    const { data: beforeRows } = await sb
      .from('survey_answers')
      .select('question_key, step, answer')
      .eq('user_id', targetUserId)
    const wasComplete = surveyProgressFromRows(beforeRows ?? []).is_complete

    // Upsert (insert or update on conflict user_id + question_key)
    const { error } = await sb
      .from('survey_answers')
      .upsert(rows, { onConflict: 'user_id,question_key' })

    if (error) return NextResponse.json({ ok: false, error: 'Failed to save answers' }, { status: 500 })

    // Keep companies.target_revenue_* in sync with the goals typed on step 1
    // (E2E bug: dashboard «Снимок Точки А ещё не построен» while Point B already
    // showed the goal). Manual targets set via /companies/targets are not
    // overwritten — only NULLs are filled.
    await syncCompanyTargetsFromAnswers(sb, targetUserId, answers as Record<string, unknown>)

    const { data: afterRows } = await sb
      .from('survey_answers')
      .select('question_key, step, answer')
      .eq('user_id', targetUserId)
    const allRows = afterRows ?? []
    const progress = surveyProgressFromRows(allRows)

    // Mirror the answers into Google Sheets on every save (idempotent upsert
    // keyed by user_id). Best-effort: a Sheets outage never fails the save.
    let sheet: { ok: boolean; url: string | null } = { ok: false, url: spreadsheetUrl() }
    try {
      const { data: userData } = await sb.auth.getUser()
      const res = await syncSurveyToGoogleSheet(allRows, {
        userId: targetUserId,
        email: userData?.user?.email ?? null,
      })
      sheet = { ok: res.ok, url: res.url }
    } catch (e) {
      console.error('[onboarding/survey] sheet sync failed', e)
    }

    // Уведомление «анкета пройдена» — Telegram/email админам + запись в
    // клиентскую ленту. Триггер = отправлен ФИНАЛЬНЫЙ шаг мастера (или анкета
    // впервые стала полной): проверка «все 12 шагов заполнены» ненадёжна, шаг 12
    // можно проехать пустым (см. lib/survey/completion-notice.ts). Повторы гасит
    // маркер в app_notifications.
    let announced = false
    if (
      shouldAnnounceCompletion({
        submittedStep: safeBodyStep,
        totalSteps: progress.total_steps,
        isCompleteNow: progress.is_complete,
        wasCompleteBefore: wasComplete,
      })
    ) {
      const summary = buildSurveySummary(allRows)
      const first = await claimCompletionNotice(createServiceClient(), targetUserId, {
        completedSteps: progress.completed,
        totalSteps: progress.total_steps,
        company: summary.company,
        sheetUrl: sheet.url,
      })
      if (first) {
        announced = true
        notifyAdmins('survey_completed', {
          step,
          answersCount: rows.length,
          completedSteps: progress.completed,
          totalSteps: progress.total_steps,
          company: summary.company,
          contact: summary.contact,
          phone: summary.phone,
          contactEmail: summary.email,
          industry: summary.industry,
          revenue: summary.revenue,
          goal12m: summary.goal12m,
          sheetUrl: sheet.url,
        }, targetUserId)
      }
    }

    return NextResponse.json({
      ok: true,
      data: {
        saved: rows.length,
        completed_steps: progress.completed,
        total_steps: progress.total_steps,
        percent: progress.percent,
        sheet_synced: sheet.ok,
        announced,
      },
    })
  } catch (e) {
    return NextResponse.json({ ok: false, error: 'Invalid request body' }, { status: 400 })
  }
}

// ─── helpers ─────────────────────────────────────────────────────────────────

async function syncCompanyTargetsFromAnswers(
  sb: ReturnType<typeof createServerClient>,
  userId: string,
  answers: Record<string, unknown>,
): Promise<void> {
  const goal12 = annualGoalFromAnswers(answers, 's1_goal_12m_revenue_year', 's1_goal_12m_revenue_month', 12)
  const goal3y = annualGoalFromAnswers(answers, 's1_goal_3y_revenue_year', 's1_goal_3y_revenue_month', 12)
  if (!goal12 && !goal3y) return
  try {
    const { data: company } = await sb
      .from('companies')
      .select('id, target_revenue_12m_kzt, target_revenue_3y_kzt')
      .eq('user_id', userId)
      .maybeSingle()
    if (!company) return
    const patch: Record<string, number | string> = {}
    if (goal12 && company.target_revenue_12m_kzt == null) patch.target_revenue_12m_kzt = goal12
    if (goal3y && company.target_revenue_3y_kzt == null) patch.target_revenue_3y_kzt = goal3y
    if (!Object.keys(patch).length) return
    patch.updated_at = new Date().toISOString()
    await sb.from('companies').update(patch).eq('id', company.id)
  } catch (e) {
    console.error('[onboarding/survey] target sync failed', e)
  }
}
