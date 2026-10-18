export const dynamic = 'force-dynamic'

import { NextRequest } from 'next/server'
import { z } from 'zod'
import { profanityResponse } from '@/lib/moderation/http'
import { createPlanDraft } from '@/lib/point-b/plan/flow'
import { auditPlan, fail, guarded, guardPlanRoute, json, NO_COMPANY, PLAN_AUDIT } from '@/lib/point-b/plan/route-guard'

/**
 * POST /api/giga-admin/users/:id/point-b/plan/versions { changeReason? } — a new DRAFT of the plan:
 * a snapshot of the live goals, the content of the published version copied. One open version per
 * plan: a second draft while one is open or in review → 409.
 */
const Body = z.object({ changeReason: z.string().trim().max(1000).nullable().optional() })

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  return guarded('giga/point-b/plan/versions POST', async () => {
    const g = await guardPlanRoute(req, params.id, { write: true })
    if (!g.ok) return g.response
    const { ctx } = g
    const parsed = Body.safeParse((await req.json().catch(() => null)) ?? {})
    if (!parsed.success) return fail('Неверный запрос', 400)
    const profane = profanityResponse({ changeReason: parsed.data.changeReason })
    if (profane) return profane
    if (!ctx.company) return fail(NO_COMPANY, 404)

    const { version } = await createPlanDraft(ctx.sb, {
      companyId: ctx.company.id, userId: ctx.userId, author: ctx.author, changeReason: parsed.data.changeReason ?? null,
    })
    await auditPlan(ctx, req, {
      action: PLAN_AUDIT.created, entityId: version.id,
      newValue: { status: version.status, version: version.version },
      metadata: { planId: version.plan_id, version: version.version },
    })
    return json({ ok: true, data: version }, 201)
  })
}
