export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase-server'
import { notifyAdmins } from '@/lib/notifications'
import { notifyQuestionnaireCompleted } from '@/lib/notifications/product'
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
import { syncGoalsFromSurvey, surveyWriterFor, touchesGoalKeys, type GoalActor } from '@/lib/goals/survey-sync'
import { claimCompletionNotice, shouldAnnounceCompletion } from '@/lib/survey/completion-notice'
import { createServiceClient } from '@/lib/supabase-service'
import { runInBackground } from '@/lib/background'
import { parseSurveySaveBody } from '@/lib/survey/schema'
import { fromAnswerEnvelope } from '@/lib/survey/answer-value'
import { trackEvent, trackEventOnce } from '@/lib/events/track'
import { emitPlatformEventSafely } from '@/lib/events/platform'
import { activeImpersonation } from '@/lib/impersonation/server'
import { adminEditSurvey, SurveyEditError } from '@/lib/admin/survey-admin'
import { isStaffRole } from '@/lib/admin/rbac'
import { isRateLimitedKey } from '@/lib/rate-limit'
import { answersProfanityResponse } from '@/lib/moderation/http'
import {
  attributionColumns, authorFor, groupByAuthor, loadStaffRoles, staffAuthorRole, writeWithAttribution, type AnswerAuthor,
} from '@/lib/survey/attribution'
import { loadAttribution, type AttributionSourceRow, type ProfilesReader } from '@/lib/survey/attribution-read'
import type { AnswerAttribution } from '@/lib/survey/attribution-label'

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
    // «Не знаю» / «примерно» come back as marks (lib/survey/answer-value.ts).
    answers[row.question_key] = fromAnswerEnvelope(row.answer)
  }
  const completedSteps = completedStepsFromRows(rows)
  // Who filled each answer (line under the field). Expert / admin names come
  // from profiles, which the client's own session cannot read → service role.
  const attribution = await loadAttribution(nameReader(sb), rows as AttributionSourceRow[])

  return NextResponse.json({
    ok: true,
    data: {
      answers,
      attribution,
      completed_steps: completedSteps,
      current_step: Math.max(0, ...completedSteps) + 1,
    }
  })
}

function nameReader(fallback: ProfilesReader): ProfilesReader {
  try {
    return createServiceClient()
  } catch {
    return fallback
  }
}

