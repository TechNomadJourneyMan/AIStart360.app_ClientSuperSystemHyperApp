export const dynamic = 'force-dynamic'
export const maxDuration = 90

import { NextRequest } from 'next/server'
import { z } from 'zod'
import { buildQuickDraft } from '@/lib/point-b/plan/quick-draft'
import { auditPlan, fail, guarded, guardPlanRoute, json, NO_COMPANY, PLAN_AUDIT } from '@/lib/point-b/plan/route-guard'
import { isRateLimitedKey } from '@/lib/rate-limit'
import { withDeadline } from '@/lib/runtime/deadline'

/**
 * POST /api/giga-admin/users/:id/point-b/plan/quick-draft { ai?: boolean }
 * — «Собрать черновик плана» (R3, M1): the open draft is completed or a new one is created with the scenarios of the
 * model, the pace «умеренный», the reason «Первая версия плана», a rule strategy tree reworded by the AI (no invented
 * numbers) and pending recommendations (lib/point-b/plan/quick-draft.ts). Admin / Super Admin only (PO: they prepare
 * and approve plans); the client must be one the actor may manage. Nothing is approved here.
 *   → 201 { ok, data: { version, created, level, scenarios, selectedScenario, strategy, recommendations, warnings } }
 *   409 { reasons } — not enough data for scenarios (nothing written) or a version already in review;
 *   429 — more often than 6 times in 10 minutes per actor or once a minute per client.
 * Audit: point_b.plan.quick_draft.
 */
const Body = z.object({ ai: z.boolean().optional() }).strict()

async function handlePost(req: NextRequest, { params }: { params: { id: string } }) {
  return guarded('giga/point-b/plan/quick-draft POST', async () => {
    const g = await guardPlanRoute(req, params.id, { write: true, approver: true })
    if (!g.ok) return g.response
    const { ctx } = g
    const parsed = Body.safeParse((await req.json().catch(() => null)) ?? {})
    if (!parsed.success) return fail('Неверный запрос', 400)
    if (!ctx.company) return fail(NO_COMPANY, 404)

    if (await isRateLimitedKey(ctx.actor.id, 'pb-quick-draft', { max: 6, windowMs: 600_000 })) {
      return fail('Черновик можно собирать не чаще 6 раз за 10 минут — попробуйте позже', 429, { code: 'rate_limited' })
    }
    if (await isRateLimitedKey(ctx.company.id, 'pb-quick-draft-company', { max: 1, windowMs: 60_000 })) {
      return fail('Черновик этого клиента уже собирается — подождите минуту', 429, { code: 'rate_limited' })
    }

    const r = await buildQuickDraft(ctx.sb, {
      companyId: ctx.company.id, userId: ctx.userId, author: ctx.author, now: new Date(), ai: parsed.data.ai,
    })
    await auditPlan(ctx, req, {
      action: PLAN_AUDIT.quickDraft, entityId: r.version.id,
      newValue: { status: r.version.status, selectedScenario: r.selectedScenario },
      metadata: {
        version: r.version.version, created: r.created, level: r.level, scenarios: r.scenarios,
        strategy: r.strategy, recommendations: r.recommendations, costUsd: r.ai.costUsd, model: r.ai.model,
      },
    })
    return json({ ok: true, data: r }, r.created ? 201 : 200)
  })
}

/** Two AI calls run side by side (≤ 45 s each); the route answers within 90 s or 504. */
export const POST = withDeadline(handlePost, { label: 'point-b-quick-draft', ms: 90_000 })
