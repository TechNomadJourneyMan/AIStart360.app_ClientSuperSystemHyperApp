export const dynamic = 'force-dynamic'

import { NextRequest } from 'next/server'
import { z } from 'zod'
import { RECS_AI_WARNING_TEXT, generateRecommendations, type RecsAiWarningCode } from '@/lib/point-b/recs/ai'
import { buildRecsContext } from '@/lib/point-b/recs/context'
import { REC_AUDIT, blocksOf, buildRuleDrafts, lastAiRunAt, recFailure, reviewerOf } from '@/lib/point-b/recs/route'
import { createExpertRecommendation, createRecommendations, listRecommendations } from '@/lib/point-b/recs/store'
import type { RecSourceRef, RecStatus } from '@/lib/point-b/recs/types'
import { inviteFromVerifiedRecommendation, runInviteRules } from '@/lib/point-b/invites/run'
import { computeModel } from '@/lib/point-b/model/compute'
import { loadModelForCompany } from '@/lib/point-b/model/load'
import { normalizeProfiles } from '@/lib/point-b/model/profiles'
import type { ScenarioProfile } from '@/lib/point-b/model/types'
import { snapshotGoals } from '@/lib/point-b/plan/goals'
import { auditPlan, fail, guarded, guardPlanRoute, json, NO_COMPANY, type PlanRouteContext } from '@/lib/point-b/plan/route-guard'
import { loadPlanBundle } from '@/lib/point-b/plan/store'
import { readStoredStrategy } from '@/lib/point-b/strategy/load'
import { isRateLimitedKey } from '@/lib/rate-limit'

/**
 * Recommendations of a client's Point B plan for the expert / admin (spec §12; plan Ф6a, Task 6).
 * Needs clients.review and access to this client (guardPlanRoute); writes also forbidTarget.
 *
 * GET  → { ok, data: { items: Recommendation[] (newest first, every status), counts: Record<RecStatus, number> } }
 *
 * POST { action: 'generate_ai' }
 *      the context of the model and of the strategy of the open (else the published) version → the rules
 *      (limiting factor, contradictions) and the AI draft recommendations → stored as pending_review.
 *      AI: at most 10 runs an hour per expert (429), once in 10 minutes per company (warning), the daily AI budget.
 *      → { ok, data: { created: Recommendation[], warnings: string[] } }  (warnings are Russian sentences)
 * POST { action: 'run_rules' }
 *      the invite rules for this client (runInviteRules) → { ok, data: { created: number, skipped: number } }
 * POST { action: 'create', draft: { kind, title, essence?, reason?, … }, scopeNote?: string | null }
 *      the expert's own recommendation, verified at once (the expert is the reviewer) → { ok, data: Recommendation }
 *
 * Errors: { ok: false, error, code?, field? } — 400 (invalid / profanity with the field), 403, 404, 409, 429.
 */
const STATUSES: RecStatus[] = ['pending_review', 'expert_verified', 'expert_rejected', 'stale']
const text = (max: number) => z.string().max(max * 2).nullable().optional()

const Draft = z.object({
  kind: z.enum(['lever', 'risk', 'action', 'contradiction', 'constraint']),
  title: z.string().max(400),
  essence: text(2000),
  reason: text(2000),
  expectedEffect: text(2000),
  resources: text(2000),
  confidence: z.enum(['low', 'medium', 'high']).optional(),
  confidenceReason: text(2000),
  risks: text(2000),
  nextAction: text(2000),
  sourceRefs: z.array(z.object({ type: z.string(), ref: z.string(), label: z.string() })).max(20).optional(),
})
const Body = z.discriminatedUnion('action', [
  z.object({ action: z.literal('generate_ai') }),
  z.object({ action: z.literal('run_rules') }),
  z.object({ action: z.literal('create'), draft: Draft, scopeNote: text(2000), comment: text(2000) }),
])