// POST /api/v1/onboarding/survey
// Body: see lib/survey/schema.ts — { user_id?, step, answers: Record<string, { value }>, autosave?, final? }
//
// Latency budget: the response returns right after the upsert + target sync.
// The Google Sheets mirror and the «анкета пройдена» alert run in the
// background — in the QA run they made every «Далее» take 6–19 s.
export async function POST(req: NextRequest) {
  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid request body' }, { status: 400 })
  }
  const parsed = parseSurveySaveBody(raw)
  if (!parsed.ok) return NextResponse.json({ ok: false, error: parsed.error }, { status: 400 })
  const { user_id, step: bodyStep, answers, autosave, origins } = parsed.data
  const finalSubmitted = parsed.data.final

  // Свободные текстовые ответы с матом не сохраняем: 400 с ключом вопроса,
  // чтобы мастер показал ошибку рядом с ним. Числа и выбор не трогаем.
  const profane = answersProfanityResponse(Object.fromEntries(
    Object.entries(answers)
      .filter(([k]) => isWritableSurveyKey(k))
      .map(([k, a]) => [k, (a as { value?: unknown } | null)?.value]),
  ))
  if (profane) return profane

  const sb = createServerClient()
  // SECURITY (audit 2026-07-02): write to the session user's own answers, not a
  // body-supplied `user_id` (was an IDOR write). Staff may target a client.
  const resolved = await resolveTargetUserId(sb, user_id ?? null)
  if ('error' in resolved) {
    return NextResponse.json({ ok: false, error: resolved.error }, { status: resolved.error === 'unauthorized' ? 401 : 403 })
  }
  const targetUserId = resolved.userId

  // Autosave fires every few seconds while typing; this cap only stops abuse.
  if (await isRateLimitedKey(targetUserId, 'survey-save', { max: 120, windowMs: 60_000 })) {
    return NextResponse.json({ ok: false, error: 'Слишком много запросов. Попробуйте через минуту.' }, { status: 429 })
  }

  // SECURITY: the company is resolved from the target user, never taken from
  // the body — a client could otherwise attach another tenant's company id.
  const { data: ownCompany } = await sb.from('companies').select('id').eq('user_id', targetUserId).maybeSingle()
  const company_id = ownCompany?.id != null ? String(ownCompany.id) : null

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
  const accepted = Object.entries(answers).filter(([k]) => isWritableSurveyKey(k))
  const ignored = Object.keys(answers).length - accepted.length
  const rows = accepted.map(([question_key, answer]) => ({
    user_id: targetUserId,
    company_id: company_id ?? null,
    step: stepForQuestionKey(question_key, null) ?? existingStep.get(question_key) ?? bodyStep,
    question_key,
    answer,
    answered_at: new Date().toISOString(),
  }))

  // An admin working in the user's cabinet (edit mode): the write is stamped
  // with the admin so history and audit show who really changed the answers.
  const { data: { user: sessionUser } } = await sb.auth.getUser()
  const imp = sessionUser?.id === targetUserId ? await activeImpersonation(sessionUser.id) : null
  const savedAt = new Date()
  const authors = new Map<string, AnswerAuthor>()

  if (rows.length) {
    if (imp) {
      const impAuthor: AnswerAuthor = { id: imp.aid, role: staffAuthorRole(imp.arole ?? 'admin') }
      for (const r of rows) authors.set(r.question_key, impAuthor)
      try {
        await adminEditSurvey(
          { id: imp.aid, kind: 'session', email: imp.alabel, role: isStaffRole(imp.arole) ? imp.arole : undefined },
          targetUserId,
          // A mark («не знаю» / «примерно») goes as is; adminEditSurvey stores the envelope.
          Object.fromEntries(accepted.map(([k, v]) => [k, fromAnswerEnvelope(v) ?? null])),
          req,
          { source: 'impersonation', impersonationSessionId: imp.sid },
        )
      } catch (e) {
        if (e instanceof SurveyEditError) return NextResponse.json({ ok: false, error: e.message }, { status: e.status })
        console.error('[onboarding/survey] admin edit failed', e instanceof Error ? e.message : e)
        return NextResponse.json({ ok: false, error: 'Не удалось сохранить ответы' }, { status: 500 })
      }
    } else {
      // Who wrote it (migration 131): the owner → «вы» (or «ИИ (из документов)»
      // for a value accepted from a document), staff → expert / admin.
      const staffRoles = sessionUser && sessionUser.id !== targetUserId ? await loadStaffRoles(sb, sessionUser.id) : []
      const groups = groupByAuthor(rows, (r) => authorFor({
        actorId: sessionUser?.id ?? targetUserId,
        ownerId: targetUserId,
        staffRoles,
        origin: origins?.[r.question_key] ?? null,
      }))
      for (const g of groups) {
        const { error } = await writeWithAttribution(
          g.rows, g.author,
          (list) => sb.from('survey_answers').upsert(list, { onConflict: 'user_id,question_key' }),
          { at: savedAt, label: 'onboarding/survey' },
        )
        if (error) return NextResponse.json({ ok: false, error: 'Failed to save answers' }, { status: 500 })
        for (const r of g.rows) authors.set(r.question_key, g.author)
      }
    }
  }

  // State after the write, computed in memory (saves a round-trip).
  const merged = new Map(beforeRows.map((r) => [r.question_key, r]))
  for (const r of rows) merged.set(r.question_key, { question_key: r.question_key, step: r.step, answer: r.answer })
  const allRows = Array.from(merged.values())
  const progress = surveyProgressFromRows(allRows)

  // A goal answer of step 1 was saved → the goal (metric_targets, companies.
  // target_revenue_*) follows it (lib/goals/survey-sync.ts, plan 2026-10-22 W1).
  // Who: the admin in edit mode / staff saving for a client → expert goal.
  if (rows.length && touchesGoalKeys(rows.map((r) => r.question_key))) {
    const actor: GoalActor = imp
      ? { id: imp.aid, role: 'admin' }
      : sessionUser && sessionUser.id !== targetUserId
        ? { id: sessionUser.id, role: 'expert' }
        : { id: targetUserId, role: 'owner' }
    const service = createServiceClient()
    await syncGoalsFromSurvey(service, {
      userId: targetUserId,
      companyId: company_id,
      answers: Object.fromEntries(accepted),
      touchedKeys: rows.map((r) => r.question_key),
      actor,
      allowClear: !autosave,
      writer: surveyWriterFor(actor, service),
    })
  }

  const announce = shouldAnnounceCompletion({
    finalSubmitted,
    isCompleteNow: progress.is_complete,
    wasCompleteBefore: wasComplete,
  })

  // Product events: first answer, explicit step saves, final submit.
  if (rows.length && !beforeRows.some((r) => isWizardVisibleKey(r.question_key))) {
    void trackEventOnce({ userId: targetUserId, name: 'QUESTIONNAIRE_STARTED', entityType: 'survey', entityId: targetUserId })
  }
  if (!autosave && rows.length) {
    void trackEvent({ userId: targetUserId, name: 'QUESTIONNAIRE_STEP_COMPLETED', entityType: 'survey', entityId: targetUserId, metadata: { step: bodyStep, keys: rows.length, progress: progress.percent }, source: imp ? 'impersonation' : 'server', impersonationSessionId: imp?.sid ?? null })
  }
  if (finalSubmitted) {
    void trackEvent({ userId: targetUserId, name: 'QUESTIONNAIRE_COMPLETED', entityType: 'survey', entityId: targetUserId, metadata: { completed_steps: progress.completed, is_complete: progress.is_complete }, source: imp ? 'impersonation' : 'server', impersonationSessionId: imp?.sid ?? null })
  }

  // Platform events drive the diagnostic pipeline (diagnostic_orchestrator):
  // ONBOARDING_COMPLETED when the questionnaire has just become complete (once
  // per company — dedupe key), QUESTIONNAIRE_COMPLETED for any other explicit
  // submit (an update). The choice follows the completion transition, not
  // `announce` (which is true on every final submit, so later submits were
  // dropped as duplicates of the one-time event and never re-ran the pipeline).
  // The actor is who made the change: the admin in edit mode, staff saving for
  // a client, otherwise the client.
  const justCompleted = progress.is_complete && !wasComplete
  // Any explicit save of answers (not a keystroke autosave) changes the data
  // Point A is built from (spec 2026-10-12 §1.6); one event per minute. A
  // submit already announces the change below (ONBOARDING_ / QUESTIONNAIRE_COMPLETED).
  if (company_id && !autosave && rows.length && !justCompleted && !finalSubmitted) {
    const actorId = imp?.aid ?? sessionUser?.id ?? targetUserId
    emitPlatformEventSafely({
      name: 'SURVEY_ANSWER_CHANGED', companyId: company_id, subjectType: 'survey', subjectId: targetUserId,
      actor: actorId.includes(':') ? actorId : `user:${actorId}`,
      payload: { step: bodyStep, keys: rows.slice(0, 50).map((r) => r.question_key) },
      dedupeKey: `survey_changed:${company_id}:${new Date().toISOString().slice(0, 16)}`,
    })
  }
  if (company_id && (justCompleted || finalSubmitted)) {
    const payload = { completed_steps: progress.completed, total_steps: progress.total_steps, is_complete: progress.is_complete }
    const actorId = imp?.aid ?? sessionUser?.id ?? targetUserId
    const actor = actorId.includes(':') ? actorId : `user:${actorId}`
    emitPlatformEventSafely(justCompleted
      ? { name: 'ONBOARDING_COMPLETED', companyId: company_id, subjectType: 'survey', subjectId: targetUserId, actor, payload, dedupeKey: `onboarding_completed:${company_id}` }
      : { name: 'QUESTIONNAIRE_COMPLETED', companyId: company_id, subjectType: 'survey', subjectId: targetUserId, actor, payload, dedupeKey: `questionnaire_completed:${company_id}:${new Date().toISOString().slice(0, 16)}` })
  }

  // Autosaves skip the Sheets mirror: one mirror per explicit save is enough,
  // and a half-typed value should not flicker through the staff spreadsheet.
  if (!autosave) runInBackground('survey-mirror', () => mirrorAndAnnounce(targetUserId, announce, bodyStep))

  return NextResponse.json({
    ok: true,
    data: {
      saved: rows.length,
      ignored,
      completed_steps: progress.completed,
      total_steps: progress.total_steps,
      percent: progress.percent,
      is_complete: progress.is_complete,
      // The author line of the saved fields (the client shows it at once).
      attribution: Object.fromEntries(Array.from(authors, ([key, a]) => [key, savedAttribution(a, savedAt)])),
    },
  })
}

