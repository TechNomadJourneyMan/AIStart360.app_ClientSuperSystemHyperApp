export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createServiceClient } from '@/lib/supabase-service'
import { requireGiga } from '@/lib/admin/giga-actor'
import { recordAdminAction } from '@/lib/admin/audit'
import { isMissingTable, migrationMissingResponse, MODERATION_EVENT_STATUSES, UUID_RE } from '@/lib/moderation/admin'

/**
 * PATCH /api/giga-admin/content-filter/events/:id { status }
 *
 * Разбор записи журнала: «Проверено» (reviewed), «Ложное срабатывание»
 * (false_positive) или вернуть в открытые (open). Право moderation.content,
 * действие пишется в журнал администратора.
 */
const bodySchema = z.object({
  status: z.enum(MODERATION_EVENT_STATUSES),
})

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const guard = await requireGiga(req, 'moderation.content')
  if (guard.response) return guard.response
  const actor = guard.actor

  if (!UUID_RE.test(params.id)) return NextResponse.json({ ok: false, error: 'Запись не найдена' }, { status: 404 })
  const parsed = bodySchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ ok: false, error: 'Неверный статус' }, { status: 400 })
  const { status } = parsed.data

  const sb = createServiceClient()
  const { data: before, error: readErr } = await sb
    .from('content_moderation_events')
    .select('id, status, user_id, source, field')
    .eq('id', params.id)
    .maybeSingle()
  if (readErr) {
    if (isMissingTable(readErr)) return migrationMissingResponse()
    return NextResponse.json({ ok: false, error: 'Не удалось загрузить запись' }, { status: 500 })
  }
  if (!before) return NextResponse.json({ ok: false, error: 'Запись не найдена' }, { status: 404 })

  const reviewed = status !== 'open'
  const { data: updated, error } = await sb
    .from('content_moderation_events')
    .update({
      status,
      reviewed_by: reviewed && UUID_RE.test(actor.id) ? actor.id : null,
      reviewed_at: reviewed ? new Date().toISOString() : null,
    })
    .eq('id', params.id)
    .select('id, status, reviewed_by, reviewed_at')
  if (error || !updated?.length) {
    console.error('[giga-admin/content-filter] event update failed:', error?.message ?? 'no row')
    return NextResponse.json({ ok: false, error: 'Не удалось обновить запись' }, { status: 500 })
  }

  await recordAdminAction(actor, {
    action: 'moderation.event_reviewed',
    entityType: 'content_moderation_event',
    entityId: params.id,
    targetUserId: before.user_id ?? null,
    oldValue: { status: before.status },
    newValue: { status },
    metadata: { source: before.source, field: before.field },
  }, req)

  return NextResponse.json({ ok: true, data: updated[0] })
}
