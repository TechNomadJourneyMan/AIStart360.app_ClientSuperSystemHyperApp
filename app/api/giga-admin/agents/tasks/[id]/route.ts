import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireGiga } from '@/lib/admin/giga-actor'
import { recordAdminAction } from '@/lib/admin/audit'
import { cancelTask, getTaskDetail, retryTask } from '@/lib/agents/admin'
import { kickTask } from '@/lib/agents/queue'

export const dynamic = 'force-dynamic'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
type Ctx = { params: { id: string } }

/** GET /api/giga-admin/agents/tasks/:id — task with runs, tool calls, events, approvals. */
export async function GET(req: NextRequest, { params }: Ctx) {
  const g = await requireGiga(req, 'agents.view')
  if (g.response) return g.response
  if (!UUID.test(params.id)) return NextResponse.json({ ok: false, error: 'Задача не найдена' }, { status: 404 })
  const detail = await getTaskDetail(params.id)
  if (!detail) return NextResponse.json({ ok: false, error: 'Задача не найдена' }, { status: 404 })
  return NextResponse.json({ ok: true, ...detail })
}

const Action = z.object({ action: z.enum(['cancel', 'retry']) }).strict()

/** POST /api/giga-admin/agents/tasks/:id — { action: 'cancel' | 'retry' }. */
export async function POST(req: NextRequest, { params }: Ctx) {
  const g = await requireGiga(req, 'agents.run')
  if (g.response) return g.response
  if (!UUID.test(params.id)) return NextResponse.json({ ok: false, error: 'Задача не найдена' }, { status: 404 })
  const parsed = Action.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ ok: false, error: 'Неверное действие' }, { status: 400 })
  await recordAdminAction(g.actor, {
    action: `agent.task.${parsed.data.action}`, entityType: 'agent_task', entityId: params.id,
  }, req, { required: true })
  if (parsed.data.action === 'cancel') {
    const ok = await cancelTask(params.id, g.actor.id)
    return ok
      ? NextResponse.json({ ok: true })
      : NextResponse.json({ ok: false, error: 'Задачу нельзя отменить в текущем статусе' }, { status: 409 })
  }
  const ok = await retryTask(params.id)
  if (!ok) return NextResponse.json({ ok: false, error: 'Повторить можно только завершившуюся неуспешно задачу' }, { status: 409 })
  kickTask(params.id)
  return NextResponse.json({ ok: true })
}
