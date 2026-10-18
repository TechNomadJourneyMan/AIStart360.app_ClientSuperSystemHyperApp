/**
 * lib/point-b/plan/goals.ts — verification of the owner's goals by an expert and
 * the owner's agreement (spec §6). Goals live in public.metric_targets
 * (lib/goals/store.ts, not changed); pb_goal_reviews is the append-only history
 * of reviews, the LATEST row of a (metric, period) is its status, no rows =
 * 'owner_draft'.
 *
 *   verify   the expert confirms the goal as it is            → 'verified'
 *   correct  the owner has NO goal: the expert sets it right away (source
 *            'expert', owner is notified by the caller)        → 'verified', appliedDirectly
 *            the owner HAS a goal: a PROPOSAL, metric_targets is untouched until the owner agrees
 *                                                                → 'corrected'
 *   reject   the expert rejects the goal (a reason is required)  → 'disputed'
 *   owner    accepts the proposal (the value is applied)         → 'agreed'
 *            disputes it (the goal stays as it is)               → 'disputed'
 *   14 days  with no answer an expert / admin may apply the proposal; it becomes
 *            'verified' with applied_without_agreement = true (visible in the version and audit)
 *
 * A 'verified' / 'agreed' row stores the value it verified in proposed_value; if the owner
 * changes the goal afterwards the status is no longer trusted and reads as 'owner_draft'
 * (the expert has to look at the new value).
 *
 * Service-role client; the callers authorise the actor. Profanity filter on `reason`.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { emitPlatformEventSafely } from '@/lib/events/platform'
import type { Goal } from '@/lib/goals/evaluate'
import { loadGoals, REVENUE_GOAL_METRIC, upsertGoal } from '@/lib/goals/store'
import { getMetricById } from '@/lib/metrics/registry'
import { assertClean } from '@/lib/moderation/profanity'
import { PlanError } from './store'
import type { GoalReviewRow, GoalReviewStatus, PlanGoalItem, PlanGoalsSnapshot } from './types'

/** A correction the owner did not answer for this long may be applied by staff (§6). */
export const STALE_CORRECTION_DAYS = 14
const DAY_MS = 24 * 60 * 60 * 1000
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

export const goalKey = (metricKey: string, periodLabel: string): string => `${metricKey}|${periodLabel}`

function dbError(op: string, error: { code?: string } | null | undefined): Error {
  return new Error(`point-b goals: ${op} failed (${error?.code ?? 'unknown'})`)
}

function invalid(message: string): PlanError {
  return new PlanError('conditions', message, [message])
}

const sameNumber = (a: unknown, b: unknown): boolean => {
  const x = Number(a), y = Number(b)
  return Number.isFinite(x) && Number.isFinite(y) && Math.abs(x - y) <= 1e-6 * Math.max(1, Math.abs(x), Math.abs(y))
}

/** Status of a goal given its latest review row and the goal as it is now. */
function effectiveStatus(row: GoalReviewRow, goal: Goal | undefined): GoalReviewStatus {
  if ((row.status === 'verified' || row.status === 'agreed') && row.proposed_value !== null && goal && !sameNumber(goal.targetValue, row.proposed_value)) {
    return 'owner_draft' // the owner changed the goal after it was verified
  }
  return row.status
}

/** The latest review row of every goal of the company, key `${metricKey}|${periodLabel}`. */
export async function loadLatestReviews(sb: SupabaseClient, companyId: string): Promise<Map<string, GoalReviewRow>> {
  const { data, error } = await sb.from('pb_goal_reviews').select('*').eq('company_id', companyId).order('created_at', { ascending: false })
  if (error) throw dbError('read reviews', error)
  const out = new Map<string, GoalReviewRow>()
  for (const r of (data ?? []) as GoalReviewRow[]) {
    const k = goalKey(r.metric_key, r.period_label)
    if (!out.has(k)) out.set(k, r) // newest first: the first row of a key wins
  }
  return out
}

/** Status per goal (key `${metricKey}|${periodLabel}`); a goal without review rows is 'owner_draft'. */
export async function loadGoalStatuses(sb: SupabaseClient, companyId: string): Promise<Map<string, GoalReviewStatus>> {
  const [reviews, goals] = await Promise.all([loadLatestReviews(sb, companyId), loadGoals(sb, companyId)])
  const byKey = new Map(goals.map((g) => [goalKey(g.metricId, g.periodLabel), g]))
  const out = new Map<string, GoalReviewStatus>()
  for (const k of byKey.keys()) out.set(k, 'owner_draft')
  for (const [k, row] of reviews) out.set(k, effectiveStatus(row, byKey.get(k)))
  return out
}