const AI_HOURLY_LIMIT = 10

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  return guarded('giga/point-b/recommendations GET', async () => {
    const g = await guardPlanRoute(req, params.id)
    if (!g.ok) return g.response
    const { ctx } = g
    const counts = Object.fromEntries(STATUSES.map((s) => [s, 0])) as Record<RecStatus, number>
    if (!ctx.company) return json({ ok: true, data: { items: [], counts } })
    try {
      const items = await listRecommendations(ctx.sb, ctx.company.id)
      for (const r of items) counts[r.status] += 1
      return json({ ok: true, data: { items, counts } })
    } catch (err) {
      const failure = recFailure(err)
      // migration 129 not applied: an empty list, not an error of the page
      if (failure?.status === 503) return json({ ok: true, data: { items: [], counts } })
      throw err
    }
  })
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  return guarded('giga/point-b/recommendations POST', async () => {
    const g = await guardPlanRoute(req, params.id, { write: true })
    if (!g.ok) return g.response
    const { ctx } = g
    const parsed = Body.safeParse(await req.json().catch(() => null))
    if (!parsed.success) return fail('Неверный запрос', 400, { code: 'invalid' })
    if (!ctx.company) return fail(NO_COMPANY, 400)
    const body = parsed.data
    try {
      if (body.action === 'generate_ai') return await generate(req, ctx)
      if (body.action === 'run_rules') {
        const r = await runInviteRules(ctx.sb, { userId: ctx.userId, companyId: ctx.company.id, now: new Date() })
        await auditPlan(ctx, req, { action: REC_AUDIT.rulesRun, entityType: 'company', entityId: ctx.company.id, metadata: r })
        return json({ ok: true, data: r })
      }
      const reviewer = await reviewerOf(ctx)
      const bundle = await loadPlanBundle(ctx.sb, ctx.company.id)
      const rec = await createExpertRecommendation(ctx.sb, {
        companyId: ctx.company.id,
        versionId: (bundle.open ?? bundle.published)?.id ?? null,
        // the refs are checked by the store (known types only, cut)
        draft: { ...body.draft, sourceRefs: body.draft.sourceRefs as RecSourceRef[] | undefined },
        reviewer,
        scopeNote: body.scopeNote ?? null,
      })
      await inviteFromVerifiedRecommendation(ctx.sb, { rec, userId: ctx.userId, now: new Date() })
      await auditPlan(ctx, req, {
        action: REC_AUDIT.created, entityType: 'pb_recommendation', entityId: rec.id,
        newValue: { status: rec.status, kind: rec.kind }, metadata: { title: rec.title.slice(0, 120), scopeNote: rec.scopeNote },
      })
      return json({ ok: true, data: rec })
    } catch (err) {
      const failure = recFailure(err)
      if (failure) return failure
      throw err
    }
  })
}

const warningText = (w: string): string => (w in RECS_AI_WARNING_TEXT ? RECS_AI_WARNING_TEXT[w as RecsAiWarningCode] : w)

async function generate(req: NextRequest, ctx: PlanRouteContext) {
  const company = ctx.company!
  if (await isRateLimitedKey(ctx.actor.id, 'pb-recs-ai', { max: AI_HOURLY_LIMIT, windowMs: 3_600_000 })) {
    return fail(`ИИ-рекомендации можно запускать не чаще ${AI_HOURLY_LIMIT} раз в час — попробуйте позже`, 429, { code: 'rate_limited' })
  }
  const now = new Date()
  const bundle = await loadPlanBundle(ctx.sb, company.id)
  const version = bundle.open ?? bundle.published
  const goals = await snapshotGoals(ctx.sb, company.id, version?.goals?.primary ?? undefined)
  const { inputs, pb } = await loadModelForCompany(ctx.sb, { userId: ctx.userId, companyId: company.id, goals, now })
  let profiles: ScenarioProfile[] | undefined
  try {
    profiles = version?.assumptions?.profiles ? normalizeProfiles(version.assumptions.profiles, inputs.template) : undefined
  } catch {
    profiles = undefined
  }
  const result = computeModel(inputs, profiles)
  const blocks = blocksOf(pb)
  const selectedScenario = version?.selected_scenario ?? null
  const primary = goals.items.find((i) => goals.primary && i.metricKey === goals.primary.metricKey && i.periodLabel === goals.primary.periodLabel)
  const context = buildRecsContext({
    result, selectedScenario, blocks,
    strategyOutline: readStoredStrategy(version?.strategy ?? {}).items.filter((n) => n.kind !== 'task').map((n) => n.title),
    goalText: primary?.label ?? null,
  })
  const rules = buildRuleDrafts({ result, selectedScenario, blocks, inputsHash: context.inputsHash })

  // Once in 10 minutes per company: the shared rate key, and the newest AI recommendation as a second guard.
  const companyLimited = await isRateLimitedKey(company.id, 'pb-recs-ai-company', { max: 1, windowMs: 600_000 })
  const ai = await generateRecommendations({
    sb: ctx.sb, companyId: company.id, userId: ctx.actor.id, context, now,
    lastAiRunAt: companyLimited ? now.toISOString() : await lastAiRunAt(ctx.sb, company.id),
  })
  const items = [...rules, ...ai.items]
  const created = await createRecommendations(ctx.sb, { companyId: company.id, versionId: version?.id ?? null, items })
  const warnings = ai.warnings.map(warningText)
  if (items.length > created.length) warnings.push(`Уже есть на проверке или проверены: ${items.length - created.length} — повтор не сохранён.`)
  if (!items.length && !ai.warnings.length) warnings.push('Правила и ИИ не нашли, что предложить по текущим данным.')

  await auditPlan(ctx, req, {
    action: REC_AUDIT.generated, entityType: 'company', entityId: company.id,
    metadata: {
      created: created.length, rules: rules.length, ai: ai.items.length, level: result.level, versionId: version?.id ?? null,
      warnings: ai.warnings.filter((w) => w in RECS_AI_WARNING_TEXT), costUsd: ai.usage?.costUsd ?? null, model: ai.usage?.model ?? null,
    },
  })
  return json({ ok: true, data: { created, warnings } })
}
