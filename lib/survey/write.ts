/**
 * lib/survey/write.ts — ONE write path for questionnaire answers (spec
 * 2026-10-23 §5.1 invariant 2). Every writer goes through these steps, so a
 * value saved from the wizard, «Мои ответы», GIGA, the expert cabinet or (Ф4)
 * the AI chat ends up as the same survey_answers row with the same side effects:
 *
 *   1. only questionnaire keys (never staff notes / widget data);
 *   2. no profanity in free text;
 *   3. the stored envelope (`{ value }`, «не знаю», «примерно»);
 *   4. the step that OWNS the key (never the step the user stands on);
 *   5. «год = месяц × 12» for a month answer written without its year;
 *   6. the author and the path (lib/survey/attribution.ts, migrations 131/134);
 *   7. the revenue goal follows the step-1 goal answers (lib/goals/survey-sync.ts).
 *
 * Route-specific effects stay in the routes: product events and the Sheets
 * mirror (POST /api/v1/onboarding/survey), the mandatory audit entry
 * (lib/admin/survey-admin.ts). The database client is passed in.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import type { NextResponse } from 'next/server'
import { answersProfanityResponse } from '@/lib/moderation/http'
import { syncGoalsFromSurvey, surveyWriterFor, touchesGoalKeys, type GoalActor } from '@/lib/goals/survey-sync'
import { fromAnswerEnvelope, toAnswerEnvelope } from './answer-value'
import { autoYearUpdate } from './number-input'
import { AUTO_KEYS, isWritableSurveyKey, stepForQuestionKey } from './steps'
import { groupByAuthor, writeWithAttribution, type AnswerAuthor } from './attribution'

/** One survey_answers row as written (author columns are added at write time). */
export interface SurveyAnswerRow extends Record<string, unknown> {
  user_id: string
  /** Absent when the writer must not touch the stored company (staff edits). */
  company_id?: string | null
  step: number
  question_key: string
  answer: Record<string, unknown>
  answered_at: string
}

/** What the database already holds for the keys being written. */
export interface ExistingAnswerRow {
  question_key: string
  step?: number | string | null
  answer?: unknown
}

export interface PreparedSurveyWrite {
  rows: SurveyAnswerRow[]
  /** Keys to delete (staff only — a client clears a field with `{ value: null }`). */
  deletes: string[]
  /** Keys that are not questionnaire keys (dropped). */
  ignored: string[]
  /** Auto keys added by the server («год = месяц × 12»). */
  autoAdded: string[]
}

/** month key → its «год = месяц × 12» key. */
const AUTO_YEAR_OF: Readonly<Record<string, string>> = Object.fromEntries(
  AUTO_KEYS.map((year) => [year.replace(/_year$/, '_month'), year]),
)

const unwrapStored = (v: unknown): unknown => fromAnswerEnvelope(v)

/**
 * «Год = месяц × 12» for a month answer written without its year (the wizard
 * sends both; «Мои ответы», GIGA and the chat write one key). Same rule as the
 * step-1 form (lib/survey/number-input.ts autoYearUpdate): a cleared or «не
 * знаю» month clears the year, a matching year is kept. Returns the year's
 * envelope, or undefined when the year stays as it is.
 */
export function autoYearFor(monthKey: string, monthEnvelope: unknown, storedYear: unknown): Record<string, unknown> | undefined {
  if (!(monthKey in AUTO_YEAR_OF)) return undefined
  const next = autoYearUpdate(fromAnswerEnvelope(monthEnvelope), unwrapStored(storedYear), true)
  if (next === undefined) return undefined
  return { value: next }
}

/** 400 with the question key when a free-text answer has profanity; null otherwise. */
export function surveyProfanityResponse(envelopes: Readonly<Record<string, unknown>>): NextResponse | null {
  return answersProfanityResponse(Object.fromEntries(
    Object.entries(envelopes)
      .filter(([k]) => isWritableSurveyKey(k))
      .map(([k, a]) => [k, (a as { value?: unknown } | null)?.value]),
  ))
}

/**
 * The rows of one save. `envelopes` are stored answers (`{ value }` or a mark);
 * `deletes` are keys to remove. The step is the one that owns the key; keys of
 * other intakes keep their stored step and fall back to `bodyStep` when new.
 */
