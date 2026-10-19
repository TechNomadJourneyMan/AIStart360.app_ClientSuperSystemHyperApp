/**
 * lib/point-b/model/load.ts — the IO around the model (service-role client): the Point B inputs, the
 * revenue history, the industry template and the goals put into ModelInputs, and the state of the
 * client page. The expert's recompute route and the client's state route both start here, so the same
 * client never gets two different calculations.
 *
 * Reads only. Callers authorise the user / company first.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { expertDisplayName } from '@/lib/expert-review/blocks'
import { goalStart } from '@/lib/goals/evaluate'
import { loadGoals } from '@/lib/goals/store'
import { finmodelStatus, loadFinmodel, type FinmodelState } from '../finmodel/store'
import { loadPointBInputs, type PointBInputs } from '../inputs'
import { companyOfUser } from '../plan/flow'
import { snapshotGoals } from '../plan/goals'
import { loadPlanBundle, type PlanBundle } from '../plan/store'
import type { PlanGoalsSnapshot } from '../plan/types'
import { loadStrategyState } from '../strategy/load'
import { computeModel } from './compute'
import { loadRevenueHistory } from './history'
import { buildModelInputs } from './inputs'
import { templateKeyFor } from './levels'
import type { ModelInputs, PointBState, ScenarioResult, TemplateKey } from './types'

const isMissingTable = (message: string): boolean => /\((42P01|PGRST205)\)/.test(message)

async function industryOf(sb: SupabaseClient, companyId: string | null): Promise<string | null> {
  if (!companyId) return null
  const { data, error } = await sb.from('companies').select('industry').eq('id', companyId).maybeSingle()
  if (error) {
    console.error('[point-b/model] industry not read — the default template is used', error.code ?? 'unknown')
    return null
  }
  return (data as { industry?: string | null } | null)?.industry ?? null
}

/**
 * A goal kept by its label («12m») has no date in the plan snapshot: it counts from the start of its
 * horizon, which only the live goal knows. The start is added to the in-memory copy (never stored), so
 * the model dates the goal exactly; a goal that carries a date is left alone.
 */
async function withStarts(sb: SupabaseClient, companyId: string, goals: PlanGoalsSnapshot): Promise<PlanGoalsSnapshot> {
  if (!goals.items.some((i) => !i.deadline)) return goals
  const live = await loadGoals(sb, companyId)
  const byKey = new Map(live.map((g) => [`${g.metricId}|${g.periodLabel}`, g]))
  return {
    ...goals,
    items: goals.items.map((i) => {
      const g = i.deadline ? undefined : byKey.get(`${i.metricKey}|${i.periodLabel}`)
      const start = g ? goalStart(g) : null
      return start ? { ...i, baselineAt: start } : i
    }),
  }
}

export async function loadModelForCompany(
  sb: SupabaseClient,
  input: { userId: string; companyId: string | null; goals: PlanGoalsSnapshot | null; now?: Date },
): Promise<{ inputs: ModelInputs; pb: PointBInputs }> {
  const now = input.now ?? new Date()
  const pb = await loadPointBInputs(sb, input.userId, { companyId: input.companyId, now })
  const companyId = input.companyId ?? pb.companyId
  const [history, industry, goals] = await Promise.all([
    companyId ? loadRevenueHistory(sb, companyId) : Promise.resolve([] as ModelInputs['history']),
    industryOf(sb, companyId),
    input.goals && companyId ? withStarts(sb, companyId, input.goals) : Promise.resolve(input.goals),
  ])
  const template: TemplateKey = templateKeyFor(industry)
  // Level 2: what the owner and the expert typed, merged with the questionnaire. A failed read means
  // «no finmodel» (the client stays at level 1), never a failed page.
  const finmodel: FinmodelState | null = companyId
    ? await loadFinmodel(sb, { companyId, template, pb }).catch((err) => {
        console.error('[point-b/model] finmodel not read — the calculation stays at level 1', err instanceof Error ? err.message : err)
        return null
      })
    : null
  return { inputs: buildModelInputs({ pb, history, template, goals, now, finmodel }), pb }
}

const EMPTY_BUNDLE: PlanBundle = { plan: null, versions: [], open: null, published: null }

/** The scenarios stored in an approved version; anything that is not a scenario object is dropped. */
function storedScenarios(raw: unknown): ScenarioResult[] {
  return Array.isArray(raw) ? (raw.filter((s) => s && typeof s === 'object' && typeof (s as { key?: unknown }).key === 'string') as ScenarioResult[]) : []
}

/**
 * The state of the client page: the automatic preliminary calculation (always) and the plan of the
 * experts (only the APPROVED version — never a draft or one in review). A user without a company or
 * a goal gets a level-0 result, not an error. Plan tables that are not there yet (migration 125) mean
 * «no plan».
 */
export async function loadPointBState(sb: SupabaseClient, userId: string, opts: { now?: Date } = {}): Promise<PointBState> {
  const now = opts.now ?? new Date()
  const company = await companyOfUser(sb, userId)

  let bundle = EMPTY_BUNDLE
  if (company) {
    try {
      bundle = await loadPlanBundle(sb, company.id)
    } catch (err) {
      if (!isMissingTable(err instanceof Error ? err.message : String(err))) throw err
    }
  }

  const goals = company
    ? await snapshotGoals(sb, company.id, bundle.published?.goals?.primary ?? undefined).catch((err) => {
        console.error('[point-b/model] goals not read — the calculation runs without a goal', err instanceof Error ? err.message : err)
        return null
      })
    : null
  const { inputs, pb } = await loadModelForCompany(sb, { userId, companyId: company?.id ?? null, goals, now })
  const result = computeModel(inputs)

  const published = bundle.published
  const preparing = (goals?.items.length ?? 0) > 0 || !!pb.diagnostic || !!bundle.open
  return {
    access: 'ok',
    // The client sees the preliminary calculation WITHOUT its scenarios: scenarios are the experts' plan (approved version only, spec §6).
    overview: { result: { ...result, scenarios: [] }, labelledAutomatic: true },
    finmodel: finmodelStatus(inputs.finmodel),
    plan: {
      status: published ? 'published' : preparing ? 'preparing' : 'none',
      version: published?.version ?? null,
      selectedScenario: published?.selected_scenario ?? null,
      scenarios: published ? storedScenarios(published.scenarios) : [],
      approvedAt: published ? (published.approved_at ?? published.created_at) : null,
      authorName: published ? expertDisplayName(published.author_name) : null,
      // The strategy of the approved version only, with the live progress of its tasks; a draft's never gets here.
      strategy: published ? await loadStrategyState(sb, userId, published.strategy) : null,
    },
  }
}

/** The warnings of the calculation that are about the finmodel (the expert panel shows them next to the values). */
const FINMODEL_WARNING = /^(Расходы по модели расходятся|Оборотный капитал и налог — допущения|Деньги не рассчитаны)/

export async function loadFinmodelWarnings(sb: SupabaseClient, input: { userId: string; companyId: string; now?: Date }): Promise<string[]> {
  try {
    const goals = await snapshotGoals(sb, input.companyId)
    const { inputs } = await loadModelForCompany(sb, { userId: input.userId, companyId: input.companyId, goals, now: input.now })
    return computeModel(inputs).warnings.filter((w) => FINMODEL_WARNING.test(w))
  } catch (err) {
    console.error('[point-b/model] finmodel warnings not calculated', err instanceof Error ? err.message : err)
    return []
  }
}
