export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireGiga } from '@/lib/admin/giga-actor'
import { recordAdminAction } from '@/lib/admin/audit'
import { actorClientScope, scopeAllows } from '@/lib/admin/actor-scope'
import { setClientAssignment } from '@/lib/admin/client-actions'
import { createServiceClient } from '@/lib/supabase-service'
import { TASK_COLUMNS, isPlanSource } from '@/lib/expert-sla/policy'
import { reassignClientWork, takePlanTask, type SlaTaskRow } from '@/lib/expert-sla/store'

/**
 * PATCH /api/giga-admin/expert-sla/:id { assigneeId }
 *
 * Ручное переназначение (R2-B): Super Admin, Admin, SuperExpert передают работу
 * по клиенту эксперту (или берут себе). Исполнитель становится ответственным
 * клиента — все его открытые задачи и обращения переходят к нему.
 * Скоуп (п. 1 ревью): клиент задачи должен быть в скоупе актора — то же
 * правило, что у штатного назначения ответственного (guardClientAccess /
 * scopeAllows). Быть исполнителем задачи недостаточно: SuperExpert «только
 * назначенные» не вернёт себе клиента, которого у него забрали.
 * Журнал — каждое изменение; новый исполнитель получает уведомление через
 * outbox прохода SLA (assign_notified_at сброшен, ≤ 5 минут).
 *
 * План Точки Б (plan_prep / plan_review, миграция 152): «Взять себе» —
 * исполнителем задачи становится Admin / Super Admin (решение PO: планы
 * готовят и одобряют они); ответственный клиента не меняется. Передать можно
 * только Admin / Super Admin; эксперту — нельзя.
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
  if (!scopeAllows(scope, task.client_id)) {
    return NextResponse.json({ ok: false, error: 'Этот клиент вам не назначен' }, { status: 403 })
  }

  if (isPlanSource(task.source)) {
    const taken = await takePlanTask(sb, { taskId: task.id, assigneeId, actorId: actor.id })
    if (!taken.ok) return NextResponse.json({ ok: false, error: taken.error }, { status: taken.status })
    await recordAdminAction(actor, {
      action: 'expert_sla.taken',
      entityType: 'expert_sla_task',
      entityId: task.id,
      targetUserId: task.client_id,
      oldValue: { assignee_id: taken.previous },
      newValue: { assignee_id: assigneeId },
      metadata: { source: task.source, title: task.title, self: assigneeId === actor.id },
    }, req)
    return NextResponse.json({ ok: true, moved: taken.moved })
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

  return NextResponse.json({ ok: true, moved: res.moved })
}
