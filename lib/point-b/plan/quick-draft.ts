/**
 * lib/point-b/plan/quick-draft.ts — «Собрать черновик плана» in one click (R3, M1). Admin / Super Admin (the
 * PO's decision: they prepare and approve plans while there are no experts) get a DRAFT version that only needs
 * their review:
 *
 *   1. the model on today's data (the same loader as the client page and the recompute) — level 0 or no scenarios
 *      → PlanError('conditions') with what is missing: an empty plan is never invented;
 *   2. the open DRAFT is completed, else a new draft (a snapshot of the live goals; the content of the published
 *      version copied — flow.createPlanDraft) with the reason «Первая версия плана» (or «Обновление плана…»);
 *      a version already in review → PlanError('not_editable');
 *   3. the three scenarios of the model + the pace «умеренный» (an already chosen calculated pace is kept);
 *   4. an EMPTY strategy gets the rule tree (strategy/draft.ts: the levers of the model, the limiting factor, TOP-5
 *      GRI) reworded by the AI without invented numbers (strategy/ai-wording.ts); a strategy the staff already
 *      wrote is never overwritten;
 *   5. recommendations of the rules (+ the AI's, under their own guards) stored as pending_review for the version.
 * The AI calls (wording, recommendations) run in parallel, each bounded by the gateway timeout (45 s) and the actor's
 * daily AI budget; without a key the draft is built by the rules alone (a warning says so). One click = one model
 * calculation: no background or mass generation. Nothing here approves: approval stays a person's act (flow.ts), and
 * it needs the scenarios and the pace (status.ts).
 *
 * Service-role client; the route authorises the actor (approver) and the client first.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { computeModel } from '../model/compute'
import { loadModelForCompany } from '../model/load'
import { normalizeProfiles } from '../model/profiles'
import type { ModelResult, ScenarioProfile } from '../model/types'
import { RECS_AI_WARNING_TEXT, generateRecommendations, type RecsAiWarningCode } from '../recs/ai'
import { buildRecsContext } from '../recs/context'
import { blocksOf, buildRuleDrafts, lastAiRunAt } from '../recs/route'
import { createRecommendations } from '../recs/store'
import { WORDING_WARNING_TEXT, wordStrategyWithAi, type WordingWarningCode } from '../strategy/ai-wording'
import { buildRuleStrategy, draftCounts } from '../strategy/draft'
import { readStoredStrategy } from '../strategy/load'
import { createPlanDraft, type PlanActor } from './flow'
import { snapshotGoals } from './goals'
import { calculatedScenarioKeys } from './status'
import { loadPlanBundle, PlanError, saveScenarios, updateDraft } from './store'
import type { PlanVersionRow } from './types'

export const QUICK_DRAFT_REASON_FIRST = 'Первая версия плана'
export const QUICK_DRAFT_REASON_UPDATE = 'Обновление плана по текущим данным'
export const QUICK_DRAFT_PACE = 'moderate'
export const QUICK_DRAFT_IN_REVIEW = 'Версия плана уже на одобрении — одобрите её или верните с комментарием, затем соберите черновик заново'
export const QUICK_DRAFT_NO_DATA = 'Недостаточно данных для сценариев — черновик не собран'

export interface QuickDraftInput {
  companyId: string
  /** The client (owner of the company). */
  userId: string
  author: PlanActor
  now: Date
  /** false = the rules only (no AI call at all). Default true. */
  ai?: boolean
  /** Test seams. */
  wording?: typeof wordStrategyWithAi
  recsAi?: typeof generateRecommendations
}

export interface QuickDraftResult {
  version: PlanVersionRow
  /** A new version was created (false = the open draft was completed). */
  created: boolean
  level: ModelResult['level']
  scenarios: number
  selectedScenario: string | null
  strategy: { filled: boolean; strategies: number; initiatives: number; tasks: number; milestones: number; reworded: number }
  recommendations: { created: number; rules: number; ai: number }
  /** Russian sentences for the staff member. */
  warnings: string[]
  ai: { costUsd: number | null; model: string | null }
}

const isMissingTable = (message: string): boolean => /\((42P01|PGRST205)\)/.test(message)

function profilesOf(raw: unknown, template: Parameters<typeof normalizeProfiles>[1]): ScenarioProfile[] {
  try {
    return normalizeProfiles(raw ?? undefined, template)
  } catch {
    return normalizeProfiles(undefined, template) // stored profiles that do not validate any more: the defaults
  }
}

/** The pace of the draft: the one already chosen if it was calculated, else «умеренный», else the first feasible. */
export function pickDraftPace(result: ModelResult, current: string | null): string | null {
  const keys = calculatedScenarioKeys(result.scenarios)
  if (current && keys.includes(current)) return current
  if (keys.includes(QUICK_DRAFT_PACE)) return QUICK_DRAFT_PACE
  return result.scenarios.find((s) => s.feasible)?.key ?? keys[0] ?? null
}

