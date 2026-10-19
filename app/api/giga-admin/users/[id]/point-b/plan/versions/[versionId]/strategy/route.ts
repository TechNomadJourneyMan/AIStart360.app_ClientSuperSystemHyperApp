export const dynamic = 'force-dynamic'

import { NextRequest } from 'next/server'
import { auditPlan, fail, findVersion, guarded, guardPlanRoute, json, versionNotFound, PLAN_AUDIT } from '@/lib/point-b/plan/route-guard'
import { isEditable } from '@/lib/point-b/plan/status'
import { PlanError, saveStrategy } from '@/lib/point-b/plan/store'
import { strategyCounts, validateStrategy } from '@/lib/point-b/strategy/validate'

/**
 * PUT /api/giga-admin/users/:id/point-b/plan/versions/:versionId/strategy { strategy: { items, milestones } }
 *   → { ok, data: { strategy, version } }
 *
 * The expert / admin saves the whole strategy tree (strategy → initiative → task, milestones) into a
 * DRAFT. The tree REPLACES the stored one (a node that is not sent is gone). The server validates it
 * again (lib/point-b/strategy/validate.ts): a refused tree → 400 { error, field, code } and nothing is
 * written (`field` like `items[3].dependsOn[0]`; code `profanity` for obscene text). A version that is
 * in review, approved or replaced → 409 (an approved version is immutable: a change is a new draft); a
 * version of another client → 404; an expert of another client → 403. The tasks reach the client's
 * action plan only when the version is published (approve), never from here.
 * Audit: point_b.strategy.saved with the node counts before and after.
 * The strategy of a draft is read with GET …/plan (staff only); the client sees the approved one in
 * GET /api/v1/point-b/state.
 */
export async function PUT(req: NextRequest, { params }: { params: { id: string; versionId: string } }) {
  return guarded('giga/point-b/plan/strategy PUT', async () => {
    const g = await guardPlanRoute(req, params.id, { write: true })
    if (!g.ok) return g.response
    const { ctx } = g

    const raw: unknown = await req.json().catch(() => null)
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw) || !('strategy' in raw)) {
      return fail('Передайте стратегию: { strategy: { items, milestones } }', 400, { code: 'invalid_strategy', field: 'strategy' })
    }

    const found = await findVersion(ctx, params.versionId)
    if (!found) return versionNotFound()
    if (!isEditable(found.version.status)) {
      throw new PlanError('not_editable', 'Стратегия правится только в черновике: версия уже отправлена или одобрена — для изменений создайте новую версию')
    }

    const checked = validateStrategy((raw as { strategy: unknown }).strategy)
    if (!checked.ok) {
      return fail(checked.error, 400, { code: checked.profanity ? 'profanity' : 'invalid_strategy', field: checked.field })
    }

    const before = strategyCounts(found.version.strategy)
    const version = await saveStrategy(ctx.sb, found.version.id, checked.strategy)
    await auditPlan(ctx, req, {
      action: PLAN_AUDIT.strategySaved, entityId: version.id,
      oldValue: before, newValue: strategyCounts(version.strategy),
      metadata: { version: version.version, ...strategyCounts(version.strategy) },
    })
    return json({ ok: true, data: { strategy: version.strategy, version } })
  })
}
