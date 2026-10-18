export const dynamic = 'force-dynamic'

import { NextRequest } from 'next/server'
import { submitPlanVersion } from '@/lib/point-b/plan/flow'
import { auditPlan, findVersion, guarded, guardPlanRoute, json, versionNotFound, PLAN_AUDIT } from '@/lib/point-b/plan/route-guard'

/**
 * POST /api/giga-admin/users/:id/point-b/plan/versions/:versionId/submit — send a draft for approval.
 * The goals snapshot is refreshed first; staff are told that a plan waits for an Admin / Super Admin.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string; versionId: string } }) {
  return guarded('giga/point-b/plan/submit POST', async () => {
    const g = await guardPlanRoute(req, params.id, { write: true })
    if (!g.ok) return g.response
    const { ctx } = g
    const found = await findVersion(ctx, params.versionId)
    if (!found) return versionNotFound()

    const version = await submitPlanVersion(ctx.sb, { companyId: ctx.company!.id, userId: ctx.userId, version: found.version, actor: ctx.author })
    await auditPlan(ctx, req, {
      action: PLAN_AUDIT.submitted, entityId: version.id,
      oldValue: { status: 'draft' }, newValue: { status: version.status },
      metadata: { version: version.version },
    })
    return json({ ok: true, data: version })
  })
}
