import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireGiga } from '@/lib/admin/giga-actor'
import { recordAdminAction } from '@/lib/admin/audit'
import { getAgentOverview, listTasks } from '@/lib/agents/admin'
import { updateAgentConfigAudited } from '@/lib/admin/staff-actions'

export const dynamic = 'force-dynamic'

type Ctx = { params: { key: string } }

/** GET /api/giga-admin/agents/:key — one agent with its latest tasks. */
export async function GET(req: NextRequest, { params }: Ctx) {
  const g = await requireGiga(req, 'agents.view')
  if (g.response) return g.response
  const agent = await getAgentOverview(params.key)
  if (!agent) return NextResponse.json({ ok: false, error: 'Агент не найден' }, { status: 404 })
  const tasks = await listTasks({ agentKey: params.key, limit: 30 })
  return NextResponse.json({ ok: true, agent, tasks: tasks.items })
}

const PatchSchema = z.object({
  enabled: z.boolean().optional(),
  tierOverride: z.enum(['light', 'standard', 'premium']).nullable().optional(),
  modelOverride: z.string().regex(/^[a-z0-9._-]+\/[a-z0-9._:-]+$/, 'формат: provider/model').nullable().optional(),
  scheduleCron: z.string().max(100).nullable().optional(),
  perRunBudgetUsd: z.number().min(0).max(50).nullable().optional(),
  dailyBudgetUsd: z.number().min(0).max(1000).nullable().optional(),
  maxOutputTokens: z.number().int().min(64).max(32000).nullable().optional(),
}).strict()

/** PATCH /api/giga-admin/agents/:key — enable/disable, model, schedule, budgets. */
export async function PATCH(req: NextRequest, { params }: Ctx) {
  const g = await requireGiga(req, 'agents.manage')
  if (g.response) return g.response
  const parsed = PatchSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: parsed.error.issues[0]?.message ?? 'Неверные данные' }, { status: 400 })
  }
  const res = await updateAgentConfigAudited({
    key: params.key,
    patch: parsed.data,
    actorId: g.actor.id,
    audit: (entry, opts) => recordAdminAction(g.actor, entry, req, opts),
  })
  if (!res.ok) return NextResponse.json({ ok: false, error: res.error }, { status: res.code === 'not_found' ? 404 : 400 })
  return NextResponse.json({ ok: true })
}