export async function buildQuickDraft(sb: SupabaseClient, input: QuickDraftInput): Promise<QuickDraftResult> {
  const { companyId, userId, now } = input
  const useAi = input.ai !== false
  const bundle = await loadPlanBundle(sb, companyId)
  if (bundle.open && bundle.open.status !== 'draft') throw new PlanError('not_editable', QUICK_DRAFT_IN_REVIEW)

  // 1. The model first: nothing is written when the data cannot carry a plan.
  const base = bundle.open ?? bundle.published
  const goals = await snapshotGoals(sb, companyId, base?.goals?.primary ?? undefined)
  const { inputs, pb } = await loadModelForCompany(sb, { userId, companyId, goals, now })
  const profiles = profilesOf(base?.assumptions?.profiles, inputs.template)
  const result = computeModel(inputs, profiles)
  if (result.level < 1 || !result.scenarios.length) {
    const missing = result.missing.filter((m) => m.level === 1).map((m) => m.label)
    throw new PlanError('conditions', QUICK_DRAFT_NO_DATA, missing.length ? missing.map((m) => `Нужно: ${m}`) : ['Нужны цель по выручке и текущая выручка'])
  }

  // 2. The draft.
  const reason = bundle.published ? QUICK_DRAFT_REASON_UPDATE : QUICK_DRAFT_REASON_FIRST
  let version: PlanVersionRow
  let created = false
  if (bundle.open) {
    version = bundle.open
  } else {
    version = (await createPlanDraft(sb, { companyId, userId, author: input.author, changeReason: reason })).version
    created = true
  }

  // 3. Scenarios + pace.
  const selected = pickDraftPace(result, version.selected_scenario)
  const { scenarios, ...summary } = result
  version = await saveScenarios(sb, version.id, {
    scenarios, profiles, baseSnapshotId: pb.snapshot?.id ?? null, model: summary, selectedScenario: selected,
  })

  // 4–5. Strategy (only when empty) and recommendations, the two AI calls side by side.
  const blocks = blocksOf(pb)
  const primary = goals.items.find((i) => goals.primary && i.metricKey === goals.primary.metricKey && i.periodLabel === goals.primary.periodLabel)
  const stored = readStoredStrategy(version.strategy ?? {})
  const rule = stored.items.length ? null : buildRuleStrategy({ result, selectedScenario: selected, blocks, griTop5: pb.griTop5 ?? null, now })
  const outline = (rule ?? stored).items.filter((n) => n.kind !== 'task').map((n) => n.title)
  const wordingContext = buildRecsContext({ result, selectedScenario: selected, blocks, strategyOutline: [], goalText: primary?.label ?? null })
  const recsContext = buildRecsContext({ result, selectedScenario: selected, blocks, strategyOutline: outline, goalText: primary?.label ?? null })
  const warnings: string[] = []

  const wordingP = rule && rule.items.length && useAi
    ? (input.wording ?? wordStrategyWithAi)({ strategy: rule, context: wordingContext, actorId: input.author.id })
    : Promise.resolve(rule ? { strategy: rule, warnings: [] as string[], usage: null, reworded: 0 } : null)
  const recsAiP = useAi
    ? lastAiRunAt(sb, companyId).then((last) => (input.recsAi ?? generateRecommendations)({ sb, companyId, userId: input.author.id, context: recsContext, lastAiRunAt: last, now }))
    : Promise.resolve(null)
  const [wording, recsAi] = await Promise.all([wordingP, recsAiP])

  let strategy = { filled: false, ...draftCounts(stored), reworded: 0 }
  if (wording) {
    warnings.push(...wording.warnings.map((w) => (w in WORDING_WARNING_TEXT ? WORDING_WARNING_TEXT[w as WordingWarningCode] : w)))
    version = await updateDraft(sb, version.id, { strategy: wording.strategy })
    strategy = { filled: true, ...draftCounts(wording.strategy), reworded: wording.reworded }
  }
  if (!version.change_reason?.trim()) version = await updateDraft(sb, version.id, { changeReason: reason })

  const rules = buildRuleDrafts({ result, selectedScenario: selected, blocks, inputsHash: recsContext.inputsHash })
  const aiItems = recsAi?.items ?? []
  if (recsAi) {
    for (const w of recsAi.warnings) {
      // «too_soon» is not a failure of this click: the AI recommendations of the last 10 minutes are kept.
      if (w === 'too_soon' || w === 'no_api_key') continue
      warnings.push(w in RECS_AI_WARNING_TEXT ? `Рекомендации: ${RECS_AI_WARNING_TEXT[w as RecsAiWarningCode]}` : w)
    }
  }
  let createdRecs = 0
  try {
    createdRecs = (await createRecommendations(sb, { companyId, versionId: version.id, items: [...rules, ...aiItems] })).length
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (!isMissingTable(message)) throw err
    warnings.push('Рекомендации Точки Б ещё не включены на сервере — черновик собран без них.')
  }

  const cost = [wording?.usage?.costUsd, recsAi?.usage?.costUsd].filter((c): c is number => typeof c === 'number')
  return {
    version,
    created,
    level: result.level,
    scenarios: scenarios.length,
    selectedScenario: version.selected_scenario,
    strategy,
    recommendations: { created: createdRecs, rules: rules.length, ai: aiItems.length },
    warnings,
    ai: { costUsd: cost.length ? cost.reduce((a, b) => a + b, 0) : null, model: wording?.usage?.model ?? recsAi?.usage?.model ?? null },
  }
}
