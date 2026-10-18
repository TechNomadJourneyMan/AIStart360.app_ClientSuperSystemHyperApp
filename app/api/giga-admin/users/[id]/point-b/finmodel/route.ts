export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { isUuid } from '@/lib/admin/client-scope'
import { fail, finmodelDefsView, finmodelFailure, loadFinmodelForUser, parseValuesBody } from '@/lib/point-b/finmodel/service'
import { saveFinmodelValues } from '@/lib/point-b/finmodel/store'
import { loadFinmodelWarnings } from '@/lib/point-b/model/load'
import { auditPlan, guardPlanRoute, NO_COMPANY } from '@/lib/point-b/plan/route-guard'
import { FINMODEL_AUDIT } from '@/lib/point-b/finmodel/audit'

/**
 * GET /api/giga-admin/users/:id/point-b/finmodel — the client's «Финмодель» as the expert sees it:
 *   { ok, data: { defs, state, warnings } } — `state` as in the client's GET, `warnings` are the finmodel
 *   warnings of the calculation (model expenses against the fact, industry assumptions in use).
 *
 * PUT … { values: [{ key, value, asOf?, period?, note? }] } → { ok, data: { state } } — the values are
 *   saved with origin `expert`, status `entered` (to be verified: POST …/finmodel/verify).
 *
 * Needs `clients.review` and access to THIS client (another expert's client → 403); writing also needs
 * a client the actor may manage. Audited: point_b.finmodel.updated.
 */
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    if (!isUuid(params.id)) return fail('Клиент не найден', 404)
    const g = await guardPlanRoute(req, params.id)
    if (!g.ok) return g.response
    const { ctx } = g
    const state = await loadFinmodelForUser(ctx.sb, { userId: ctx.userId, companyId: ctx.company?.id ?? null })
    const warnings = ctx.company ? await loadFinmodelWarnings(ctx.sb, { userId: ctx.userId, companyId: ctx.company.id }) : []
    return NextResponse.json({ ok: true, data: { defs: finmodelDefsView(), state, warnings } })
  } catch (err) {
    console.error('[giga/point-b/finmodel GET]', err instanceof Error ? err.message : err)
    return fail('Не удалось загрузить финмодель клиента', 500)
  }
}

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    if (!isUuid(params.id)) return fail('Клиент не найден', 404)
    const g = await guardPlanRoute(req, params.id, { write: true })
    if (!g.ok) return g.response
    const { ctx } = g
    const parsed = parseValuesBody(await req.json().catch(() => null))
    if (!parsed.ok) return parsed.response
    if (!ctx.company) return fail(NO_COMPANY, 400, { code: 'no_company' })

    const before = await loadFinmodelForUser(ctx.sb, { userId: ctx.userId, companyId: ctx.company.id })
    const saved = await saveFinmodelValues(ctx.sb, {
      companyId: ctx.company.id,
      actor: { id: ctx.actor.id, role: 'expert', name: ctx.actorName },
      values: parsed.values,
    })
    const state = await loadFinmodelForUser(ctx.sb, { userId: ctx.userId, companyId: ctx.company.id })
    await auditPlan(ctx, req, {
      action: FINMODEL_AUDIT.updated, entityType: 'pb_finmodel', entityId: ctx.company.id,
      oldValue: Object.fromEntries(Object.keys(saved).map((k) => [k, before.values[k as keyof typeof before.values]?.value ?? null])),
      newValue: Object.fromEntries(Object.entries(saved).map(([k, v]) => [k, v?.value ?? null])),
      metadata: { keys: Object.keys(saved), notes: parsed.values.filter((v) => v.note).length },
    })
    return NextResponse.json({ ok: true, data: { state } })
  } catch (err) {
    const answer = finmodelFailure(err)
    if (answer) return answer
    console.error('[giga/point-b/finmodel PUT]', err instanceof Error ? err.message : err)
    return fail('Не удалось сохранить финмодель клиента', 500)
  }
}
