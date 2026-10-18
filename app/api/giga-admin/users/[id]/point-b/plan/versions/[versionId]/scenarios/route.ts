export const dynamic = 'force-dynamic'

import { NextRequest } from 'next/server'
import { z } from 'zod'
import { computeModel } from '@/lib/point-b/model/compute'
import { loadModelForCompany } from '@/lib/point-b/model/load'
import { normalizeProfiles } from '@/lib/point-b/model/profiles'
import { ModelInputError, type ModelResult, type ScenarioProfile } from '@/lib/point-b/model/types'
import { snapshotGoals } from '@/lib/point-b/plan/goals'
import { auditPlan, fail, findVersion, guarded, guardPlanRoute, json, versionNotFound, PLAN_AUDIT } from '@/lib/point-b/plan/route-guard'
import { isEditable } from '@/lib/point-b/plan/status'
import { PlanError, saveScenarios, updateDraft } from '@/lib/point-b/plan/store'

/**
 * POST /api/giga-admin/users/:id/point-b/plan/versions/:versionId/scenarios { profiles? }
 * — the expert recalculates the model for this client and stores the three scenarios in the DRAFT.
 *   `profiles` (the pace profiles the expert edited) are checked; without them the profiles saved in
 *   this draft are reused, else the defaults of the industry template. A version that is not a draft
 *   → 409, an invalid profile → 400 with the text, another expert's client → 403.
 *   → { ok, data: { result: ModelResult, profiles: ScenarioProfile[] } }
 *
 * PATCH … { selectedScenario: 'cautious' | 'moderate' | 'aggressive' | null }
 * — the expert picks the pace of the plan (only among calculated scenarios; only in a draft).
 */
const PostBody = z.object({ profiles: z.unknown().optional() }).strict()
const PatchBody = z.object({ selectedScenario: z.enum(['cautious', 'moderate', 'aggressive']).nullable() }).strict()

export async function POST(req: NextRequest, { params }: { params: { id: string; versionId: string } }) {
  return guarded('giga/point-b/plan/scenarios POST', async () => {
    const g = await guardPlanRoute(req, params.id, { write: true })
    if (!g.ok) return g.response
    const { ctx } = g
    const parsed = PostBody.safeParse((await req.json().catch(() => ({}))) ?? {})
    if (!parsed.success) return fail('Неверный запрос', 400)

    const found = await findVersion(ctx, params.versionId)
    if (!found) return versionNotFound()
    if (!isEditable(found.version.status)) throw new PlanError('not_editable', 'Сценарии считаются только в черновике: версия уже отправлена или одобрена')

    const goals = await snapshotGoals(ctx.sb, ctx.company!.id, found.version.goals?.primary ?? undefined)
    const { inputs, pb } = await loadModelForCompany(ctx.sb, { userId: ctx.userId, companyId: ctx.company!.id, goals })
    let profiles: ScenarioProfile[]
    let result: ModelResult
    try {
      profiles = normalizeProfiles(parsed.data.profiles ?? found.version.assumptions?.profiles, inputs.template)
      result = computeModel(inputs, profiles)
    } catch (err) {
      if (err instanceof ModelInputError) return fail(err.message, 400, { code: 'invalid_profiles' })
      throw err
    }

    const { scenarios, ...summary } = result
    const version = await saveScenarios(ctx.sb, found.version.id, {
      scenarios,
      profiles,
      baseSnapshotId: pb.snapshot?.id ?? null,
      model: summary,
    })
    await auditPlan(ctx, req, {
      action: PLAN_AUDIT.scenariosComputed, entityId: version.id,
      metadata: {
        version: version.version, modelVersion: result.modelVersion, level: result.level, kind: result.kind,
        scenarios: scenarios.length, warnings: result.warnings.length, customProfiles: parsed.data.profiles !== undefined,
      },
    })
    return json({ ok: true, data: { result, profiles } })
  })
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string; versionId: string } }) {
  return guarded('giga/point-b/plan/scenarios PATCH', async () => {
    const g = await guardPlanRoute(req, params.id, { write: true })
    if (!g.ok) return g.response
    const { ctx } = g
    const parsed = PatchBody.safeParse(await req.json().catch(() => null))
    if (!parsed.success) return fail('Темп плана: осторожный, умеренный или агрессивный', 400)

    const found = await findVersion(ctx, params.versionId)
    if (!found) return versionNotFound()
    if (!isEditable(found.version.status)) throw new PlanError('not_editable', 'Темп выбирается только в черновике: версия уже отправлена или одобрена')

    const key = parsed.data.selectedScenario
    if (key !== null) {
      const calculated = (found.version.scenarios ?? []).some((s) => (s as { key?: unknown } | null)?.key === key)
      if (!calculated) return fail('Сначала рассчитайте сценарии — выбрать можно только рассчитанный темп', 400, { code: 'not_calculated' })
    }
    const before = found.version.selected_scenario
    const version = await updateDraft(ctx.sb, found.version.id, { selectedScenario: key })
    await auditPlan(ctx, req, {
      action: PLAN_AUDIT.scenarioSelected, entityId: version.id,
      oldValue: { selectedScenario: before }, newValue: { selectedScenario: version.selected_scenario },
      metadata: { version: version.version },
    })
    return json({ ok: true, data: { selectedScenario: version.selected_scenario } })
  })
}
