import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireGiga } from '@/lib/admin/giga-actor'
import { recordAdminAction } from '@/lib/admin/audit'
import { decideApproval } from '@/lib/agents/approvals'
import { closeApprovalCards } from '@/lib/notifications/approval-cards'

export const dynamic = 'force-dynamic'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const Schema = z.object({
  decision: z.enum(['approve', 'reject']),
  reason: z.string().trim().max(500).optional(),
}).strict()

/** POST /api/giga-admin/agents/approvals/:id — approve or reject an agent action. */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const g = await requireGiga(req, 'approvals.decide')
  if (g.response) return g.response
  if (!UUID.test(params.id)) return NextResponse.json({ ok: false, error: 'Запрос не найден' }, { status: 404 })
  const parsed = Schema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ ok: false, error: 'Неверные данные' }, { status: 400 })

  await recordAdminAction(g.actor, {
    action: 'agent.approval.decide', entityType: 'agent_approval', entityId: params.id,
    newValue: { decision: parsed.data.decision, reason: parsed.data.reason ?? null }, metadata: { via: 'admin' },
  }, req, { required: true })

  const res = await decideApproval({
    approvalId: params.id,
    decision: parsed.data.decision,
    actorId: g.actor.id,
    via: 'admin',
    reason: parsed.data.reason ?? null,
  })
  if (!res.ok) {
    return NextResponse.json(
      { ok: false, error: res.reason === 'not_pending' ? 'Решение уже принято или срок истёк' : 'Запрос не найден' },
      { status: res.reason === 'not_pending' ? 409 : 404 },
    )
  }
  await closeApprovalCards({
    approvalId: params.id,
    status: res.status!,
    decidedBy: g.actor.email ?? g.actor.id,
    via: 'admin',
    summary: res.summary,
  }).catch((err) => console.error('[approvals] closing Telegram cards failed', err instanceof Error ? err.message : err))
  return NextResponse.json({ ok: true, status: res.status, taskId: res.taskId })
}
