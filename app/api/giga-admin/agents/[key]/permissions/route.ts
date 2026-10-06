import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireGiga } from '@/lib/admin/giga-actor'
import { recordAdminAction } from '@/lib/admin/audit'
import { setAgentGrants } from '@/lib/agents/admin'
import { PERMISSIONS, type Permission } from '@/lib/agents/permissions'

export const dynamic = 'force-dynamic'

const Decision = z.enum(['ALLOW', 'DENY', 'REQUIRE_APPROVAL']).nullable()
const Schema = z.object({
  grants: z.record(z.string(), Decision).refine(
    (g) => Object.keys(g).every((k) => (PERMISSIONS as readonly string[]).includes(k)),
    'неизвестное право',
  ),
}).strict()

/**
 * PUT /api/giga-admin/agents/:key/permissions — set admin grants
 * ({ grants: { PERMISSION: 'ALLOW'|'DENY'|'REQUIRE_APPROVAL'|null } }, null = back to default).
 * Code ceilings still apply: a grant cannot make an approval-gated action automatic.
 */
export async function PUT(req: NextRequest, { params }: { params: { key: string } }) {
  const g = await requireGiga(req, 'agents.manage')
  if (g.response) return g.response
  const parsed = Schema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: parsed.error.issues[0]?.message ?? 'Неверные данные' }, { status: 400 })
  }
  const grants = parsed.data.grants as Partial<Record<Permission, 'ALLOW' | 'DENY' | 'REQUIRE_APPROVAL' | null>>
  await recordAdminAction(g.actor, {
    action: 'agent.permissions.update', entityType: 'agent', entityId: params.key, newValue: grants,
  }, req, { required: true })
  const res = await setAgentGrants(params.key, grants, g.actor.id)
  if (!res.ok) return NextResponse.json({ ok: false, error: 'Агент не найден' }, { status: 404 })
  return NextResponse.json({
    ok: true,
    effective: res.effective,
    capped: res.capped,
    note: res.capped.length ? 'Часть прав ограничена потолком безопасности и всё равно требует одобрения человека.' : null,
  })
}
