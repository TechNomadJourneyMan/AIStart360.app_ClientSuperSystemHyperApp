export const dynamic = 'force-dynamic'

import { NextRequest } from 'next/server'
import { snapshotGoals } from '@/lib/point-b/plan/goals'
import { guarded, guardPlanRoute, json } from '@/lib/point-b/plan/route-guard'
import { loadPlanBundle } from '@/lib/point-b/plan/store'
import { EMPTY_GOALS_SNAPSHOT } from '@/lib/point-b/plan/types'

/**
 * GET /api/giga-admin/users/:id/point-b/plan — the plan of a client for the expert / admin panel:
 * every version (newest first), the open one (draft / in review), the published one, the LIVE goals
 * with their verification statuses, and whether this staff member may approve.
 * Needs clients.review and access to this client; a client without a company or plan gets an
 * empty bundle, not an error.
 */
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  return guarded('giga/point-b/plan GET', async () => {
    const g = await guardPlanRoute(req, params.id)
    if (!g.ok) return g.response
    const { ctx } = g
    if (!ctx.company) {
      return json({ ok: true, data: { plan: null, versions: [], open: null, published: null, goals: EMPTY_GOALS_SNAPSHOT, canApprove: ctx.canApprove } })
    }
    const bundle = await loadPlanBundle(ctx.sb, ctx.company.id)
    const goals = await snapshotGoals(ctx.sb, ctx.company.id, (bundle.open ?? bundle.published)?.goals?.primary ?? undefined)
    return json({ ok: true, data: { ...bundle, goals, canApprove: ctx.canApprove } })
  })
}
