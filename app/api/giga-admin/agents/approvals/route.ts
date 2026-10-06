import { NextRequest, NextResponse } from 'next/server'
import { requireGiga } from '@/lib/admin/giga-actor'
import { listApprovals } from '@/lib/agents/admin'

export const dynamic = 'force-dynamic'

/** GET /api/giga-admin/agents/approvals?scope=pending|all */
export async function GET(req: NextRequest) {
  const g = await requireGiga(req, 'agents.view')
  if (g.response) return g.response
  const scope = req.nextUrl.searchParams.get('scope') === 'all' ? 'all' : 'pending'
  const items = await listApprovals(scope)
  return NextResponse.json({ ok: true, items, canDecide: g.actor.permissions.includes('approvals.decide') })
}
