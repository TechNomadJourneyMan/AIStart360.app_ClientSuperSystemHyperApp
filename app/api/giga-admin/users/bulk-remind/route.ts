export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireGiga } from '@/lib/admin/giga-actor'
import { recordAdminAction } from '@/lib/admin/audit'
import { isRateLimitedKey } from '@/lib/rate-limit'
import { remindSurveyBatch } from '@/lib/admin/survey-reminders'

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

  const ids = Array.from(new Set(parsed.data.userIds))
  const results = await remindSurveyBatch(ids, { fromLabel: guard.actor.email ?? null, note: parsed.data.note ?? null })

  const sent = results.filter((r) => r.outcome === 'sent').length
  await recordAdminAction(guard.actor, {
    action: 'user.survey_reminded_bulk',
    entityType: 'user',
    entityId: `batch:${ids.length}`,
    metadata: { requested: ids.length, sent, note: parsed.data.note ?? null },
  }, req)

  return NextResponse.json({ ok: true, sent, total: ids.length, results })
}
