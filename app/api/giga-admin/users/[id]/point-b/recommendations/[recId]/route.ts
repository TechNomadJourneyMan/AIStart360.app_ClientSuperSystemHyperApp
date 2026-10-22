export const dynamic = 'force-dynamic'

import { NextRequest } from 'next/server'
import { z } from 'zod'
import { isUuid } from '@/lib/admin/client-scope'
import { inviteFromVerifiedRecommendation } from '@/lib/point-b/invites/run'
import { REC_AUDIT, REC_NOT_FOUND, recFailure, reviewerOf } from '@/lib/point-b/recs/route'
import { editRecommendation, rejectRecommendation, verifyRecommendation } from '@/lib/point-b/recs/store'
import { auditPlan, fail, guarded, guardPlanRoute, json } from '@/lib/point-b/plan/route-guard'

/**
 * PATCH /api/giga-admin/users/:id/point-b/recommendations/:recId — the expert's decision on a recommendation
 * of THIS client (clients.review + access to the client + forbidTarget):
 *
 *   { action: 'verify', scopeNote, comment? }  pending_review → expert_verified; the reviewer's name and specialty
 *                                             come from the actor's profile («Эксперт AIStart360» without one);
 *                                             the client gets the invite «Эксперт подтвердил рекомендацию»
 *   { action: 'reject', comment }             pending_review → expert_rejected
 *   { action: 'edit', patch }                 a new version (rec_version + 1, pending_review), the old one → stale
 *   → { ok, data: Recommendation }
 *
 * 400 invalid / profanity (with `field`: scopeNote, comment, title, …), 403 another expert's client,
 * 404 unknown recommendation (or another client's), 409 already decided (e.g. a second verify).
 */
const text = z.string().max(4000).nullable().optional()
const Body = z.discriminatedUnion('action', [
  z.object({ action: z.literal('verify'), scopeNote: z.string().max(4000).optional(), comment: text }),
  z.object({ action: z.literal('reject'), comment: z.string().max(4000).optional() }),
  z.object({
    action: z.literal('edit'),
    patch: z.object({
      title: z.string().max(400).optional(),
      essence: z.string().max(4000).optional(),
      reason: z.string().max(4000).optional(),
      expectedEffect: text,
      resources: text,
      confidence: z.enum(['low', 'medium', 'high']).optional(),
      confidenceReason: text,
      risks: text,
      nextAction: text,
    }).strict(),
  }),
])

export async function PATCH(req: NextRequest, { params }: { params: { id: string; recId: string } }) {
  return guarded('giga/point-b/recommendations/:recId PATCH', async () => {
    const g = await guardPlanRoute(req, params.id, { write: true })
    if (!g.ok) return g.response
    const { ctx } = g
    const parsed = Body.safeParse(await req.json().catch(() => null))
    if (!parsed.success) return fail('Неверный запрос', 400, { code: 'invalid' })
    if (!ctx.company || !isUuid(params.recId)) return fail(REC_NOT_FOUND, 404, { code: 'not_found' })
    const body = parsed.data
    const companyId = ctx.company.id
    try {
      if (body.action === 'verify') {
        const rec = await verifyRecommendation(ctx.sb, {
          id: params.recId, companyId, reviewer: await reviewerOf(ctx), scopeNote: body.scopeNote ?? '', comment: body.comment ?? null,
        })
        await inviteFromVerifiedRecommendation(ctx.sb, { rec, userId: ctx.userId, now: new Date() })
        await auditPlan(ctx, req, {
          action: REC_AUDIT.verified, entityType: 'pb_recommendation', entityId: rec.id,
          oldValue: { status: 'pending_review' }, newValue: { status: rec.status },
          metadata: { recVersion: rec.recVersion, scopeNote: rec.scopeNote, reviewer: rec.reviewerName, specialty: rec.reviewerSpecialty },
        })
        return json({ ok: true, data: rec })
      }
      if (body.action === 'reject') {
        const rec = await rejectRecommendation(ctx.sb, { id: params.recId, companyId, reviewer: { id: ctx.actor.id, name: ctx.actorName }, comment: body.comment ?? '' })
        await auditPlan(ctx, req, {
          action: REC_AUDIT.rejected, entityType: 'pb_recommendation', entityId: rec.id,
          oldValue: { status: 'pending_review' }, newValue: { status: rec.status }, metadata: { recVersion: rec.recVersion, comment: rec.reviewComment },
        })
        return json({ ok: true, data: rec })
      }
      const rec = await editRecommendation(ctx.sb, { id: params.recId, companyId, patch: body.patch, editor: { id: ctx.actor.id, name: ctx.actorName } })
      await auditPlan(ctx, req, {
        action: REC_AUDIT.edited, entityType: 'pb_recommendation', entityId: rec.id,
        oldValue: { id: params.recId }, newValue: { id: rec.id, status: rec.status, recVersion: rec.recVersion },
        metadata: { supersedes: params.recId, fields: Object.keys(body.patch) },
      })
      return json({ ok: true, data: rec })
    } catch (err) {
      const failure = recFailure(err)
      if (failure) return failure
      throw err
    }
  })
}
