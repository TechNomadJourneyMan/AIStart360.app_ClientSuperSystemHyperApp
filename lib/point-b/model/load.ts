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
import { goalStart, type Goal } from '@/lib/goals/evaluate'
import { loadGoals } from '@/lib/goals/store'
import { loadFinmodelFacts, finmodelFromSurvey } from '../finmodel/sources'
import { finmodelStatus, mergeFinmodel, readFinmodelRows, type FinmodelState } from '../finmodel/store'
import { loadPointBInputs, type PointBInputs } from '../inputs'
import { companyOfUser } from '../plan/flow'
import { goalsSnapshotFrom, loadLatestReviews, snapshotGoals } from '../plan/goals'
import { loadPlanBundle, type PlanBundle } from '../plan/store'
import type { PlanGoalsSnapshot } from '../plan/types'
import { loadStrategyState } from '../strategy/load'
import { listActiveInvites } from '../invites/store'
import type { InviteView } from '../invites/types'
import { clientView, listRecommendations, topVerifiedWithAction } from '../recs/store'
import type { Recommendation } from '../recs/types'
import { computeModel } from './compute'
import { loadRevenueHistory } from './history'
import { buildModelInputs } from './inputs'
import { templateKeyFor } from './levels'
import type { ModelInputs, PointBState, ScenarioResult, StrategyState, TemplateKey } from './types'

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
 * The company's goals read once per load: the plan snapshot, the Point B inputs and the dates of the
 * goals all need them (they were read three times, one after another).
 */
export function goalsReader(sb: SupabaseClient, companyId: string): () => Promise<Goal[]> {
  let once: Promise<Goal[]> | null = null
  return () => (once ??= loadGoals(sb, companyId))
}

/**
 * A goal kept by its label («12m») has no date in the plan snapshot: it counts from the start of its
 * horizon, which only the live goal knows. The start is added to the in-memory copy (never stored), so
 * the model dates the goal exactly; a goal that carries a date is left alone.
 */
