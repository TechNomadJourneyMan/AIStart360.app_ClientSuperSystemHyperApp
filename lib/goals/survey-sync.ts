/**
 * lib/goals/survey-sync.ts — the revenue goals of the questionnaire and of
 * public.metric_targets are one thing (plan 2026-10-22, W1).
 *
 * Source of truth: metric_targets (biz.finansy.vyruchka_god, periods 12m/3y).
 * Mirrors: the numeric step-1 answers s1_goal_<12m|3y>_revenue_year/_month and
 * companies.target_revenue_* (kept by lib/goals/store.ts).
 *
 *  • a questionnaire save that touched a goal answer → the goal follows it
 *    (syncGoalsFromSurvey; the owner's save → source owner, staff → expert);
 *  • a goal changed on the dashboard / Point A / in the AI chat / Point B →
 *    the answers follow it (writeGoalToSurvey: year and month = year / 12).
 *
 * The old text answers goal_*_v2 («500 тыс ₸ / мес», the dashboard widget)
 * count only when there is no numeric answer at all (goalsFromAnswers).
 *
 * Nothing here throws into the caller: the answer / the goal itself is
 * already saved, a failed mirror is logged.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { parseAmount } from '@/lib/format/kzt'
import { SURVEY_KEY_STEP } from '@/lib/survey/steps'
import { positiveNumber } from '@/lib/survey/targets'
import { createActorServiceClient, createServiceClient } from '@/lib/supabase-service'
import { REVENUE_GOAL_METRIC, syncRevenueColumn, syncRevenueGoal } from './store'

export type RevenuePeriod = '12m' | '3y'
export const REVENUE_PERIODS: readonly RevenuePeriod[] = ['12m', '3y']

/** The numeric goal answers of step 1, per horizon. */
export const SURVEY_GOAL_KEYS: Readonly<Record<RevenuePeriod, { year: string; month: string }>> = {
  '12m': { year: 's1_goal_12m_revenue_year', month: 's1_goal_12m_revenue_month' },
  '3y': { year: 's1_goal_3y_revenue_year', month: 's1_goal_3y_revenue_month' },
}

/** The dashboard «Карта роста» stored a 1-year goal per month as text here. */
const LEGACY_MONTH_TEXT_KEY = 'goal_month_v2'

export interface SurveyGoal {
  /** Annual revenue, ₸. */
  valueYear: number
  from: 'year' | 'month' | 'legacy_text'
}

/** Who changed the goal: the company owner, an expert or a platform admin. */
export interface GoalActor {
  id: string
  role: 'owner' | 'expert' | 'admin'
}

const unwrap = (v: unknown): unknown =>
  v !== null && typeof v === 'object' && !Array.isArray(v) && 'value' in (v as object) ? (v as { value: unknown }).value : v

function legacyMonthly(v: unknown): number | null {
  const raw = unwrap(v)
  if (typeof raw !== 'string') return null
  const n = parseAmount(raw)
  return n !== null && n > 0 ? n : null
}

/**
 * Revenue goals stated in the answers (answer rows `{ value }` or plain values):
 * `_year` first, else `_month` × 12. The legacy text goal_month_v2 (a 1-year
 * goal per month) is used only when no numeric goal answer exists at all.
 */
export function goalsFromAnswers(answers: Record<string, unknown>): Record<RevenuePeriod, SurveyGoal | null> {
  const out: Record<RevenuePeriod, SurveyGoal | null> = { '12m': null, '3y': null }
  for (const period of REVENUE_PERIODS) {
    const keys = SURVEY_GOAL_KEYS[period]
    const year = positiveNumber(unwrap(answers[keys.year]))
    const month = positiveNumber(unwrap(answers[keys.month]))
    if (year) out[period] = { valueYear: Math.round(year), from: 'year' }
    else if (month) out[period] = { valueYear: Math.round(month * 12), from: 'month' }
  }
  if (!out['12m'] && !out['3y']) {
    const monthly = legacyMonthly(answers[LEGACY_MONTH_TEXT_KEY])
    if (monthly) out['12m'] = { valueYear: Math.round(monthly * 12), from: 'legacy_text' }
  }
  return out
}

/** Does this save touch a numeric goal answer? */
export function touchesGoalKeys(keys: Iterable<string>): boolean {
  const all = new Set(REVENUE_PERIODS.flatMap((p) => [SURVEY_GOAL_KEYS[p].year, SURVEY_GOAL_KEYS[p].month]))
  for (const k of keys) if (all.has(k)) return true
  return false
}

/** metric_targets.source of a goal set by this actor. */
function goalSource(actor: GoalActor): 'owner' | 'expert' {
  return actor.role === 'owner' ? 'owner' : 'expert'
}