/** The goals of the company as a plan snapshot, each with its review status. */
export async function snapshotGoals(
  sb: SupabaseClient, companyId: string, primary?: { metricKey: string; periodLabel: string } | null,
): Promise<PlanGoalsSnapshot> {
  const [reviews, goals] = await Promise.all([loadLatestReviews(sb, companyId), loadGoals(sb, companyId)])
  const items: PlanGoalItem[] = goals.map((g) => {
    const row = reviews.get(goalKey(g.metricId, g.periodLabel))
    const item: PlanGoalItem = {
      metricKey: g.metricId,
      periodLabel: g.periodLabel,
      label: g.label,
      baselineValue: g.baselineValue,
      baselinePeriod: g.baselinePeriod,
      targetValue: g.targetValue,
      deadline: g.deadline,
      reviewStatus: row ? effectiveStatus(row, g) : 'owner_draft',
    }
    if (row?.applied_without_agreement && item.reviewStatus !== 'owner_draft') item.appliedWithoutAgreement = true
    return item
  })
  // The default primary goal (revenue, 12 months) only counts when the company has it.
  const resolved = primary !== undefined
    ? primary
    : items.some((i) => i.metricKey === REVENUE_GOAL_METRIC && i.periodLabel === '12m')
      ? { metricKey: REVENUE_GOAL_METRIC, periodLabel: '12m' }
      : null
  return { primary: resolved, items }
}

async function insertReview(sb: SupabaseClient, row: Record<string, unknown>): Promise<GoalReviewRow> {
  const { data, error } = await sb.from('pb_goal_reviews').insert(row).select('*').single()
  if (error || !data) throw dbError('write review', error)
  return data as GoalReviewRow
}

function targetChanged(companyId: string, goal: Goal, actor: string): void {
  try {
    emitPlatformEventSafely({
      name: 'TARGET_CHANGED', companyId, subjectType: 'goal', subjectId: goal.id, actor,
      payload: { metric: goal.metricId, target: goal.targetValue, period: goal.periodLabel },
      dedupeKey: `target_changed:${goal.id}:${Date.now()}`,
    })
  } catch (err) {
    console.error('[point-b/goals] TARGET_CHANGED not emitted', err instanceof Error ? err.message : err)
  }
}

export interface ReviewGoalInput {
  companyId: string
  metricKey: string
  periodLabel: string
  action: 'verify' | 'correct' | 'reject'
  value?: number
  deadline?: string | null
  reason?: string
  reviewer: { id: string; name: string }
}

export async function reviewGoal(sb: SupabaseClient, input: ReviewGoalInput): Promise<{ review: GoalReviewRow; appliedDirectly: boolean }> {
  const reason = input.reason?.trim() || null
  assertClean({ reason })
  if (input.deadline != null && !DATE_RE.test(input.deadline)) throw invalid('Срок цели указан неверно (ГГГГ-ММ-ДД)')

  const goals = await loadGoals(sb, input.companyId)
  const goal = goals.find((g) => g.metricId === input.metricKey && g.periodLabel === input.periodLabel)
  const base = {
    company_id: input.companyId,
    metric_key: input.metricKey,
    period_label: input.periodLabel,
    reviewer_id: input.reviewer.id,
    reviewer_name: input.reviewer.name,
  }

  if (input.action === 'verify') {
    if (!goal) throw new PlanError('not_found', 'Цель не найдена')
    const review = await insertReview(sb, {
      ...base, status: 'verified', proposed_value: goal.targetValue, proposed_deadline: goal.deadline, previous_value: null, reason,
    })
    return { review, appliedDirectly: false }
  }

  if (input.action === 'reject') {
    if (!reason) throw invalid('Укажите причину, по которой цель отклонена')
    if (!goal) throw new PlanError('not_found', 'Цель не найдена')
    const review = await insertReview(sb, {
      ...base, status: 'disputed', proposed_value: null, proposed_deadline: null, previous_value: goal.targetValue, reason,
    })
    return { review, appliedDirectly: false }
  }

  // correct
  if (typeof input.value !== 'number' || !Number.isFinite(input.value)) throw invalid('Укажите значение цели')
  if (!reason) throw invalid('Укажите причину исправления цели')
  if (!goal) {
    if (!getMetricById(input.metricKey)) throw invalid('Неизвестная метрика')
    // The owner has no goal: the expert sets it right away; the caller tells the owner.
    const set = await upsertGoal(sb, input.companyId, {
      metricId: input.metricKey, targetValue: input.value, periodLabel: input.periodLabel, deadline: input.deadline ?? null,
      source: 'expert', note: reason,
    }, { actorId: input.reviewer.id })
    targetChanged(input.companyId, set, `user:${input.reviewer.id}`)
    const review = await insertReview(sb, {
      ...base, status: 'verified', proposed_value: set.targetValue, proposed_deadline: set.deadline, previous_value: null, reason,
    })
    return { review, appliedDirectly: true }
  }
  const sameDeadline = input.deadline === undefined || input.deadline === goal.deadline
  if (sameNumber(input.value, goal.targetValue) && sameDeadline) throw invalid('Значение совпадает с целью владельца — подтвердите её')
  // The owner has a goal: a proposal. metric_targets stays untouched until the owner agrees.
  const review = await insertReview(sb, {
    ...base, status: 'corrected', proposed_value: input.value, proposed_deadline: input.deadline ?? null, previous_value: goal.targetValue, reason,
  })
  return { review, appliedDirectly: false }
}

