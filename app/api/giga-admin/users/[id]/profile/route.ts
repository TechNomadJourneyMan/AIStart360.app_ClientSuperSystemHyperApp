export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { forbidTarget, requireGiga, staffRoleOfUser } from '@/lib/admin/giga-actor'
import { createServiceClient } from '@/lib/supabase-service'
import { isWizardVisibleKey } from '@/lib/survey/steps'
import { buildUserProfileSummary } from '@/lib/user-dashboard/summary'
import { buildJourney } from '@/lib/admin/journey'
import { canImpersonate, canManageTarget, hasPermission } from '@/lib/admin/rbac'
import { maskEmail, maskPhone } from '@/lib/admin/mask'
import { isSurveyCompleted, loadSurveyCompletionMarkers, surveyCompletedAt } from '@/lib/survey/completion'
import { guardClientAccess } from '@/lib/admin/client-scope'
import { recordAdminAction } from '@/lib/admin/audit'
import { moderateFields } from '@/lib/moderation/guard'
import { isRateLimitedKey } from '@/lib/rate-limit'

// GET /api/giga-admin/users/:id/profile — User 360 header data: identity,
// status, survey summary, Точка А, GRI, journey (CJM), counters, and what the
// current staff member may do with this person.
// PATCH /api/giga-admin/users/:id/profile { full_name, reason? } — rename (see below).
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

