export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireGiga, staffRoleOfUser } from '@/lib/admin/giga-actor'
import { createServiceClient } from '@/lib/supabase-service'
import { canManageTarget } from '@/lib/admin/rbac'
import { adminEditSurvey, SurveyEditError } from '@/lib/admin/survey-admin'
import { isWizardVisibleKey } from '@/lib/survey/steps'
import { buildUserProfileSummary } from '@/lib/user-dashboard/summary'
import { guardClientAccess } from '@/lib/admin/client-scope'

// GET   /api/giga-admin/users/:id/survey?historyPage=1 — all answers grouped by
//       theme + change history (who / when / old → new).
// PATCH /api/giga-admin/users/:id/survey { changes: {key: value|null}, reason }
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const HISTORY_PAGE = 30

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const guard = await requireGiga(req, ['survey.view', 'users.sensitive'])
  if (guard.response) return guard.response
  const scopeDenied = await guardClientAccess(guard.actor, params.id)
  if (scopeDenied) return scopeDenied
  if (!UUID_RE.test(params.id)) return NextResponse.json({ ok: false, error: 'invalid id' }, { status: 400 })
  const page = Math.max(1, Number(req.nextUrl.searchParams.get('historyPage')) || 1)
  const key = req.nextUrl.searchParams.get('key')

  const sb = createServiceClient()
  let hq = sb
    .from('survey_answer_history')
    .select('id, question_key, operation, old_value, new_value, changed_by, source, impersonation_session_id, created_at, updated_at, revisions', { count: 'exact' })
    .eq('user_id', params.id)
    .order('updated_at', { ascending: false })
    .range((page - 1) * HISTORY_PAGE, page * HISTORY_PAGE - 1)
  if (key && /^[a-z0-9_]{2,80}$/.test(key)) hq = hq.eq('question_key', key)
  const [answersRes, historyRes] = await Promise.all([
    sb.from('survey_answers').select('question_key, answer, answered_at, step').eq('user_id', params.id),
    hq,
  ])
  if (answersRes.error) return NextResponse.json({ ok: false, error: 'Не удалось загрузить анкету' }, { status: 500 })

  const answers: Record<string, unknown> = {}
  const answeredAt: Record<string, string> = {}
  for (const r of answersRes.data ?? []) {
    if (!isWizardVisibleKey(String(r.question_key))) continue
    answers[r.question_key] = (r.answer as { value?: unknown } | null)?.value
    if (r.answered_at) answeredAt[r.question_key] = String(r.answered_at)
  }
  const summary = buildUserProfileSummary(answers)

  // Resolve who changed what: people ids → emails.
  const history = historyRes.data ?? []
  const actorIds = Array.from(new Set(history.map((h) => h.changed_by).filter((v): v is string => !!v && UUID_RE.test(v))))
  const { data: people } = actorIds.length
    ? await sb.from('profiles').select('id, email, full_name').in('id', actorIds)
    : { data: [] as Array<{ id: string; email: string; full_name: string | null }> }
  const who = new Map((people ?? []).map((p) => [p.id, p.full_name || p.email]))

  return NextResponse.json({
    ok: true,
    data: {
      raw: answers,
      answeredAt,
      sections: summary.sections,
      fill: summary.fill,
      percent: summary.percent,
      history: history.map((h) => ({
        ...h,
        old_value: (h.old_value as { value?: unknown } | null)?.value ?? null,
        new_value: (h.new_value as { value?: unknown } | null)?.value ?? null,
        actor_label: h.changed_by ? who.get(h.changed_by) ?? h.changed_by : null,
      })),
      historyTotal: historyRes.count ?? 0,
      historyPage: page,
      historyPageSize: HISTORY_PAGE,
    },
  })
}

const patchSchema = z.object({
  changes: z.record(z.string().regex(/^[a-z][a-z0-9_]{1,79}$/), z.unknown()),
  reason: z.string().trim().max(300).optional(),
})

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const guard = await requireGiga(req, ['survey.edit', 'users.sensitive'])
  if (guard.response) return guard.response
  const scopeDenied = await guardClientAccess(guard.actor, params.id)
  if (scopeDenied) return scopeDenied
  if (!UUID_RE.test(params.id)) return NextResponse.json({ ok: false, error: 'invalid id' }, { status: 400 })
  const parsed = patchSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ ok: false, error: 'Неверный формат изменений' }, { status: 400 })

  const target = await staffRoleOfUser(params.id)
  if (!target.profileRole) return NextResponse.json({ ok: false, error: 'Пользователь не найден' }, { status: 404 })
  if (!canManageTarget(guard.actor.role, target.staffRole)) {
    return NextResponse.json({ ok: false, error: 'Недостаточно прав для этого пользователя' }, { status: 403 })
  }
  try {
    const result = await adminEditSurvey(guard.actor, params.id, parsed.data.changes, req, { reason: parsed.data.reason })
    return NextResponse.json({ ok: true, data: result })
  } catch (e) {
    if (e instanceof SurveyEditError) return NextResponse.json({ ok: false, error: e.message }, { status: e.status })
    const msg = e instanceof Error ? e.message : 'Ошибка сохранения'
    return NextResponse.json({ ok: false, error: msg }, { status: msg.startsWith('Audit') ? 503 : 500 })
  }
}

// DELETE /api/giga-admin/users/:id/survey { reason, confirm: 'УДАЛИТЬ' } — remove
// every questionnaire answer of the user. The full snapshot goes to the
// append-only audit first; the history trigger records each removed answer.
export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const guard = await requireGiga(req, ['survey.delete', 'users.sensitive'])
  if (guard.response) return guard.response
  const scopeDenied = await guardClientAccess(guard.actor, params.id)
  if (scopeDenied) return scopeDenied
  if (!UUID_RE.test(params.id)) return NextResponse.json({ ok: false, error: 'invalid id' }, { status: 400 })
  const body = (await req.json().catch(() => null)) as { reason?: unknown; confirm?: unknown } | null
  const reason = typeof body?.reason === 'string' ? body.reason.trim() : ''
  if (reason.length < 3) return NextResponse.json({ ok: false, error: 'Укажите причину удаления' }, { status: 400 })
  if (body?.confirm !== 'УДАЛИТЬ') return NextResponse.json({ ok: false, error: 'Нужно подтверждение «УДАЛИТЬ»' }, { status: 400 })

  const target = await staffRoleOfUser(params.id)
  if (!target.profileRole) return NextResponse.json({ ok: false, error: 'Пользователь не найден' }, { status: 404 })
  if (!canManageTarget(guard.actor.role, target.staffRole)) {
    return NextResponse.json({ ok: false, error: 'Недостаточно прав для этого пользователя' }, { status: 403 })
  }
  const { data: rows, error } = await createServiceClient().from('survey_answers').select('question_key, answer').eq('user_id', params.id)
  if (error) return NextResponse.json({ ok: false, error: 'Не удалось прочитать анкету' }, { status: 500 })
  const changes = Object.fromEntries((rows ?? []).filter((r) => isWizardVisibleKey(String(r.question_key))).map((r) => [String(r.question_key), null]))
  if (!Object.keys(changes).length) return NextResponse.json({ ok: true, data: { deleted: 0 } })
  try {
    const result = await adminEditSurvey(guard.actor, params.id, changes, req, { reason: `Удаление всей анкеты: ${reason}` })
    return NextResponse.json({ ok: true, data: result })
  } catch (e) {
    if (e instanceof SurveyEditError) return NextResponse.json({ ok: false, error: e.message }, { status: e.status })
    return NextResponse.json({ ok: false, error: 'Не удалось удалить анкету' }, { status: 500 })
  }
}
