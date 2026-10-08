export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireGiga } from '@/lib/admin/giga-actor'
import { recordAdminAction } from '@/lib/admin/audit'
import { sendSurveyReminder } from '@/lib/admin/client-actions'
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
 * — иначе сотрудник видел бы одно, а клиент в письме другое. Логика —
 * lib/admin/client-actions.ts (её же вызывает ассистент админ-бота).
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

  const res = await sendSurveyReminder({
    userId: params.id,
    note: parsed.data.note ?? null,
    fromLabel: guard.actor.email ?? null,
    audit: (entry, opts) => recordAdminAction(guard.actor, entry, req, opts),
  })
  if (!res.ok) return NextResponse.json({ ok: false, error: res.error }, { status: res.status })

  return NextResponse.json({ ok: true, data: { completedSteps: res.completedSteps, missingSections: res.missingSections } })
}