async function markClientViewed(sb: ReturnType<typeof createServiceClient>, staffId: string, userId: string): Promise<void> {
  if (!UUID_RE.test(staffId) || staffId === userId) return
  try {
    const { error } = await sb
      .from('staff_client_views')
      .upsert({ staff_id: staffId, user_id: userId, last_viewed_at: new Date().toISOString() }, { onConflict: 'staff_id,user_id' })
    if (error) console.warn('[giga-admin/users/profile] staff_client_views:', error.message)
  } catch (e) {
    console.warn('[giga-admin/users/profile] staff_client_views failed', e)
  }
}

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const guard = await requireGiga(req, 'users.view')
  if (guard.response) return guard.response
  const scopeDenied = await guardClientAccess(guard.actor, params.id)
  if (scopeDenied) return scopeDenied
  const userId = params.id
  if (!UUID_RE.test(userId)) return NextResponse.json({ ok: false, error: 'invalid id' }, { status: 400 })
  const role = guard.actor.role
  const sensitive = hasPermission(role, 'users.sensitive')

  const sb = createServiceClient()
  const [profileRes, companyRes, answersRes, diagRes, griRes, draftRes, docsRes, contentRes, eventsCountRes, impRes, target, testRes] = await Promise.all([
    sb.from('profiles').select('id, email, full_name, role, status, organization, position, phone, tier, feature_flags, vertical, widget_config, created_at, approved_at, last_seen_at, avatar_url').eq('id', userId).maybeSingle(),
    sb.from('companies').select('id, name, industry, business_model, employee_count, regions').eq('user_id', userId).maybeSingle(),
    sb.from('survey_answers').select('question_key, answer, answered_at').eq('user_id', userId),
    sb.from('diagnostics').select('id, overall_score, health_index, stage, calculated_at, is_current').eq('user_id', userId).order('calculated_at', { ascending: true }),
    sb.from('gri_assessments').select('id, gri_index, section_avgs, is_current, created_at').eq('user_id', userId).order('created_at', { ascending: false }).limit(20),
    sb.from('gri_assessment_drafts').select('updated_at').eq('user_id', userId).maybeSingle(),
    sb.from('documents').select('id', { count: 'exact', head: true }).eq('user_id', userId),
    sb.from('user_events').select('created_at').eq('user_id', userId).eq('event_name', 'CONTENT_VIEWED').eq('source', 'web').order('created_at', { ascending: true }).limit(1),
    sb.from('user_events').select('id', { count: 'exact', head: true }).eq('user_id', userId),
    sb.from('impersonation_sessions').select('id').eq('target_user_id', userId).is('ended_at', null).gt('expires_at', new Date().toISOString()).limit(1),
    staffRoleOfUser(userId),
    // profiles.is_test — миграция 120; пока её нет, запрос вернёт ошибку, и
    // признак просто считается false (карточка не ломается).
    sb.from('profiles').select('is_test').eq('id', userId).maybeSingle(),
  ])
  const profile = profileRes.data
  if (!profile) return NextResponse.json({ ok: false, error: 'Пользователь не найден' }, { status: 404 })

  const answers: Record<string, unknown> = {}
  let surveyFirst: string | null = null
  let surveyLast: string | null = null
  for (const r of answersRes.data ?? []) {
    if (!isWizardVisibleKey(String(r.question_key))) continue
    answers[r.question_key] = (r.answer as { value?: unknown } | null)?.value
    const at = r.answered_at ? String(r.answered_at) : null
    if (at && (!surveyFirst || at < surveyFirst)) surveyFirst = at
    if (at && (!surveyLast || at > surveyLast)) surveyLast = at
  }
  const summary = buildUserProfileSummary(answers)
  const surveyMarkers = await loadSurveyCompletionMarkers(sb, userId)
  const surveyFacts = { ...surveyMarkers, filledSteps: summary.startedSteps, lastAnswerAt: surveyLast }

  const diags = diagRes.data ?? []
  const diagIds = diags.map((d) => d.id)
  const { data: pointB } = diagIds.length
    ? await sb.from('point_b_analysis').select('calculated_at').in('diagnostic_id', diagIds).order('calculated_at', { ascending: true }).limit(1)
    : { data: [] as Array<{ calculated_at: string }> }

  const gri = griRes.data ?? []
  const griFirst = gri.length ? gri[gri.length - 1].created_at : null
  const griStarted = [griFirst, draftRes.data?.updated_at ?? null].filter(Boolean).sort()[0] ?? null
  const currentDiag = [...diags].reverse().find((d) => d.is_current) ?? diags[diags.length - 1] ?? null
  const currentGri = gri.find((g) => g.is_current) ?? gri[0] ?? null

  const journey = buildJourney({
    registered: profile.created_at,
    approved: profile.status === 'approved' ? profile.approved_at ?? profile.created_at : null,
    survey_started: surveyFirst,
    survey_completed: isSurveyCompleted(surveyFacts) ? surveyCompletedAt(surveyFacts) ?? surveyLast : null,
    point_a: diags[0]?.calculated_at ?? null,
    gri_started: griStarted,
    gri_completed: griFirst,
    point_b: pointB?.[0]?.calculated_at ?? null,
    content: contentRes.data?.[0]?.created_at ?? null,
  })

  // «Мой день» сравнивает изменения у клиента с моментом, когда сотрудник
  // последний раз открывал его карточку. Сбой записи карточку не ломает.
  await markClientViewed(sb, guard.actor.id, userId)

  return NextResponse.json({
    ok: true,
    data: {
      profile: {
        ...profile,
        email: sensitive ? profile.email : maskEmail(profile.email),
        phone: sensitive ? profile.phone : maskPhone(profile.phone),
        is_test: !testRes.error && (testRes.data as { is_test?: boolean } | null)?.is_test === true,
      },
      staffRole: target.staffRole,
      company: companyRes.data ?? null,
      survey: {
        percent: summary.percent,
        startedSteps: summary.startedSteps,
        totalSteps: summary.totalSteps,
        missingSteps: summary.missingSteps,
        startedAt: surveyFirst,
        updatedAt: surveyLast,
        hero: sensitive ? summary.hero : { ...summary.hero, contact: '' },
        sections: summary.sections.map((s) => ({ id: s.id, title: s.title, icon: s.icon, filled: s.filled, total: s.total })),
      },
      diagnostics: currentDiag ? { ...currentDiag, runs: diags.length } : null,
      gri: {
        current: currentGri ? { id: currentGri.id, index: Number(currentGri.gri_index), sectionAvgs: currentGri.section_avgs ?? {}, assessedAt: currentGri.created_at } : null,
        runs: gri.length,
        draftUpdatedAt: draftRes.data?.updated_at ?? null,
      },
      journey,
      counters: { documents: docsRes.count ?? 0, events: eventsCountRes.count ?? 0 },
      impersonationActive: (impRes.data ?? []).length > 0,
      can: {
        manage: hasPermission(role, 'users.manage') && canManageTarget(role, target.staffRole),
        archive: hasPermission(role, 'users.archive') && canManageTarget(role, target.staffRole),
        purge: hasPermission(role, 'users.delete') && userId !== guard.actor.id && target.profileRole !== 'super_admin' && target.staffRole !== 'super_admin',
        editSurvey: hasPermission(role, 'survey.edit') && canManageTarget(role, target.staffRole),
        viewSurvey: hasPermission(role, 'survey.view') && sensitive,
        editGri: hasPermission(role, 'gri.edit') && canManageTarget(role, target.staffRole),
        deleteGri: hasPermission(role, 'gri.delete') && canManageTarget(role, target.staffRole),
        impersonate: canImpersonate(role, target),
        impersonateEdit: canImpersonate(role, target) && hasPermission(role, 'impersonate.edit'),
        activity: hasPermission(role, 'activity.view'),
        audit: hasPermission(role, 'audit.view'),
        roles: hasPermission(role, 'roles.manage'),
        review: hasPermission(role, 'clients.review') && profile.role === 'client' && !target.staffRole,
        sensitive,
      },
    },
  })
}

