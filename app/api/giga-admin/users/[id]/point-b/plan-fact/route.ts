export const dynamic = 'force-dynamic'
export const maxDuration = 60

import { NextRequest } from 'next/server'
import { auditPlan, fail, guarded, guardPlanRoute, json, NO_COMPANY } from '@/lib/point-b/plan/route-guard'
import { PLANFACT_AUDIT, planFactFailure, saveFactsAndRefresh, staffPlanFactView } from '@/lib/point-b/planfact/route'

/**
 * Plan-fact of a client for the staff (spec §13, §15.4): clients.review + access to this client (guardPlanRoute).
 *
 * GET → { ok, data: { published, planFact: PlanFactState (every version, with content), runs: the newest 5 runs } }
 *       migration 132 not applied → empty checkpoints, not an error
 * PUT { period: 'YYYY-MM', values: { revenue?, leads?, conversion?, avg_check?, cash? }, note? }
 *     «Факт за месяц» entered by the expert (source «ежемесячная сверка», entered_role 'expert'); only the KPIs of the
 *     approved plan; the checkpoints are recalculated right after. 400 with the field / profanity, 409 without an
 *     approved plan, 503 before migration 132.
 *     → { ok, data: { period, saved, cleared, checkpoint: { status, overall?, reason? } } }
 */
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  return guarded('giga/point-b/plan-fact GET', async () => {
    const g = await guardPlanRoute(req, params.id)
    if (!g.ok) return g.response
    const { ctx } = g
    if (!ctx.company) return json({ ok: true, data: { published: false, planFact: null, runs: [] } })
    try {
      return json({ ok: true, data: await staffPlanFactView(ctx.sb, { companyId: ctx.company.id, now: new Date() }) })
    } catch (err) {
      const failure = planFactFailure(err)
      if (failure) return failure
      throw err
    }
  })
}

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  return guarded('giga/point-b/plan-fact PUT', async () => {
    const g = await guardPlanRoute(req, params.id, { write: true })
    if (!g.ok) return g.response
    const { ctx } = g
    if (!ctx.company) return fail(NO_COMPANY, 400)
    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
    if (!body || typeof body !== 'object') return fail('Неверный запрос', 400, { code: 'invalid' })
    try {
      const r = await saveFactsAndRefresh(ctx.sb, {
        companyId: ctx.company.id, userId: ctx.userId, body: { period: body.period, values: body.values, note: body.note },
        enteredBy: ctx.actor.id, role: 'expert', now: new Date(),
      })
      await auditPlan(ctx, req, {
        action: PLANFACT_AUDIT.factsSaved, entityType: 'company', entityId: ctx.company.id,
        metadata: { period: r.period, saved: r.saved, cleared: r.cleared, via: 'giga' },
      })
      return json({ ok: true, data: { period: r.period, saved: r.saved, cleared: r.cleared, checkpoint: { status: r.checkpoint.status, overall: r.checkpoint.overall ?? null, reason: r.checkpoint.reason ?? null } } })
    } catch (err) {
      const failure = planFactFailure(err)
      if (failure) return failure
      throw err
    }
  })
}