async function fetchReview(sb: SupabaseClient, reviewId: string): Promise<GoalReviewRow | null> {
  const { data, error } = await sb.from('pb_goal_reviews').select('*').eq('id', reviewId).maybeSingle()
  if (error) throw dbError('read review', error)
  return (data as GoalReviewRow | null) ?? null
}

/** A correction can be answered / applied only while it is the newest row of its goal. */
async function isLatest(sb: SupabaseClient, row: GoalReviewRow): Promise<boolean> {
  const latest = (await loadLatestReviews(sb, row.company_id)).get(goalKey(row.metric_key, row.period_label))
  return latest?.id === row.id
}

/** Writes the proposed value (and deadline) of a correction into the owner's goal. */
async function applyProposal(sb: SupabaseClient, row: GoalReviewRow, actorId: string): Promise<void> {
  if (row.proposed_value === null) throw new PlanError('bad_state', 'В корректировке нет значения цели')
  const goal = (await loadGoals(sb, row.company_id)).find((g) => g.metricId === row.metric_key && g.periodLabel === row.period_label)
  const set = await upsertGoal(sb, row.company_id, {
    metricId: row.metric_key,
    targetValue: Number(row.proposed_value),
    periodLabel: row.period_label,
    direction: goal?.direction,
    deadline: row.proposed_deadline ?? goal?.deadline ?? null,
    label: goal?.label ?? null,
    note: goal?.note ?? null,
    source: 'expert',
  }, { actorId })
  targetChanged(row.company_id, set, `user:${actorId}`)
}

async function claim(sb: SupabaseClient, reviewId: string, patch: Record<string, unknown>): Promise<GoalReviewRow | null> {
  const { data, error } = await sb.from('pb_goal_reviews').update(patch).eq('id', reviewId).eq('status', 'corrected').select('*').maybeSingle()
  if (error) throw dbError('answer correction', error)
  return (data as GoalReviewRow | null) ?? null
}

/** The owner of the company answers an expert's correction (accept → applied, otherwise → disputed). */
export async function respondToCorrection(
  sb: SupabaseClient, input: { reviewId: string; userId: string; accept: boolean },
): Promise<GoalReviewRow> {
  const row = await fetchReview(sb, input.reviewId)
  if (!row) throw new PlanError('not_found', 'Корректировка не найдена')
  const { data: company, error } = await sb.from('companies').select('user_id').eq('id', row.company_id).maybeSingle()
  if (error) throw dbError('read company', error)
  // Not the owner → indistinguishable from «no such correction».
  if (!company || (company as { user_id?: string }).user_id !== input.userId) throw new PlanError('not_found', 'Корректировка не найдена')
  if (row.status !== 'corrected' || !(await isLatest(sb, row))) throw new PlanError('bad_state', 'На эту корректировку уже ответили или она устарела')

  if (!input.accept) {
    const done = await claim(sb, row.id, { status: 'disputed' })
    if (!done) throw new PlanError('bad_state', 'На эту корректировку уже ответили')
    return done
  }
  const agreedAt = new Date().toISOString()
  const done = await claim(sb, row.id, { status: 'agreed', owner_agreed_at: agreedAt })
  if (!done) throw new PlanError('bad_state', 'На эту корректировку уже ответили')
  try {
    await applyProposal(sb, row, input.userId)
  } catch (err) {
    // Nothing was applied: put the proposal back so the owner can answer again.
    await sb.from('pb_goal_reviews').update({ status: 'corrected', owner_agreed_at: null }).eq('id', row.id).eq('status', 'agreed')
    throw err
  }
  return done
}

/** Staff applies a correction the owner did not answer for 14 days (§6); marked «without agreement». */
export async function applyStaleCorrection(
  sb: SupabaseClient, reviewId: string, reviewer: { id: string; name: string }, opts: { now?: Date } = {},
): Promise<GoalReviewRow> {
  const row = await fetchReview(sb, reviewId)
  if (!row) throw new PlanError('not_found', 'Корректировка не найдена')
  if (row.status !== 'corrected' || !(await isLatest(sb, row))) throw new PlanError('bad_state', 'Корректировка уже обработана или устарела')
  const ageMs = (opts.now ?? new Date()).getTime() - new Date(row.created_at).getTime()
  if (ageMs < STALE_CORRECTION_DAYS * DAY_MS) {
    throw invalid(`Применить без согласия можно через ${STALE_CORRECTION_DAYS} дней после корректировки`)
  }
  const done = await claim(sb, row.id, { status: 'verified', applied_without_agreement: true })
  if (!done) throw new PlanError('bad_state', 'Корректировка уже обработана')
  try {
    await applyProposal(sb, row, reviewer.id)
  } catch (err) {
    await sb.from('pb_goal_reviews').update({ status: 'corrected', applied_without_agreement: false }).eq('id', row.id).eq('status', 'verified')
    throw err
  }
  return done
}
