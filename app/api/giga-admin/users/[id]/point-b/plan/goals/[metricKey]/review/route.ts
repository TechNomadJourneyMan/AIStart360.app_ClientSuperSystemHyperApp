export const dynamic = 'force-dynamic'

import { NextRequest } from 'next/server'
import { z } from 'zod'
import { getMetricById } from '@/lib/metrics/registry'
import { profanityResponse } from '@/lib/moderation/http'
import { reviewGoal } from '@/lib/point-b/plan/goals'
import { notifyGoalCorrection } from '@/lib/point-b/plan/notify'
import { auditPlan, fail, guarded, guardPlanRoute, json, NO_COMPANY, PLAN_AUDIT } from '@/lib/point-b/plan/route-guard'

/**
 * POST /api/giga-admin/users/:id/point-b/plan/goals/:metricKey/review
 *   { periodLabel, action: 'verify' | 'correct' | 'reject', value?, deadline?, reason? }
 *
 * An expert / admin looks at the owner's goal:
 *  - verify   the goal is confirmed as it is;
 *  - correct  the owner has no goal → it is set right away (source «эксперт»), the owner is told;
 *             the owner has one → a PROPOSAL (the goal is untouched until the owner agrees), the
 *             owner is told and asked;
 *  - reject   the goal is rejected, a reason is required.
 * A correction needs a value and a reason. Needs clients.review and access to this client.
 */
const METRIC_KEY = /^[A-Za-z0-9_.\-]{3,120}$/
const Body = z.object({
  periodLabel: z.string().trim().min(1).max(20),
  action: z.enum(['verify', 'correct', 'reject']),
  value: z.number().finite().optional(),
  deadline: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Срок цели указан неверно (ГГГГ-ММ-ДД)').nullable().optional(),
  reason: z.string().trim().max(2000).nullable().optional(),
})

export async function POST(req: NextRequest, { params }: { params: { id: string; metricKey: string } }) {
  return guarded('giga/point-b/plan/goals/review POST', async () => {
    const g = await guardPlanRoute(req, params.id, { write: true })
    if (!g.ok) return g.response
    const { ctx } = g
    if (!METRIC_KEY.test(params.metricKey)) return fail('Неизвестная метрика', 400, { field: 'metricKey' })
    const parsed = Body.safeParse(await req.json().catch(() => null))
    if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? 'Неверный запрос', 400)
    const { action, value, deadline, periodLabel } = parsed.data
    const reason = parsed.data.reason?.trim() || null
    const profane = profanityResponse({ reason })
    if (profane) return profane
    if (action === 'correct' && value === undefined) return fail('Укажите значение цели', 400, { field: 'value' })
    if (action !== 'verify' && !reason) {
      return fail(action === 'correct' ? 'Укажите причину исправления цели' : 'Укажите причину, по которой цель отклонена', 400, { field: 'reason' })
    }
    if (!ctx.company) return fail(NO_COMPANY, 404)

    const { review, appliedDirectly } = await reviewGoal(ctx.sb, {
      companyId: ctx.company.id, metricKey: params.metricKey, periodLabel, action, value,
      deadline: deadline === undefined ? undefined : deadline, reason: reason ?? undefined,
      reviewer: { id: ctx.actor.id, name: ctx.actorName },
    })

    if (action === 'correct') {
      // A proposal asks the owner; a goal set right away (no previous one) just tells them.
      await notifyGoalCorrection(ctx.sb, {
        userId: ctx.userId,
        reviewId: review.id,
        metricLabel: getMetricById(params.metricKey)?.label ?? params.metricKey,
        from: appliedDirectly ? null : review.previous_value,
        to: review.proposed_value,
        reason: reason ?? '',
        reviewer: { id: ctx.actor.id, name: ctx.actorName },
      })
    }

    await auditPlan(ctx, req, {
      action: PLAN_AUDIT.goalReviewed, entityType: 'pb_goal_review', entityId: review.id,
      oldValue: review.previous_value === null ? null : { value: review.previous_value },
      newValue: { status: review.status, value: review.proposed_value, deadline: review.proposed_deadline },
      metadata: { metricKey: params.metricKey, periodLabel, action, appliedDirectly, reason },
    })
    return json({ ok: true, data: { review, appliedDirectly } })
  }, { conditionsStatus: 400 })
}