async function withStarts(readGoals: () => Promise<Goal[]>, goals: PlanGoalsSnapshot): Promise<PlanGoalsSnapshot> {
  if (!goals.items.some((i) => !i.deadline)) return goals
  const live = await readGoals()
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

/** Level 2: what the owner and the expert typed, merged with the questionnaire. */
async function readFinmodel(sb: SupabaseClient, companyId: string) {
  const [rows, facts] = await Promise.all([readFinmodelRows(sb, companyId), loadFinmodelFacts(sb, companyId)])
  return { rows, facts }
}

function finmodelNotRead(err: unknown): null {
  console.error('[point-b/model] finmodel not read — the calculation stays at level 1', err instanceof Error ? err.message : err)
  return null
}

export async function loadModelForCompany(
  sb: SupabaseClient,
  input: {
    userId: string
    companyId: string | null
    /** The plan snapshot of the goals; a promise when the caller is still reading it (read in parallel). */
    goals: PlanGoalsSnapshot | null | Promise<PlanGoalsSnapshot | null>
    now?: Date
    /** The company's goals when the caller reads them too (goalsReader); read here otherwise. */
    readGoals?: () => Promise<Goal[]>
  },
): Promise<{ inputs: ModelInputs; pb: PointBInputs }> {
  const now = input.now ?? new Date()
  const known = input.companyId
  const readGoals = input.readGoals ?? (known ? goalsReader(sb, known) : undefined)
  // The company is known (the page, the expert recompute): every read starts at once — the Point B
  // inputs, the revenue history, the industry, the finmodel rows and facts. Unknown (no company of the
  // user's own): the inputs find it first, as before.
  const pbP = loadPointBInputs(sb, input.userId, { companyId: known, now, goals: readGoals })
  const companyIdP = known ? Promise.resolve(known) : pbP.then((pb) => pb.companyId)
  const [pb, history, industry, goals, finmodelSources] = await Promise.all([
    pbP,
    companyIdP.then((id) => (id ? loadRevenueHistory(sb, id) : ([] as ModelInputs['history']))),
    companyIdP.then((id) => industryOf(sb, id)),
    Promise.all([companyIdP, input.goals]).then(([id, g]) => (g && id ? withStarts(readGoals ?? goalsReader(sb, id), g) : g)),
    // A failed read means «no finmodel» (the client stays at level 1), never a failed page.
    companyIdP.then((id) => (id ? readFinmodel(sb, id).catch(finmodelNotRead) : null)),
  ])
  const template: TemplateKey = templateKeyFor(industry)
  let finmodel: FinmodelState | null = null
  if (finmodelSources) {
    try {
      finmodel = mergeFinmodel({ rows: finmodelSources.rows, survey: finmodelFromSurvey(pb.answers ?? {}), template, facts: finmodelSources.facts })
    } catch (err) {
      finmodel = finmodelNotRead(err)
    }
  }
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

  // With the company known every read below starts at once (one wave, a second one only for what needs
  // the approved version): the page used to wait for eight round trips one after another.
  const readGoals = company ? goalsReader(sb, company.id) : null
  const bundleP: Promise<PlanBundle> = company
    ? loadPlanBundle(sb, company.id).catch((err) => {
        if (!isMissingTable(err instanceof Error ? err.message : String(err))) throw err
        return EMPTY_BUNDLE
      })
    : Promise.resolve(EMPTY_BUNDLE)
  // The goals as the plan snapshot; the primary goal comes from the approved version. A failed read of
  // the goals means «no goal» (logged); a failed plan read fails the page (below), as it always did.
  const goalsP: Promise<PlanGoalsSnapshot | null> = company && readGoals
    ? Promise.all([
        Promise.all([loadLatestReviews(sb, company.id), readGoals()]).catch((err) => {
          console.error('[point-b/model] goals not read — the calculation runs without a goal', err instanceof Error ? err.message : err)
          return null
        }),
        bundleP.catch(() => EMPTY_BUNDLE),
      ]).then(([read, bundle]) => (read ? goalsSnapshotFrom(read[1], read[0], bundle.published?.goals?.primary ?? undefined) : null))
    : Promise.resolve(null)

  const [bundle, goals, { inputs, pb }, strategy, recs, invites] = await Promise.all([
    bundleP,
    goalsP,
    loadModelForCompany(sb, { userId, companyId: company?.id ?? null, goals: goalsP, now, readGoals: readGoals ?? undefined }),
    // The strategy of the approved version only, with the live progress of its tasks; a draft's never gets here.
    bundleP.then((b) => (b.published ? loadStrategyState(sb, userId, b.published.strategy) : null)),
    company ? quietly('recommendations', () => listRecommendations(sb, company.id, { statuses: CLIENT_REC_STATUSES }), [] as Recommendation[]) : Promise.resolve([] as Recommendation[]),
    company ? quietly('invites', () => listActiveInvites(sb, userId, now), [] as InviteView[]) : Promise.resolve([] as InviteView[]),
  ])
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
      strategy,
    },
    recommendations: clientView(recs),
    invites,
    nextStep: nextStepOf(recs, strategy),
  }
}

/** The client never reads rejected recommendations; pending ones are only counted by clientView. */
const CLIENT_REC_STATUSES: Recommendation['status'][] = ['expert_verified', 'stale', 'pending_review']

/**
 * A part of the page that must not fail it: migration 129 not applied (the tables are not there) or a failed read
 * gives the empty value (logged unless it is the missing table).
 */
async function quietly<T>(what: string, run: () => Promise<T>, empty: T): Promise<T> {
  try {
    return await run()
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (!isMissingTable(message)) console.error(`[point-b/model] ${what} not read — shown empty`, message)
    return empty
  }
}

/** «Следующий шаг»: a verified recommendation's next action, else the nearest unfinished task of the strategy. */
export function nextStepOf(recs: Recommendation[], strategy: StrategyState | null): PointBState['nextStep'] {
  const rec = topVerifiedWithAction(recs)
  if (rec) return { title: (rec.nextAction as string).trim(), action: 'recs', recId: rec.id }
  if (!strategy) return null
  const task = strategy.items
    .filter((n) => n.kind === 'task' && ['not_started', 'in_progress'].includes(strategy.progress[n.key]?.state ?? ''))
    .sort((a, b) => (a.dueDate ?? '9999-12-31').localeCompare(b.dueDate ?? '9999-12-31') || a.order - b.order)[0]
  return task ? { title: task.title, action: 'strategy', recId: null } : null
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