function savedAttribution(a: AnswerAuthor, at: Date): AnswerAttribution {
  const cols = attributionColumns(a, at)
  return { updatedBy: cols.updated_by, updatedByRole: cols.updated_by_role, updatedAt: cols.updated_at, updatedByName: null }
}

// ─── background: Google Sheets mirror + completion alert ─────────────────────

async function mirrorAndAnnounce(userId: string, announce: boolean, step: number): Promise<void> {
  const service = createServiceClient()
  // Re-read the latest answers so a slow background run never mirrors a stale snapshot.
  const [{ data: rowsData }, { data: profile }] = await Promise.all([
    service.from('survey_answers').select('question_key, step, answer').eq('user_id', userId),
    service.from('profiles').select('email, full_name').eq('id', userId).maybeSingle(),
  ])
  const rows = ((rowsData ?? []) as SurveyStepRow[]).filter((r) => isWizardVisibleKey(r.question_key))
  const progress = surveyProgressFromRows(rows)

  // Sheet email = the CLIENT's email (profile), never the session user's —
  // staff saving on behalf of a client used to put their own email there.
  const person = profile as { email?: string | null; full_name?: string | null } | null
  const sheet = await syncSurveyToGoogleSheet(rows, {
    userId,
    email: person?.email ?? null,
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

  // Письмо самому клиенту: «анкета пройдена» — через notifyClient, с учётом
  // настроек категории «gri». Идемпотентность — ключ questionnaire_completed:<userId>.
  if (person?.email) {
    await notifyQuestionnaireCompleted(userId, {
      name: person.full_name ?? null,
      company: summary.company || null,
      completedSteps: progress.completed,
      totalSteps: progress.total_steps,
      completedAt: new Date(),
    })
  }

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