export function prepareSurveyWrite(input: {
  ownerId: string
  /** undefined → the row carries no company_id (an upsert keeps the stored one). */
  companyId?: string | null
  envelopes: Readonly<Record<string, unknown>>
  deletes?: readonly string[]
  existing?: readonly ExistingAnswerRow[]
  bodyStep?: number
  at?: Date
}): PreparedSurveyWrite {
  const at = (input.at ?? new Date()).toISOString()
  const existing = new Map((input.existing ?? []).map((r) => [r.question_key, r]))
  const storedStep = (k: string): number | null => {
    const s = existing.get(k)?.step
    return s === null || s === undefined || !Number.isFinite(Number(s)) ? null : Number(s)
  }
  const ignored: string[] = []
  const entries: Array<[string, Record<string, unknown>]> = []
  for (const [key, env] of Object.entries(input.envelopes)) {
    if (!isWritableSurveyKey(key)) { ignored.push(key); continue }
    entries.push([key, toAnswerEnvelope(fromAnswerEnvelope(env))])
  }
  const deletes: string[] = []
  for (const key of input.deletes ?? []) {
    if (!isWritableSurveyKey(key)) { ignored.push(key); continue }
    deletes.push(key)
  }

  // «Год = месяц × 12» when the year was not written in the same save.
  const autoAdded: string[] = []
  const written = new Set([...entries.map(([k]) => k), ...deletes])
  for (const [key, env] of [...entries]) {
    const yearKey = AUTO_YEAR_OF[key]
    if (!yearKey || written.has(yearKey)) continue
    const year = autoYearFor(key, env, existing.get(yearKey)?.answer)
    if (year === undefined) continue
    entries.push([yearKey, year])
    autoAdded.push(yearKey)
  }

  const rows: SurveyAnswerRow[] = entries.map(([question_key, answer]) => ({
    user_id: input.ownerId,
    ...(input.companyId !== undefined ? { company_id: input.companyId } : {}),
    step: stepForQuestionKey(question_key, null) ?? storedStep(question_key) ?? input.bodyStep ?? 0,
    question_key,
    answer,
    answered_at: at,
  }))
  return { rows, deletes, ignored, autoAdded }
}

/**
 * Upsert the rows, one write per author (the author and the path are stamped
 * on every row; before migrations 131 / 134 the write is retried without the
 * missing columns). Returns the first error, and the author of every key written.
 */
export async function writeSurveyRows(
  db: Pick<SupabaseClient, 'from'>,
  rows: readonly SurveyAnswerRow[],
  authorOf: (row: SurveyAnswerRow) => AnswerAuthor,
  opts: { at?: Date; label?: string } = {},
): Promise<{ error: unknown; authors: Map<string, AnswerAuthor> }> {
  const authors = new Map<string, AnswerAuthor>()
  for (const g of groupByAuthor([...rows], authorOf)) {
    const { error } = await writeWithAttribution(
      g.rows, g.author,
      (list) => db.from('survey_answers').upsert(list, { onConflict: 'user_id,question_key' }),
      { at: opts.at, label: opts.label ?? 'survey/write' },
    )
    if (error) return { error, authors }
    for (const r of g.rows) authors.set(r.question_key, g.author)
  }
  return { error: null, authors }
}

/**
 * A step-1 goal answer was written → the goal (metric_targets, companies.
 * target_revenue_*) follows it. `allowClear` is off for keystroke autosaves.
 */
export async function syncGoalsAfterWrite(
  service: SupabaseClient,
  input: { ownerId: string; companyId?: string | null; rows: readonly Pick<SurveyAnswerRow, 'question_key' | 'answer'>[]; deletes?: readonly string[]; actor: GoalActor; allowClear: boolean },
): Promise<void> {
  const touchedKeys = [...input.rows.map((r) => r.question_key), ...(input.deletes ?? [])]
  if (!touchedKeys.length || !touchesGoalKeys(touchedKeys)) return
  const answers: Record<string, unknown> = Object.fromEntries(input.rows.map((r) => [r.question_key, r.answer]))
  for (const k of input.deletes ?? []) answers[k] = null
  await syncGoalsFromSurvey(service, {
    userId: input.ownerId,
    companyId: input.companyId ?? undefined,
    answers,
    touchedKeys,
    actor: input.actor,
    allowClear: input.allowClear,
    writer: surveyWriterFor(input.actor, service),
  })
}
