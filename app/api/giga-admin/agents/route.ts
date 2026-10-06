import { NextRequest, NextResponse } from 'next/server'
import { requireGiga } from '@/lib/admin/giga-actor'
import { listAgentOverviews } from '@/lib/agents/admin'
import { PERMISSION_CEILING, PERMISSION_LABELS, PERMISSIONS } from '@/lib/agents/permissions'

export const dynamic = 'force-dynamic'

/** GET /api/giga-admin/agents — every agent with config, effective permissions and 7-day stats. */
export async function GET(req: NextRequest) {
  const g = await requireGiga(req, 'agents.view')
  if (g.response) return g.response
  try {
    const agents = await listAgentOverviews()
    return NextResponse.json({
      ok: true,
      agents,
      permissionCatalog: PERMISSIONS.map((p) => ({ key: p, label: PERMISSION_LABELS[p], ceiling: PERMISSION_CEILING[p] })),
      can: { run: g.actor.permissions.includes('agents.run'), manage: g.actor.permissions.includes('agents.manage') },
    })
  } catch (err) {
    console.error('[giga-admin/agents] list failed', err instanceof Error ? err.message : err)
    return NextResponse.json({ ok: false, error: 'Не удалось загрузить агентов (применены ли миграции 086–087?)' }, { status: 500 })
  }
}
