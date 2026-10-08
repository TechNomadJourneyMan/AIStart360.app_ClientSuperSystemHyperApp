export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireGiga } from '@/lib/admin/giga-actor'
import { recordAdminAction } from '@/lib/admin/audit'
import { createServiceClient } from '@/lib/supabase-service'
import { actorClientScope, scopeAllows } from '@/lib/admin/actor-scope'
import { CASE_PRIORITIES, CASE_STATUSES, OPEN_CASE_STATUSES, computeSlaDueAt, getSlaHours, notifyCaseAssignee, type CaseStatus } from '@/lib/admin/escalations'

/**
 * PATCH /api/giga-admin/cases/:id { status?, priority?, assigneeId? }
 *
 * Работа с эскалацией из очереди: взять в работу / решить / закрыть, сменить
 * приоритет (срок реакции пересчитывается от момента создания), назначить
 * ответственного (он получает уведомление). Каждое изменение — в журнал.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const patchSchema = z.object({
  status: z.enum(CASE_STATUSES).optional(),
  priority: z.enum(CASE_PRIORITIES).optional(),
  assigneeId: z.string().uuid().nullable().optional(),
})

interface CaseRow {
  id: string; user_id: string; status: string; priority: string; title: string; trigger_type: string | null
  user_message: string | null; assignee_id: string | null; sla_due_at: string | null; first_response_at: string | null; created_at: string
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const guard = await requireGiga(req, ['users.view', 'users.sensitive'])
  if (guard.response) return guard.response
  const actor = guard.actor
  if (!UUID_RE.test(params.id)) return NextResponse.json({ ok: false, error: 'invalid id' }, { status: 400 })

  const parsed = patchSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success || !Object.keys(parsed.data).length) {
    return NextResponse.json({ ok: false, error: 'Нечего изменять' }, { status: 400 })
  }

  const sb = createServiceClient()
  const { data: found, error: readErr } = await sb
    .from('expert_cases')
    .select('id, user_id, status, priority, title, trigger_type, user_message, assignee_id, sla_due_at, first_response_at, created_at')
    .eq('id', params.id)
    .maybeSingle()
  if (readErr) return NextResponse.json({ ok: false, error: 'Очередь недоступна — применена ли миграция 088?' }, { status: 503 })
  if (!found) return NextResponse.json({ ok: false, error: 'Кейс не найден' }, { status: 404 })
  const before = found as CaseRow

  const scope = await actorClientScope(actor)
  if (!scopeAllows(scope, before.user_id) && before.assignee_id !== actor.id) {
    return NextResponse.json({ ok: false, error: 'Этот клиент вам не назначен' }, { status: 403 })
  }

  const { status, priority, assigneeId } = parsed.data
  if (assigneeId) {
    const { data: staff } = await sb.from('staff_roles').select('user_id').eq('user_id', assigneeId).maybeSingle()
    if (!staff) return NextResponse.json({ ok: false, error: 'Ответственным может быть только сотрудник' }, { status: 400 })
  }

  const now = new Date().toISOString()
  const patch: Record<string, unknown> = { updated_at: now }
  if (status && status !== before.status) {
    patch.status = status
    // Первая реакция — когда кейс впервые ушёл из «новых».
    if (!before.first_response_at && before.status === 'new') patch.first_response_at = now
  }
  if (priority && priority !== before.priority) {
    patch.priority = priority
    const stillOpen = OPEN_CASE_STATUSES.includes(((patch.status as CaseStatus | undefined) ?? before.status) as CaseStatus)
    if (stillOpen) patch.sla_due_at = computeSlaDueAt(before.created_at, priority, await getSlaHours())
  }
  if (assigneeId !== undefined && assigneeId !== before.assignee_id) {
    patch.assignee_id = assigneeId
    patch.assigned_to = assigneeId // старое поле экспертного портала
  }
  if (Object.keys(patch).length === 1) return NextResponse.json({ ok: true, data: before })

  const { data, error } = await sb
    .from('expert_cases')
    .update(patch)
    .eq('id', params.id)
    .select('id, user_id, status, priority, title, assignee_id, sla_due_at, first_response_at, created_at, updated_at')
    .maybeSingle()
  if (error || !data) return NextResponse.json({ ok: false, error: 'Не удалось изменить кейс' }, { status: 500 })

  const changed = Object.keys(patch).filter((k) => k !== 'updated_at' && k !== 'assigned_to')
  await recordAdminAction(actor, {
    action: 'assignee_id' in patch ? 'case.assigned' : 'case.updated',
    entityType: 'expert_case',
    entityId: params.id,
    targetUserId: before.user_id,
    oldValue: Object.fromEntries(changed.map((k) => [k, (before as unknown as Record<string, unknown>)[k] ?? null])),
    newValue: Object.fromEntries(changed.map((k) => [k, patch[k] ?? null])),
    metadata: { title: before.title },
  }, req)

  if (typeof patch.assignee_id === 'string' && patch.assignee_id !== actor.id) {
    await notifyCaseAssignee({
      assigneeId: patch.assignee_id,
      caseId: params.id,
      clientId: before.user_id,
      title: before.title,
      priority: (patch.priority as string | undefined) ?? before.priority,
      triggerType: before.trigger_type,
      userMessage: before.user_message,
      reason: 'assigned',
    })
  }

  return NextResponse.json({ ok: true, data })
}
