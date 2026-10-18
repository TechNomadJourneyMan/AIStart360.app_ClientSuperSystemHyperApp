export const dynamic = 'force-dynamic'

import { NextRequest } from 'next/server'
import { z } from 'zod'
import { profanityResponse } from '@/lib/moderation/http'
import { snapshotGoals } from '@/lib/point-b/plan/goals'
import { auditPlan, fail, findVersion, guarded, guardPlanRoute, json, versionNotFound, PLAN_AUDIT } from '@/lib/point-b/plan/route-guard'
import { PlanError, updateDraft } from '@/lib/point-b/plan/store'
import { isEditable } from '@/lib/point-b/plan/status'

/**
 * PATCH /api/giga-admin/users/:id/point-b/plan/versions/:versionId { expertNotes?, changeReason? }
 * — edit a DRAFT. A version in review, approved or replaced is frozen → 409 (a change is a new
 * version). The goals snapshot of the draft follows the live goals on every save.
 */
const Body = z.object({
  expertNotes: z.string().max(8000, 'Не больше 8000 символов').nullable().optional(),
  changeReason: z.string().max(1000, 'Не больше 1000 символов').nullable().optional(),
}).refine((b) => b.expertNotes !== undefined || b.changeReason !== undefined, { message: 'Нечего сохранять' })

export async function PATCH(req: NextRequest, { params }: { params: { id: string; versionId: string } }) {
  return guarded('giga/point-b/plan/versions PATCH', async () => {
    const g = await guardPlanRoute(req, params.id, { write: true })
    if (!g.ok) return g.response
    const { ctx } = g
    const parsed = Body.safeParse(await req.json().catch(() => null))
    if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? 'Неверный запрос', 400)
    const profane = profanityResponse({ expertNotes: parsed.data.expertNotes, changeReason: parsed.data.changeReason })
    if (profane) return profane

    const found = await findVersion(ctx, params.versionId)
    if (!found) return versionNotFound()
    if (!isEditable(found.version.status)) throw new PlanError('not_editable', 'Версию нельзя изменить: правится только черновик')

    const goals = await snapshotGoals(ctx.sb, ctx.company!.id, found.version.goals?.primary ?? undefined)
    const version = await updateDraft(ctx.sb, found.version.id, { ...parsed.data, goals })
    await auditPlan(ctx, req, {
      action: PLAN_AUDIT.updated, entityId: version.id,
      metadata: {
        version: version.version,
        ...(parsed.data.expertNotes !== undefined ? { notesPreview: (parsed.data.expertNotes ?? '').slice(0, 120) } : {}),
        ...(parsed.data.changeReason !== undefined ? { changeReason: parsed.data.changeReason } : {}),
      },
    })
    return json({ ok: true, data: version })
  })
}
