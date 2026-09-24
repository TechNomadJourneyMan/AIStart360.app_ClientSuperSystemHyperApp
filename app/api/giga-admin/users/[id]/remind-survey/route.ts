export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireGiga } from '@/lib/admin/giga-actor'
import { recordAdminAction } from '@/lib/admin/audit'
import { createServiceClient } from '@/lib/supabase-service'
import { isRateLimitedKey } from '@/lib/rate-limit'
import { sendSurveyReminderEmail } from '@/lib/email'
import { buildUserProfileSummary } from '@/lib/user-dashboard/summary'
import { isWizardVisibleKey, SURVEY_TOTAL_STEPS } from '@/lib/survey/steps'
import { guardClientAccess } from '@/lib/admin/client-scope'

/**
 * POST /api/giga-admin/users/:id/remind-survey { note? } — письмо «допройдите
 * анкету» с перечнем незаполненных разделов.
 *
 * Зачем: две трети зарегистрировавшихся не доходят до конца анкеты, а без неё
 * диагностика считается по пустым данным. Раньше единственным способом что-то
 * с этим сделать был личный обзвон.
 *
 * Разделы в письме берём из того же `buildUserProfileSummary`, что и карточка,
 * — иначе сотрудник видел бы одно, а клиент в письме другое.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const bodySchema = z.object({ note: z.string().trim().max(300).optional() })

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const guard = await requireGiga(req, ['users.invite', 'users.sensitive'])
  if (guard.response) return guard.response
  const scopeDenied = await guardClientAccess(guard.actor, params.id)
  if (scopeDenied) return scopeDenied
  if (!UUID_RE.test(params.id)) return NextResponse.json({ ok: false, error: 'invalid id' }, { status: 400 })

  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ ok: false, error: 'Слишком длинное сообщение' }, { status: 400 })

  // Не чаще раза в сутки на человека: напоминание, приходящее каждый час,
  // перестаёт быть напоминанием.
  if (await isRateLimitedKey(params.id, 'survey-reminder', { max: 1, windowMs: 24 * 60 * 60_000 })) {
    return NextResponse.json({ ok: false, error: 'Этому клиенту уже напоминали за последние сутки' }, { status: 429 })
  }

  const sb = createServiceClient()
  const [{ data: profile }, { data: answerRows }, { data: company }] = await Promise.all([
    sb.from('profiles').select('email, full_name').eq('id', params.id).maybeSingle(),
    sb.from('survey_answers').select('question_key, answer').eq('user_id', params.id),
    sb.from('companies').select('name').eq('user_id', params.id).maybeSingle(),
  ])
  const person = profile as { email?: string | null; full_name?: string | null } | null
  if (!person?.email) return NextResponse.json({ ok: false, error: 'У клиента нет email' }, { status: 409 })

  const answers: Record<string, unknown> = {}
  for (const r of (answerRows ?? []) as Array<{ question_key: string; answer: { value?: unknown } | null }>) {
    if (!isWizardVisibleKey(r.question_key)) continue
    answers[r.question_key] = r.answer?.value
  }
  const summary = buildUserProfileSummary(answers)
  if (summary.startedSteps >= summary.totalSteps) {
    return NextResponse.json({ ok: false, error: 'Анкета уже заполнена полностью' }, { status: 409 })
  }
  const missingSections = summary.sections.filter((s) => s.filled === 0).map((s) => s.title)

  const sent = await sendSurveyReminderEmail(person.email, {
    userId: params.id,
    name: person.full_name ?? null,
    company: (company as { name?: string | null } | null)?.name ?? null,
    completedSteps: summary.startedSteps,
    totalSteps: summary.totalSteps || SURVEY_TOTAL_STEPS,
    missingSections,
    fromLabel: guard.actor.email ?? null,
    note: parsed.data.note ?? null,
  })
  if (!sent.ok) return NextResponse.json({ ok: false, error: sent.error ?? 'Письмо не отправилось' }, { status: 502 })

  await recordAdminAction(guard.actor, {
    action: 'user.survey_reminded',
    entityType: 'user',
    entityId: params.id,
    targetUserId: params.id,
    metadata: { completedSteps: summary.startedSteps, missingSections, note: parsed.data.note ?? null },
  }, req)

  return NextResponse.json({ ok: true, data: { completedSteps: summary.startedSteps, missingSections } })
}