/**
 * A service-role client that stamps the actor on survey_answers writes, so
 * survey_answer_history (073) shows who changed the answer. Only when the
 * caller works with the real service client: any other client (a test
 * double, a session client) is used as is — a test never gets a networked
 * client this way.
 */
export function surveyWriterFor(actor: GoalActor, fallback: SupabaseClient): SupabaseClient {
  try {
    if (fallback !== createServiceClient()) return fallback
    return createActorServiceClient({ id: actor.id, source: actor.role === 'owner' ? 'user' : 'admin' })
  } catch {
    return fallback
  }
}

async function ownerOf(service: SupabaseClient, companyId: string): Promise<string | null> {
  const { data, error } = await service.from('companies').select('user_id').eq('id', companyId).maybeSingle()
  if (error) throw new Error(`company read failed (${error.code ?? 'unknown'})`)
  const id = (data as { user_id?: unknown } | null)?.user_id
  return id ? String(id) : null
}

async function companyOf(service: SupabaseClient, userId: string): Promise<string | null> {
  const { data, error } = await service.from('companies').select('id').eq('user_id', userId).maybeSingle()
  if (error) throw new Error(`company read failed (${error.code ?? 'unknown'})`)
  const id = (data as { id?: unknown } | null)?.id
  return id != null ? String(id) : null
}

export interface WriteGoalToSurveyInput {
  /** The questionnaire's owner; resolved from companies.user_id when omitted. */
  userId?: string | null
  companyId: string
  periodLabel: string
  /** Annual revenue goal, ₸; null — the goal was removed (the answers are removed too). */
  valueYear: number | null
  actor: GoalActor
  /** Writes survey_answers (default: `service`); see surveyWriterFor. */
  writer?: SupabaseClient
}

export type WriteGoalResult = { written: string[]; removed: string[] } | { skipped: string }

/**
 * A revenue goal changed outside the questionnaire → the step-1 answers
 * follow it: `_year` = the goal, `_month` = goal / 12 (rounded). The step is
 * the one that owns the key (SURVEY_KEY_STEP — never the step the user is
 * on, see the «1/12» notes in lib/survey/steps.ts). Answers that already
 * hold the value are left alone (idempotent; keeps their provenance).
 * Non-revenue goals and other horizons do nothing.
 */
export async function writeGoalToSurvey(service: SupabaseClient, input: WriteGoalToSurveyInput): Promise<WriteGoalResult> {
  const period = input.periodLabel as RevenuePeriod
  if (!REVENUE_PERIODS.includes(period)) return { skipped: 'not_revenue_period' }
  try {
    const userId = input.userId ?? (await ownerOf(service, input.companyId))
    if (!userId) return { skipped: 'no_owner' }
    const keys = SURVEY_GOAL_KEYS[period]
    const writer = input.writer ?? service
    const { data, error } = await service.from('survey_answers').select('question_key, answer').eq('user_id', userId).in('question_key', [keys.year, keys.month])
    if (error) throw new Error(`answers read failed (${error.code ?? 'unknown'})`)
    const current = new Map(((data ?? []) as Array<{ question_key: string; answer: unknown }>).map((r) => [r.question_key, Math.round(positiveNumber(unwrap(r.answer)) ?? 0)]))

    if (input.valueYear === null || !(input.valueYear > 0)) {
      const present = [keys.year, keys.month].filter((k) => current.has(k))
      if (!present.length) return { written: [], removed: [] }
      const del = await writer.from('survey_answers').delete().eq('user_id', userId).in('question_key', present)
      if (del.error) throw new Error(`answers delete failed (${del.error.code ?? 'unknown'})`)
      return { written: [], removed: present }
    }

    const year = Math.round(input.valueYear)
    const want: Array<[string, number]> = [[keys.year, year], [keys.month, Math.round(year / 12)]]
    const now = new Date().toISOString()
    const rows = want
      .filter(([k, v]) => current.get(k) !== v)
      .map(([question_key, value]) => ({
        user_id: userId,
        company_id: input.companyId,
        step: SURVEY_KEY_STEP[question_key],
        question_key,
        answer: { value },
        answered_at: now,
      }))
    if (!rows.length) return { written: [], removed: [] }
    const up = await writer.from('survey_answers').upsert(rows, { onConflict: 'user_id,question_key' })
    if (up.error) throw new Error(`answers write failed (${up.error.code ?? 'unknown'})`)
    return { written: rows.map((r) => r.question_key), removed: [] }
  } catch (err) {
    console.error('[goals/survey-sync] goal → survey failed', input.companyId, period, err instanceof Error ? err.message : err)
    return { skipped: 'error' }
  }
}

