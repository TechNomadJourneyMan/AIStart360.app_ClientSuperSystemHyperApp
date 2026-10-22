/**
 * lib/point-b/planfact/recompute.ts — the recompute of ONE company (spec §14; plan Ф6b, Task 3). The scheduled
 * function and the staff button both run exactly this, one company per short step.
 *
 *   1. the APPROVED plan version (none → 'no_plan': nothing is written)
 *   2. the model on today's facts: the Point B inputs + the revenue months of the reconciliation, the pace profiles of
 *      the approved version
 *   3. inputs_hash of (version, model inputs, reconciliation facts, months). Unchanged and the checkpoint of the last
 *      finished month exists → 'unchanged' (skipped, nothing written) unless `force`
 *   4. checkpoints of the last finished month and the current one (one upsert)
 *   5. mode 'full' only: recommendations whose data changed → stale (Ф6a markStale, the hash of the recommendation
 *      context); the invite rules of Ф6a with the plan-fact rules (deviation, milestone reached); on a material
 *      deviation (the last finished month is «отстаём») a DRAFT revision of the plan when no version is open — never
 *      approved here (only people approve, flow of Ф1) — and the expert is notified
 * Budget: the whole thing runs under `budgetMs` (default 45 s); past it the company is 'failed' with 'timeout' and
 * the batch goes on. Nothing holds a connection between steps (all reads are short PostgREST calls).
 */
import { createHash } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { runInviteRules } from '../invites/run'
import { computeModel } from '../model/compute'
import { loadModelForCompany } from '../model/load'
import { normalizeProfiles } from '../model/profiles'
import { MODEL_VERSION, type ModelInputs, type ModelResult, type ScenarioProfile } from '../model/types'
import { snapshotGoals } from '../plan/goals'
import { createDraft, loadPlanBundle, PlanError, type PlanBundle } from '../plan/store'
import type { PlanVersionRow } from '../plan/types'
import { buildRecsContext } from '../recs/context'
import { blocksOf } from '../recs/route'
import { markStale } from '../recs/store'
import { readStoredStrategy } from '../strategy/load'
import { loadActuals, withReconciledHistory } from './actuals'
import { buildCheckpoint } from './checkpoint'
import { planFactCandidates } from './insights'
import { lastFinishedPeriod, periodOf } from './kpis'
import { notifyDeviation } from './notify'
import { checkpointToRow, isMissingTable, readCheckpointHash, upsertCheckpoints, type MonthlyFactRow } from './store'
import { DEFAULT_TOLERANCES, type Checkpoint, type PlanFactVerdict, type Tolerances } from './types'

export const COMPANY_BUDGET_MS = 45_000
export const SYSTEM_AUTHOR = 'Пересчёт Точки Б'

export interface RecomputeInput {
  companyId: string
  /** The owner of the company (the client). */
  userId: string
  now: Date
  /** 'full' — the scheduled run and the button; 'checkpoint' — after a saved «Факт за месяц» (checkpoints only). */
  mode?: 'full' | 'checkpoint'
  /** Recompute even when the inputs did not change. */
  force?: boolean
  tolerances?: Tolerances
  budgetMs?: number
}

export interface RecomputeOutcome {
  companyId: string
  status: 'done' | 'unchanged' | 'no_plan' | 'failed'
  period?: string
  overall?: PlanFactVerdict
  reason?: string
  computedAt?: string
  staleRecs?: number
  invites?: { created: number; skipped: number }
  draft?: { created: boolean; versionId: string | null; version: number | null }
  error?: string
}

const msg = (err: unknown): string => (err instanceof Error ? err.message : String(err))

