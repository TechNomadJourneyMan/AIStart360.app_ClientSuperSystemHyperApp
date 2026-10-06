import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireGiga } from '@/lib/admin/giga-actor'
import { recordAdminAction } from '@/lib/admin/audit'
import { enqueueAgentTask } from '@/lib/agents/queue'
import { getAgent } from '@/lib/agents/registry'
import { prisma } from '@/lib/db'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

const Schema = z.object({
  companyId: z.string().min(1).max(64).optional(),
  input: z.record(z.string(), z.unknown()).optional(),
}).strict()

/** POST /api/giga-admin/agents/:key/run — start an agent now (manual trigger). */
export async function POST(req: NextRequest, { params }: { params: { key: string } }) {
  const g = await requireGiga(req, 'agents.run')
  if (g.response) return g.response
  const def = getAgent(params.key)
  if (!def) return NextResponse.json({ ok: false, error: 'Агент не найден' }, { status: 404 })
  const parsed = Schema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ ok: false, error: 'Неверные данные' }, { status: 400 })
  const { companyId, input } = parsed.data

  if (def.scope === 'company') {
    if (!companyId) return NextResponse.json({ ok: false, error: 'Выберите компанию' }, { status: 400 })
    const rows = await prisma.$queryRaw<Array<{ id: string }>>`SELECT id FROM public.companies WHERE id = ${companyId}`
    if (!rows[0]) return NextResponse.json({ ok: false, error: 'Компания не найдена' }, { status: 404 })
  }
  const inputCheck = def.inputSchema.safeParse(input ?? {})
  if (!inputCheck.success) return NextResponse.json({ ok: false, error: 'Неверные входные данные агента' }, { status: 400 })

  await recordAdminAction(g.actor, {
    action: 'agent.run.manual', entityType: 'agent', entityId: def.key,
    newValue: { companyId: companyId ?? null, input: input ?? {} },
  }, req, { required: true })
  try {
    const task = await enqueueAgentTask({
      agentKey: def.key,
      companyId: def.scope === 'company' ? companyId! : null,
      trigger: 'manual',
      requestedBy: g.actor.id,
      input: input ?? {},
      priority: 3,
    })
    return NextResponse.json({ ok: true, taskId: task.id }, { status: 202 })
  } catch (err) {
    const msg = err instanceof Error && /disabled/.test(err.message) ? 'Агент выключен' : 'Не удалось поставить задачу'
    return NextResponse.json({ ok: false, error: msg }, { status: 409 })
  }
}
