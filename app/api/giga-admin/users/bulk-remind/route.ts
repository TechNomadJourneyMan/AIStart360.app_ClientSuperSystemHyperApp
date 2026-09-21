export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireGiga } from '@/lib/admin/giga-actor'
import { recordAdminAction } from '@/lib/admin/audit'
import { createServiceClient } from '@/lib/supabase-service'
import { isRateLimitedKey } from '@/lib/rate-limit'
import { sendSurveyReminderEmail } from '@/lib/email'
import { buildUserProfileSummary } from '@/lib/user-dashboard/summary'
import { isWizardVisibleKey } from '@/lib/survey/steps'

/**
 * POST /api/giga-admin/users/bulk-remind { userIds[], note? }
 *
 * Напоминание группе: вручную никто не будет открывать тридцать карточек.
 * Ограничения те же, что у одиночного напоминания — не чаще раза в сутки на
 * человека, — плюс потолок на пачку и на сотрудника в час, чтобы случайный
 * «выделить всех» не превратился в рассылку по базе.
 *
 * Тем, у кого анкета уже заполнена или нет адреса, письмо не уходит: они
 * возвращаются в отчёте с причиной, а не молча пропускаются.
 */

const MAX_BATCH = 50

const bodySchema = z.object({
  userIds: z.array(z.string().uuid()).min(1).max(MAX_BATCH),
  note: z.string().trim().max(300).optional(),
})

type Outcome = 'sent' | 'skipped' | 'failed'
interface Result { userId: string; outcome: Outcome; message: string }

export async function POST(req: NextRequest) {
  const guard = await requireGiga(req, ['users.invite', 'users.sensitive'])
  if (guard.response) return guard.response

  const parsed = bodySchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: `Выберите от 1 до ${MAX_BATCH} клиентов` }, { status: 422 })
  }
  if (await isRateLimitedKey(guard.actor.id, 'bulk-remind', { max: 200, windowMs: 60 * 60_000 })) {
    return NextResponse.json({ ok: false, error: 'Слишком много напоминаний за час. Попробуйте позже.' }, { status: 429 })
  }

  const sb = createServiceClient()
  const ids = Array.from(new Set(parsed.data.userIds))
  const [{ data: profiles }, { data: companies }, { data: answers }] = await Promise.all([
    sb.from('profiles').select('id, email, full_name').in('id', ids),
    sb.from('companies').select('user_id, name').in('user_id', ids),
    sb.from('survey_answers').select('user_id, question_key, answer').in('user_id', ids),
  ])

  const companyByUser = new Map<string, string | null>()
  for (const c of (companies ?? []) as Array<{ user_id: string; name: string | null }>) companyByUser.set(c.user_id, c.name)

  const answersByUser = new Map<string, Record<string, unknown>>()
  for (const a of (answers ?? []) as Array<{ user_id: string; question_key: string; answer: { value?: unknown } | null }>) {
    if (!isWizardVisibleKey(a.question_key)) continue
    const bag = answersByUser.get(a.user_id) ?? {}
    bag[a.question_key] = a.answer?.value
    answersByUser.set(a.user_id, bag)
  }

  const results: Result[] = []
  for (const p of (profiles ?? []) as Array<{ id: string; email: string | null; full_name: string | null }>) {
    if (!p.email) {
      results.push({ userId: p.id, outcome: 'skipped', message: 'нет email' })
      continue
    }
    const summary = buildUserProfileSummary(answersByUser.get(p.id) ?? {})
    if (summary.startedSteps >= summary.totalSteps) {
      results.push({ userId: p.id, outcome: 'skipped', message: 'анкета уже заполнена' })
      continue
    }
    if (await isRateLimitedKey(p.id, 'survey-reminder', { max: 1, windowMs: 24 * 60 * 60_000 })) {
      results.push({ userId: p.id, outcome: 'skipped', message: 'напоминали за последние сутки' })
      continue
    }
    const sent = await sendSurveyReminderEmail(p.email, {
      userId: p.id,
      name: p.full_name ?? null,
      company: companyByUser.get(p.id) ?? null,
      completedSteps: summary.startedSteps,
      totalSteps: summary.totalSteps,
      missingSections: summary.sections.filter((s) => s.filled === 0).map((s) => s.title),
      fromLabel: guard.actor.email ?? null,
      note: parsed.data.note ?? null,
    })
    results.push(sent.ok
      ? { userId: p.id, outcome: 'sent', message: 'отправлено' }
      : { userId: p.id, outcome: 'failed', message: sent.error ?? 'письмо не отправилось' })
  }

  const missing = ids.filter((id) => !results.some((r) => r.userId === id))
  for (const id of missing) results.push({ userId: id, outcome: 'skipped', message: 'пользователь не найден' })

  const sent = results.filter((r) => r.outcome === 'sent').length
  await recordAdminAction(guard.actor, {
    action: 'user.survey_reminded_bulk',
    entityType: 'user',
    entityId: `batch:${ids.length}`,
    metadata: { requested: ids.length, sent, note: parsed.data.note ?? null },
  }, req)

  return NextResponse.json({ ok: true, sent, total: ids.length, results })
}
