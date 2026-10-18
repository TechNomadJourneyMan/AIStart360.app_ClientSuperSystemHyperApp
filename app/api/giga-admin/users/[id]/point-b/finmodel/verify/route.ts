export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { isUuid } from '@/lib/admin/client-scope'
import { FINMODEL_AUDIT } from '@/lib/point-b/finmodel/audit'
import { isFinmodelKey, type FinmodelKey } from '@/lib/point-b/finmodel/keys'
import { fail, finmodelFailure, loadFinmodelForUser } from '@/lib/point-b/finmodel/service'
import { verifyFinmodelValues } from '@/lib/point-b/finmodel/store'
import { auditPlan, guardPlanRoute, NO_COMPANY } from '@/lib/point-b/plan/route-guard'

/**
 * POST /api/giga-admin/users/:id/point-b/finmodel/verify { keys: FinmodelKey[] }
 * — the expert confirms the values that PEOPLE typed (the owner's or his own): they become `verified`
 *   with his name and the date. A key without a typed value (taken from the questionnaire, an industry
 *   assumption, or empty) → 400 `not_found` and nothing is verified. A value typed again afterwards is
 *   `entered` again.
 *   → { ok, data: { state } }. Needs `clients.review`, access to THIS client, a client the actor may
 *   manage. Audited: point_b.finmodel.verified.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    if (!isUuid(params.id)) return fail('Клиент не найден', 404)
    const g = await guardPlanRoute(req, params.id, { write: true })
    if (!g.ok) return g.response
    const { ctx } = g

    const raw = (await req.json().catch(() => null)) as { keys?: unknown } | null
    if (!raw || !Array.isArray(raw.keys) || raw.keys.length === 0 || raw.keys.length > 20) {
      return fail('Укажите, какие значения подтвердить', 400, { code: 'invalid_request' })
    }
    const unknown = raw.keys.find((k) => !isFinmodelKey(k))
    if (unknown !== undefined) return fail('Неизвестный показатель финмодели', 400, { code: 'unknown_key', field: String(unknown) })
    if (!ctx.company) return fail(NO_COMPANY, 400, { code: 'no_company' })

    const keys = [...new Set(raw.keys as FinmodelKey[])]
    await verifyFinmodelValues(ctx.sb, { companyId: ctx.company.id, keys, reviewer: { id: ctx.actor.id, name: ctx.actorName } })
    const state = await loadFinmodelForUser(ctx.sb, { userId: ctx.userId, companyId: ctx.company.id })
    await auditPlan(ctx, req, {
      action: FINMODEL_AUDIT.verified, entityType: 'pb_finmodel', entityId: ctx.company.id,
      newValue: Object.fromEntries(keys.map((k) => [k, state.values[k]?.value ?? null])),
      metadata: { keys },
    })
    return NextResponse.json({ ok: true, data: { state } })
  } catch (err) {
    const answer = finmodelFailure(err)
    if (answer) return answer
    console.error('[giga/point-b/finmodel/verify POST]', err instanceof Error ? err.message : err)
    return fail('Не удалось подтвердить значения', 500)
  }
}
