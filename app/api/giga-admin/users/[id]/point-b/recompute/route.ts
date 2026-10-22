export const dynamic = 'force-dynamic'
// One company inline within its 45-second budget (lib/point-b/planfact/recompute.ts).
export const maxDuration = 60

import { NextRequest } from 'next/server'
import { auditPlan, fail, guarded, guardPlanRoute, json, NO_COMPANY } from '@/lib/point-b/plan/route-guard'
import { PLANFACT_AUDIT, planFactFailure, recomputeNow } from '@/lib/point-b/planfact/route'

/**
 * POST /api/giga-admin/users/:id/point-b/recompute — the button «Пересчитать» of User 360 → «Точка Б» (spec §14).
 * Staff only: clients.review + access to this client (guardPlanRoute, writes also forbidTarget); a client gets 401 / 403.
 * Recalculates the forecast and the plan-fact checkpoints of the client's APPROVED plan now, marks stale
 * recommendations, runs the invite rules and, on a material deviation, proposes a DRAFT revision (never approves).
 * At most once in 10 minutes per company (429 with `retryAt`).
 *   → { ok, data: { status: 'done' | 'unchanged' | 'no_plan' | 'failed', computedAt?, period?, overall?, reason?,
 *                   draft?, invites?, staleRecs? } }
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  return guarded('giga/point-b/recompute POST', async () => {
    const g = await guardPlanRoute(req, params.id, { write: true })
    if (!g.ok) return g.response
    const { ctx } = g
    if (!ctx.company) return fail(NO_COMPANY, 400)
    try {
      const now = new Date()
      const r = await recomputeNow(ctx.sb, { companyId: ctx.company.id, userId: ctx.userId, actorId: ctx.actor.id, now })
      if (!r.ok) return fail('Пересчёт уже запускали недавно — следующий через несколько минут', 429, { code: 'rate_limited', retryAt: r.retryAt })
      await auditPlan(ctx, req, {
        action: PLANFACT_AUDIT.recomputed, entityType: 'company', entityId: ctx.company.id,
        metadata: { status: r.outcome.status, overall: r.outcome.overall ?? null, period: r.outcome.period ?? null, draft: r.outcome.draft ?? null, runId: r.runId },
      })
      const { companyId: _c, ...data } = r.outcome
      return json({ ok: true, data })
    } catch (err) {
      const failure = planFactFailure(err)
      if (failure) return failure
      throw err
    }
  })
}