/** Deterministic JSON (sorted keys), so the same inputs give the same hash. */
function stable(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`
  if (v && typeof v === 'object') return `{${Object.keys(v as object).sort().map((k) => `${JSON.stringify(k)}:${stable((v as Record<string, unknown>)[k])}`).join(',')}}`
  return JSON.stringify(v ?? null)
}

export function planFactHash(input: { versionId: string; inputs: ModelInputs; monthly: MonthlyFactRow[]; periods: string[] }): string {
  const { now: _now, ...inputs } = input.inputs
  const monthly = input.monthly.map((r) => [r.period, r.metric, Number(r.value)]).sort((a, b) => String(a).localeCompare(String(b)))
  return createHash('sha256').update(stable({ v: input.versionId, m: MODEL_VERSION, inputs, monthly, periods: input.periods })).digest('hex').slice(0, 40)
}

function profilesOf(version: Pick<PlanVersionRow, 'assumptions'> | null, template: ModelInputs['template']): ScenarioProfile[] | undefined {
  try {
    return version?.assumptions?.profiles ? normalizeProfiles(version.assumptions.profiles, template) : undefined
  } catch {
    return undefined // stored profiles that do not validate any more: the defaults of the template
  }
}

function withBudget<T>(ms: number, run: () => Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  return Promise.race([
    run().finally(() => { if (timer) clearTimeout(timer) }),
    new Promise<T>((_, reject) => { timer = setTimeout(() => reject(new Error('timeout')), ms) }),
  ])
}

export async function recomputeCompany(sb: SupabaseClient, input: RecomputeInput): Promise<RecomputeOutcome> {
  try {
    return await withBudget(input.budgetMs ?? COMPANY_BUDGET_MS, () => recompute(sb, input))
  } catch (err) {
    const error = msg(err)
    if (!isMissingTable(error)) console.error('[point-b/planfact] recompute failed', input.companyId, error)
    return { companyId: input.companyId, status: 'failed', error: isMissingTable(error) ? 'not_ready' : error.slice(0, 300) }
  }
}

async function recompute(sb: SupabaseClient, input: RecomputeInput): Promise<RecomputeOutcome> {
  const { companyId, userId, now } = input
  const mode = input.mode ?? 'full'
  const bundle = await loadPlanBundle(sb, companyId)
  const published = bundle.published
  if (!published || !bundle.plan) return { companyId, status: 'no_plan' }

  const prev = lastFinishedPeriod(now)
  const cur = periodOf(now)
  const periods = [prev, cur]

  const goals = await snapshotGoals(sb, companyId, published.goals?.primary ?? undefined)
  const [{ inputs: raw, pb }, actuals] = await Promise.all([
    loadModelForCompany(sb, { userId, companyId, goals, now }),
    loadActuals(sb, companyId, periods),
  ])
  // The reconciliation's revenue months complete the history the model forecasts from (only here: Point A is untouched).
  const inputs: ModelInputs = { ...raw, history: withReconciledHistory(raw.history, actuals.monthly) }
  const hash = planFactHash({ versionId: published.id, inputs, monthly: actuals.monthly, periods })
  if (!input.force) {
    const existing = await readCheckpointHash(sb, published.id, prev)
    if (existing && existing.hash === hash) return { companyId, status: 'unchanged', period: prev, computedAt: existing.computedAt ?? undefined }
  }

  const result: ModelResult = computeModel(inputs, profilesOf(published, inputs.template))
  const tolerances = input.tolerances ?? DEFAULT_TOLERANCES
  const checkpoints: Checkpoint[] = periods.map((period) => buildCheckpoint({
    version: published, period, actual: actuals.byPeriod[period]?.values ?? {}, actualSources: actuals.byPeriod[period]?.sources ?? {},
    result, tolerances, now,
  }))
  await upsertCheckpoints(sb, checkpoints.map((c) => checkpointToRow(c, { companyId, planId: bundle.plan!.id, inputsHash: hash })))
  const finished = checkpoints[0]
  const out: RecomputeOutcome = { companyId, status: 'done', period: prev, overall: finished.overall, reason: finished.reason, computedAt: now.toISOString() }
  if (mode === 'checkpoint') return out

  out.staleRecs = await markStaleRecommendations(sb, { bundle, inputs, pb, companyId })
  const strategy = readStoredStrategy(published.strategy ?? {})
  out.invites = await runInviteRules(sb, {
    userId, companyId, now, extra: planFactCandidates({ checkpoint: finished, milestones: strategy.milestones, now }),
  })
  if (finished.overall === 'behind') {
    out.draft = await proposeRevision(sb, { bundle, published, goals, reason: finished.reason, period: prev })
    await notifyDeviation(sb, { userId, companyId, period: prev, reason: finished.reason, draftCreated: out.draft.created, draftVersion: out.draft.version })
  }
  return out
}

/**
 * Ф6a stale mechanism: the recommendations were generated against the context of the open (else the published)
 * version; the same context on today's data gives today's hash, and every live recommendation with another hash
 * becomes stale. Migration 129 not applied → 0.
 */
async function markStaleRecommendations(
  sb: SupabaseClient, input: { bundle: PlanBundle; inputs: ModelInputs; pb: Parameters<typeof blocksOf>[0]; companyId: string },
): Promise<number> {
  try {
    const version = input.bundle.open ?? input.bundle.published
    const result = computeModel(input.inputs, profilesOf(version, input.inputs.template))
    const ctx = buildRecsContext({ result, selectedScenario: version?.selected_scenario ?? null, blocks: blocksOf(input.pb), strategyOutline: [], goalText: null })
    return await markStale(sb, input.companyId, ctx.inputsHash)
  } catch (err) {
    if (!isMissingTable(msg(err))) console.error('[point-b/planfact] stale recommendations not marked', msg(err))
    return 0
  }
}

export const revisionReasonPrefix = (period: string): string => `Предложение пересмотра по план-факту (${period}):`

/** A DRAFT revision copied from the approved version (one open version per plan: an open one is left as it is). */
async function proposeRevision(
  sb: SupabaseClient,
  input: { bundle: PlanBundle; published: PlanVersionRow; goals: Awaited<ReturnType<typeof snapshotGoals>>; reason: string; period: string },
): Promise<NonNullable<RecomputeOutcome['draft']>> {
  if (input.bundle.open) return { created: false, versionId: input.bundle.open.id, version: input.bundle.open.version }
  // At most one proposal per month: a proposal of this month already handled by the experts is not repeated.
  const prefix = revisionReasonPrefix(input.period)
  if (input.bundle.versions.some((v) => v.author_kind === 'system' && (v.change_reason ?? '').startsWith(prefix))) {
    return { created: false, versionId: null, version: null }
  }
  try {
    const draft = await createDraft(sb, input.bundle.plan!, {
      goals: input.goals,
      baseSnapshotId: input.published.base_snapshot_id,
      author: { id: null, name: SYSTEM_AUTHOR, kind: 'system' },
      changeReason: `${prefix} ${input.reason}`.slice(0, 2000),
      fromVersion: input.published,
    })
    return { created: true, versionId: draft.id, version: draft.version }
  } catch (err) {
    if (err instanceof PlanError && err.code === 'open_exists') return { created: false, versionId: null, version: null }
    console.error('[point-b/planfact] revision draft not created', msg(err))
    return { created: false, versionId: null, version: null }
  }
}
