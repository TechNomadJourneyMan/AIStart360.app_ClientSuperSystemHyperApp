export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireGiga } from '@/lib/admin/giga-actor'
import { recordAdminAction } from '@/lib/admin/audit'
import { createServiceClient } from '@/lib/supabase-service'
import { NOT_ASSIGNED_ERROR, canAccessClient } from '@/lib/admin/client-scope'

/**
 * PATCH /api/giga-admin/tasks/:taskId { status?, title?, dueAt?, assigneeId? }
 *
 * Отдельный маршрут, а не вложенный в пользователя: задачу закрывают из общего
 * списка «Мои задачи», где клиент рядом не нужен.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const patchSchema = z.object({
  status: z.enum(['open', 'done', 'cancelled']).optional(),
  title: z.string().trim().min(1).max(300).optional(),
  dueAt: z.string().datetime().nullable().optional(),
  assigneeId: z.string().uuid().nullable().optional(),
})

export async function PATCH(req: NextRequest, { params }: { params: { taskId: string } }) {
  const guard = await requireGiga(req, ['users.view', 'users.sensitive'])
  if (guard.response) return guard.response
  if (!UUID_RE.test(params.taskId)) return NextResponse.json({ ok: false, error: 'invalid id' }, { status: 400 })

  const parsed = patchSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success || !Object.keys(parsed.data).length) {
    return NextResponse.json({ ok: false, error: 'Нечего изменять' }, { status: 400 })
  }

  // Эксперт со scope 'assigned' правит задачи своих клиентов и задачи,
  // назначенные ему самому.
  if (guard.actor.clientScope === 'assigned') {
    const { data: task } = await createServiceClient().from('staff_tasks').select('user_id, assignee_id').eq('id', params.taskId).maybeSingle()
    const t = task as { user_id: string | null; assignee_id: string | null } | null
    if (!t) return NextResponse.json({ ok: false, error: 'Задача не найдена' }, { status: 404 })
    if (t.assignee_id !== guard.actor.id && !(t.user_id && (await canAccessClient(guard.actor, t.user_id)))) {
      return NextResponse.json({ ok: false, error: NOT_ASSIGNED_ERROR }, { status: 403 })
    }
  }

  const now = new Date().toISOString()
  const patch: Record<string, unknown> = { updated_at: now }
  if (parsed.data.status) {
    patch.status = parsed.data.status
    patch.done_at = parsed.data.status === 'done' ? now : null
  }
  if (parsed.data.title !== undefined) patch.title = parsed.data.title
  if (parsed.data.dueAt !== undefined) patch.due_at = parsed.data.dueAt
  if (parsed.data.assigneeId !== undefined) patch.assignee_id = parsed.data.assigneeId

  const sb = createServiceClient()
  const { data: before } = await sb
    .from('staff_tasks')
    .select('user_id, title, due_at, status, assignee_id')
    .eq('id', params.taskId)
    .maybeSingle()

  const { data, error } = await sb
    .from('staff_tasks')
    .update(patch)
    .eq('id', params.taskId)
    .select('id, user_id, title, due_at, status, assignee_id, created_by, created_at, done_at')
    .maybeSingle()
  if (error) return NextResponse.json({ ok: false, error: 'Не удалось изменить задачу' }, { status: 500 })
  if (!data) return NextResponse.json({ ok: false, error: 'Задача не найдена' }, { status: 404 })

  const row = data as { user_id: string | null }
  const prev = (before ?? {}) as Record<string, unknown>
  const changed = Object.keys(patch).filter((k) => k !== 'updated_at' && k !== 'done_at')
  await recordAdminAction(guard.actor, {
    action: parsed.data.status === 'done' ? 'user.task_done' : 'user.task_updated',
    entityType: 'task',
    entityId: params.taskId,
    targetUserId: row.user_id,
    oldValue: Object.fromEntries(changed.map((k) => [k, prev[k] ?? null])),
    newValue: Object.fromEntries(changed.map((k) => [k, patch[k] ?? null])),
  }, req)

  return NextResponse.json({ ok: true, data })
}