// ── PATCH: переименование пользователя ──────────────────────────────────────

/** Имя: обрезаем края и схлопываем повторные пробелы. */
const nameSchema = z.string()
  .transform((v) => v.replace(/\s+/g, ' ').trim())
  .pipe(z.string().min(2, 'Имя — от 2 символов').max(160, 'Имя — не длиннее 160 символов'))
const renameSchema = z.object({
  full_name: nameSchema,
  reason: z.string().trim().max(300).optional(),
})

/**
 * PATCH /api/giga-admin/users/:id/profile { full_name, reason? }
 *
 * Право users.manage + область клиентов + ранг цели (равного себе или старшего
 * сотрудника переименовать нельзя). Новое имя проходит фильтр контента
 * (422 при мате/оскорблениях). Обязательная запись 'user.renamed' в журнал ДО
 * изменения; затем profiles.full_name, user_metadata.full_name в Auth (по
 * возможности) и companies.contact_name — только если там стояло старое имя.
 */
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const guard = await requireGiga(req, 'users.manage')
  if (guard.response) return guard.response
  const scopeDenied = await guardClientAccess(guard.actor, params.id)
  if (scopeDenied) return scopeDenied
  const userId = params.id
  if (!UUID_RE.test(userId)) return NextResponse.json({ ok: false, error: 'invalid id' }, { status: 400 })

  const parsed = renameSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ ok: false, error: parsed.error.issues[0]?.message ?? 'Неверный запрос' }, { status: 400 })
  const denied = await forbidTarget(guard.actor, userId)
  if (denied) return denied
  if (await isRateLimitedKey(guard.actor.id, 'user-rename', { max: 30, windowMs: 10 * 60_000 })) {
    return NextResponse.json({ ok: false, error: 'Слишком много операций. Попробуйте позже.' }, { status: 429 })
  }
  const { full_name: name, reason } = parsed.data

  const sb = createServiceClient()
  const { data: current, error: readErr } = await sb.from('profiles').select('id, full_name, email').eq('id', userId).maybeSingle()
  if (readErr) return NextResponse.json({ ok: false, error: 'Не удалось загрузить профиль' }, { status: 500 })
  if (!current) return NextResponse.json({ ok: false, error: 'Пользователь не найден' }, { status: 404 })
  const before = (current as { full_name?: string | null }).full_name ?? null
  if (before === name) return NextResponse.json({ ok: true, full_name: name, unchanged: true })

  const rejected = await moderateFields(
    { userId, email: (current as { email?: string | null }).email ?? null, source: 'admin_rename' },
    [{ field: 'full_name', label: 'Имя', value: name, kind: 'name' }],
  )
  if (rejected) return rejected

  // Журнал ДО изменения: если записать нельзя — имя не меняем.
  try {
    await recordAdminAction(guard.actor, {
      action: 'user.renamed',
      entityType: 'user', entityId: userId, targetUserId: userId,
      oldValue: { full_name: before }, newValue: { full_name: name },
      metadata: reason ? { reason } : {},
    }, req, { required: true })
  } catch {
    return NextResponse.json({ ok: false, error: 'Журнал действий недоступен — имя не изменено' }, { status: 503 })
  }

  const { data: updated, error: updErr } = await sb.from('profiles').update({ full_name: name }).eq('id', userId).select('id')
  if (updErr || !updated?.length) {
    console.error('[giga-admin/users/profile] rename failed:', updErr?.message)
    await recordAdminAction(guard.actor, {
      action: 'user.rename_failed',
      entityType: 'user', entityId: userId, targetUserId: userId,
      oldValue: { full_name: before }, newValue: { full_name: before },
      metadata: { error: (updErr?.message ?? 'profile row not updated').slice(0, 300) },
    }, req).catch(() => false)
    return NextResponse.json({ ok: false, error: 'Имя не сохранено' }, { status: 409 })
  }

  // Имя в Auth (его видят письма и сессия) — по возможности; GoTrue сливает user_metadata.
  try {
    const { error } = await sb.auth.admin.updateUserById(userId, { user_metadata: { full_name: name } })
    if (error) console.warn('[giga-admin/users/profile] auth metadata not updated:', error.message)
  } catch (e) {
    console.warn('[giga-admin/users/profile] auth metadata update failed', e)
  }
  // Контакт компании меняем, только если там было то же старое имя — чужое не затираем.
  if (before) {
    const { error } = await sb.from('companies').update({ contact_name: name }).eq('user_id', userId).eq('contact_name', before)
    if (error) console.warn('[giga-admin/users/profile] companies.contact_name not updated:', error.message)
  }

  return NextResponse.json({ ok: true, full_name: name })
}
