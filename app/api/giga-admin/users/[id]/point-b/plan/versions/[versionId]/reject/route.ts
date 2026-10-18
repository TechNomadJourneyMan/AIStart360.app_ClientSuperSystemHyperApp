export const dynamic = 'force-dynamic'

import { NextRequest } from 'next/server'
import { z } from 'zod'
import { profanityResponse } from '@/lib/moderation/http'
import { auditPlan, fail, findVersion, guarded, guardPlanRoute, json, versionNotFound, PLAN_AUDIT } from '@/lib/point-b/plan/route-guard'
import { rejectVersion } from '@/lib/point-b/plan/store'

/**
 * POST /api/giga-admin/users/:id/point-b/plan/versions/:versionId/reject { reason } — return a version
 * in review to its author as a draft with a comment (≥ 5 characters). Admin / Super Admin only.
 * The reason, who and when stay on the version; the action is audited.
 */
const REASON_MIN = 5
const Body = z.object({ reason: z.string().trim().min(REASON_MIN, `Напишите, что поправить, — не короче ${REASON_MIN} символов`).max(2000) })

export async function POST(req: NextRequest, { params }: { params: { id: string; versionId: string } }) {
  return guarded('giga/point-b/plan/reject POST', async () => {
    const g = await guardPlanRoute(req, params.id, { write: true, approver: true })
    if (!g.ok) return g.response
    const { ctx } = g
    const parsed = Body.safeParse(await req.json().catch(() => null))
    if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? 'Неверный запрос', 400, { field: 'reason' })
    const profane = profanityResponse({ reason: parsed.data.reason })
    if (profane) return profane

    const found = await findVersion(ctx, params.versionId)
    if (!found) return versionNotFound()

    const version = await rejectVersion(ctx.sb, found.version.id, { id: ctx.actor.id }, parsed.data.reason)
    await auditPlan(ctx, req, {
      action: PLAN_AUDIT.rejected, entityId: version.id,
      oldValue: { status: 'in_review' }, newValue: { status: version.status },
      metadata: { version: version.version, reason: parsed.data.reason },
    })
    return json({ ok: true, data: version })
  })
}
