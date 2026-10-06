import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireGiga } from '@/lib/admin/giga-actor'
import { recordAdminAction } from '@/lib/admin/audit'
import { listAgentOverviews, listTasks, updateAgentConfig } from '@/lib/agents/admin'

export const dynamic = 'force-dynamic'

type Ctx = { params: { key: string } }

/** GET /api/giga-admin/agents/:key — one agent with its latest tasks. */
export async function GET(req: NextRequest, { params }: Ctx) {
  const g = await requireGiga(req, 'agents.view')
  if (g.response) return g.response
  const agent = (await listAgentOverviews()).find((a) => a.key === params.key)
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

const ERRORS: Record<string, string> = {
  unknown_agent: 'Агент не найден',
  invalid_cron: 'Неверное расписание (5 полей cron, UTC)',
  schedule_only_for_platform_agents: 'Расписание доступно только платформенным агентам',
}

/** PATCH /api/giga-admin/agents/:key — enable/disable, model, schedule, budgets. */
export async function PATCH(req: NextRequest, { params }: Ctx) {
  const g = await requireGiga(req, 'agents.manage')
  if (g.response) return g.response
  const parsed = PatchSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: parsed.error.issues[0]?.message ?? 'Неверные данные' }, { status: 400 })
  }
  const before = (await listAgentOverviews()).find((a) => a.key === params.key)
  await recordAdminAction(g.actor, {
    action: 'agent.config.update',
    entityType: 'agent',
    entityId: params.key,
    oldValue: before ? { enabled: before.enabled, tier: before.tier, model: before.model, cron: before.triggers.cron, limits: before.limits } : null,
    newValue: parsed.data,
  }, req, { required: true })
  const res = await updateAgentConfig(params.key, parsed.data, g.actor.id)
  if (!res.ok) return NextResponse.json({ ok: false, error: ERRORS[res.error] ?? res.error }, { status: res.error === 'unknown_agent' ? 404 : 400 })
  return NextResponse.json({ ok: true })
}