export interface SyncGoalsFromSurveyInput {
  userId: string
  /** Resolved from companies.user_id when omitted. */
  companyId?: string | null
  /** Answers after the save (key → `{ value }` or a plain value); at least the touched keys. */
  answers: Record<string, unknown>
  /** Keys this save wrote; only their horizons are synced. Default: every goal key in `answers`. */
  touchedKeys?: Iterable<string>
  actor: GoalActor
  /**
   * An emptied goal answer removes the goal. Off for keystroke autosaves —
   * an input cleared while retyping must not drop the goal (and its horizon).
   */
  allowClear?: boolean
  writer?: SupabaseClient
}

export type SyncGoalsResult = { set: RevenuePeriod[]; cleared: RevenuePeriod[] } | { skipped: string }

/**
 * A questionnaire save touched a goal answer → the goal (metric_targets and
 * companies.target_revenue_*) takes the new value. The value of a horizon is
 * the answer just written: `_year` if it was written, else `_month` × 12; the
 * other answer of the pair is then aligned (year ↔ month / 12).
 */
export async function syncGoalsFromSurvey(service: SupabaseClient, input: SyncGoalsFromSurveyInput): Promise<SyncGoalsResult> {
  const touched = new Set(input.touchedKeys ?? Object.keys(input.answers))
  if (!touchesGoalKeys(touched)) return { skipped: 'no_goal_keys' }
  try {
    const companyId = input.companyId ?? (await companyOf(service, input.userId))
    if (!companyId) return { skipped: 'no_company' }
    const out = { set: [] as RevenuePeriod[], cleared: [] as RevenuePeriod[] }
    for (const period of REVENUE_PERIODS) {
      const keys = SURVEY_GOAL_KEYS[period]
      const yearTouched = touched.has(keys.year)
      const monthTouched = touched.has(keys.month)
      if (!yearTouched && !monthTouched) continue
      const year = positiveNumber(unwrap(input.answers[keys.year]))
      const month = positiveNumber(unwrap(input.answers[keys.month]))
      // A touched answer that is now empty (or 0) means «no goal».
      let value: number | null = null
      if (yearTouched && year) value = Math.round(year)
      else if (monthTouched && month) value = Math.round(month * 12)

      const existing = await service.from('metric_targets').select('target_value').eq('company_id', companyId).eq('metric_key', REVENUE_GOAL_METRIC).eq('period_label', period).maybeSingle()
      const stored = existing.error || !existing.data ? null : Number((existing.data as { target_value: unknown }).target_value)

      if (value === null) {
        if (!input.allowClear || stored === null) continue
        await syncRevenueGoal(service, companyId, period, null, input.actor.id)
        await syncRevenueColumn(service, companyId, REVENUE_GOAL_METRIC, period, null)
        await writeGoalToSurvey(service, { userId: input.userId, companyId, periodLabel: period, valueYear: null, actor: input.actor, writer: input.writer })
        out.cleared.push(period)
        continue
      }
      if (stored !== value) {
        await syncRevenueGoal(service, companyId, period, value, input.actor.id, { source: goalSource(input.actor) })
        await syncRevenueColumn(service, companyId, REVENUE_GOAL_METRIC, period, value)
        out.set.push(period)
      }
      // Only one answer of the pair was written (GIGA edit, a year typed alone): align the other.
      if (yearTouched !== monthTouched) {
        await writeGoalToSurvey(service, { userId: input.userId, companyId, periodLabel: period, valueYear: value, actor: input.actor, writer: input.writer })
      }
    }
    return out
  } catch (err) {
    console.error('[goals/survey-sync] survey → goal failed', input.userId, err instanceof Error ? err.message : err)
    return { skipped: 'error' }
  }
}

/**
 * A goal saved or removed outside the questionnaire (goals API, revenue
 * targets, AI chat, Point B) → the questionnaire. Only the revenue goal on
 * 12m / 3y has answers; anything else is a no-op. Writes are stamped with the
 * actor (survey_answer_history). Never throws.
 */
export async function mirrorGoalToSurvey(
  service: SupabaseClient,
  input: { companyId: string; metricId: string; periodLabel: string; valueYear: number | null; actor: GoalActor; writer?: SupabaseClient },
): Promise<WriteGoalResult> {
  try {
    if (input.metricId !== REVENUE_GOAL_METRIC) return { skipped: 'not_revenue_metric' }
    if (!REVENUE_PERIODS.includes(input.periodLabel as RevenuePeriod)) return { skipped: 'not_revenue_period' }
    return await writeGoalToSurvey(service, {
      companyId: input.companyId,
      periodLabel: input.periodLabel,
      valueYear: input.valueYear,
      actor: input.actor,
      writer: input.writer ?? surveyWriterFor(input.actor, service),
    })
  } catch (err) {
    console.error('[goals/survey-sync] goal → survey failed', input.companyId, err instanceof Error ? err.message : err)
    return { skipped: 'error' }
  }
}
