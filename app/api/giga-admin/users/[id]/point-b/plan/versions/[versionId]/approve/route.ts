export const dynamic = 'force-dynamic'

import { NextRequest } from 'next/server'
import { z } from 'zod'
import { approveAndAudit, exceptionReasonOf, fail, findVersion, guarded, guardPlanRoute, json, versionNotFound } from '@/lib/point-b/plan/route-guard'

/**
 * POST /api/giga-admin/users/:id/point-b/plan/versions/:versionId/approve { exceptionReason? }
 * — publish a version: Admin / Super Admin only. The server checks the conditions (the primary goal
 * is verified / agreed; the version says why it changes): not met → 409 with `reasons`. A missing
 * goal verification can be waived with `exceptionReason` (≥ 10 characters), which is stored on the
 * version and in the audit; a shorter one → 400. The previous published version becomes replaced;
 * the client is told.
 */
const Body = z.object({ exceptionReason: z.string().max(1000).nullable().optional() })

export async function POST(req: NextRequest, { params }: { params: { id: string; versionId: string } }) {
  return guarded('giga/point-b/plan/approve POST', async () => {
    const g = await guardPlanRoute(req, params.id, { write: true, approver: true })
    if (!g.ok) return g.response
    const { ctx } = g
    const parsed = Body.safeParse((await req.json().catch(() => null)) ?? {})
    if (!parsed.success) return fail('Неверный запрос', 400)
    const exception = exceptionReasonOf(parsed.data.exceptionReason)
    if ('response' in exception) return exception.response

    const found = await findVersion(ctx, params.versionId)
    if (!found) return versionNotFound()

    const result = await approveAndAudit(req, ctx, found.version, exception.reason)
    return json({ ok: true, data: result.version })
  })
}
