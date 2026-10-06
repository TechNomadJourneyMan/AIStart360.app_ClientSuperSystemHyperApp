import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireGiga } from '@/lib/admin/giga-actor'
import { recordAdminAction } from '@/lib/admin/audit'
import { runAgentManually } from '@/lib/admin/staff-actions'
import { getAgent } from '@/lib/agents/registry'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

const Schema = z.object({
  companyId: z.string().min(1).max(64).optional(),
  input: z.record(z.string(), z.unknown()).optional(),
}).strict()

const STATUS = { not_found: 404, bad_request: 400, conflict: 409 } as const

/**
 * POST /api/giga-admin/agents/:key/run — start an agent now (manual trigger).
 * The run itself is lib/admin/staff-actions.ts runAgentManually (shared with
 * the admin Telegram bot).
 */
export async function POST(req: NextRequest, { params }: { params: { key: string } }) {
  const g = await requireGiga(req, 'agents.run')
  if (g.response) return g.response
  if (!getAgent(params.key)) return NextResponse.json({ ok: false, error: 'Агент не найден' }, { status: 404 })
  const parsed = Schema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ ok: false, error: 'Неверные данные' }, { status: 400 })

  const res = await runAgentManually({
    key: params.key,
    companyId: parsed.data.companyId,
    input: parsed.data.input,
    actorId: g.actor.id,
    audit: (entry, opts) => recordAdminAction(g.actor, entry, req, opts),
  })
  if (!res.ok) return NextResponse.json({ ok: false, error: res.error }, { status: STATUS[res.code] })
  return NextResponse.json({ ok: true, taskId: res.taskId }, { status: 202 })
}
