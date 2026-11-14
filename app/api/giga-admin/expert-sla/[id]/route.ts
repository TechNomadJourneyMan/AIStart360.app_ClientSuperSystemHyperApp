export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireGiga } from '@/lib/admin/giga-actor'
import { recordAdminAction } from '@/lib/admin/audit'
import { actorClientScope } from '@/lib/admin/actor-scope'
import { setClientAssignment } from '@/lib/admin/client-actions'
import { createServiceClient } from '@/lib/supabase-service'
import { createDefaultNotifier } from '@/lib/expert-sla/notify'
import { TASK_COLUMNS } from '@/lib/expert-sla/policy'
import { reassignClientWork, visibleTo, type SlaTaskRow } from '@/lib/expert-sla/store'

/**
 * PATCH /api/giga-admin/expert-sla/:id { assigneeId }
 *
 * Ручное переназначение (R2-B): Super Admin, Admin, SuperExpert передают работу
 * по клиенту эксперту (или берут себе). Исполнитель становится ответственным
 * клиента — все его открытые задачи и обращения переходят к нему. Скоуп:
 * переназначить можно только задачу, которую актор видит. Журнал — каждое
 * изменение; новый исполнитель получает уведомление.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const bodySchema = z.object({ assigneeId: z.string().uuid() })

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const guard = await requireGiga(req, ['clients.review', 'users.sensitive'])
  if (guard.response) return guard.response
  const actor = guard.actor
  if (!UUID_RE.test(params.id)) return NextResponse.json({ ok: false, error: 'invalid id' }, { status: 400 })
  const parsed = bodySchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ ok: false, error: 'Выберите исполнителя' }, { status: 400 })
  const { assigneeId } = parsed.data

  const sb = createServiceClient()
  const { data: found, error } = await sb.from('expert_sla_tasks').select(TASK_COLUMNS).eq('id', params.id).maybeSingle()
  if (error) return NextResponse.json({ ok: false, error: 'Очередь недоступна — применена ли миграция 145?' }, { status: 503 })
  const task = found as SlaTaskRow | null
  if (!task) return NextResponse.json({ ok: false, error: 'Задача не найдена' }, { status: 404 })
  const scope = await actorClientScope(actor)
  if (!visibleTo(scope.scope === 'all' ? { all: true } : { actorId: actor.id, clientIds: scope.clientIds }, task)) {
    return NextResponse.json({ ok: false, error: 'Этот клиент вам не назначен' }, { status: 403 })
  }

  const res = await reassignClientWork(sb, {
    taskId: task.id,
    assigneeId,
    assignClient: async (clientId, to) => {
      const r = await setClientAssignment({
        userId: clientId, assigneeId: to, actorId: actor.id,
        audit: (entry, opts) => recordAdminAction(actor, entry, req, opts),
      })
      return r.ok ? { ok: true } : { ok: false, status: r.status, error: r.error }
    },
  })
  if (!res.ok) return NextResponse.json({ ok: false, error: res.error }, { status: res.status })

  await recordAdminAction(actor, {
    action: 'expert_sla.reassigned',
    entityType: 'expert_sla_task',
    entityId: task.id,
    targetUserId: task.client_id,
    oldValue: { assignee_id: res.previous },
    newValue: { assignee_id: assigneeId },
    metadata: { source: task.source, title: task.title, moved: res.moved },
  }, req)

  if (assigneeId !== actor.id) await createDefaultNotifier({ sb }).assigned({ ...task, assignee_id: assigneeId })
  return NextResponse.json({ ok: true, moved: res.moved })
}
