/**
 * lib/survey/progress.ts — how much of the survey is filled (survey audit
 * 2026-10-22, MVP item 5 «честный прогресс»).
 *
 * One definition for the wizard, the user dashboard and GIGA-CRM, so the three
 * never disagree (the server summary `surveyProgressFromRows` in ./steps uses
 * the same `isAnswerFilled` and the same «минимум»):
 *  • «Глубина: X %» — answered fields / all wizard fields, without the three
 *    auto fields «год = месяц × 12»; «не знаю» counts; a table counts only
 *    with a real row (./answer-filled.ts);
 *  • «Минимум для Точки А: X из N» — the checks of the Point A v4 engine
 *    (./point-a-minimum.ts);
 *  • a step is «started» once it has one real answer (tabs, review screen).
 */
import { AUTO_KEYS, SURVEY_KEY_STEP, SURVEY_TOTAL_STEPS, stepForQuestionKey } from './steps'
import { isAnswerFilled } from './answer-filled'
import { computePointAMinimum, minimumChecks, type PointAMinimum } from './point-a-minimum'

export { AUTO_KEYS }
export type { PointAMinimum }

export interface StepFill {
  step: number
  filled: number
  total: number
  started: boolean
}

/** «Не знаю» / «примерно» are answers; blank, empty and table templates are not. */
export function hasAnswerValue(v: unknown): boolean {
  return isAnswerFilled(v)
}

const AUTO = new Set<string>(AUTO_KEYS)

const KEYS_BY_STEP: ReadonlyArray<ReadonlyArray<string>> = (() => {
  const out: string[][] = Array.from({ length: SURVEY_TOTAL_STEPS }, () => [])
  for (const [key, step] of Object.entries(SURVEY_KEY_STEP)) if (!AUTO.has(key)) out[step - 1]?.push(key)
  return out
})()

/** The questions of a step (auto fields excluded). */
export function keysForStep(step: number): ReadonlyArray<string> {
  return KEYS_BY_STEP[step - 1] ?? []
}

/** `answers` = flat question_key → value map (unwrapped from `{value}`, marks kept). */
export function stepFillFromAnswers(answers: Readonly<Record<string, unknown>>): StepFill[] {
  return KEYS_BY_STEP.map((keys, i) => {
    let filled = 0
    for (const k of keys) if (hasAnswerValue(answers[k])) filled++
    return { step: i + 1, filled, total: keys.length, started: filled > 0 }
  })
}

/** «Глубина»: answered fields of the whole questionnaire. */
export function surveyDepth(answers: Readonly<Record<string, unknown>>): { answered: number; total: number; percent: number } {
  const fill = stepFillFromAnswers(answers)
  const answered = fill.reduce((n, s) => n + s.filled, 0)
  const total = fill.reduce((n, s) => n + s.total, 0)
  return { answered, total, percent: total ? Math.round((answered / total) * 100) : 0 }
}

export function overallFill(fill: ReadonlyArray<StepFill>): {
  startedSteps: number
  totalSteps: number
  /** «Глубина»: answered fields / all fields, %. */
  percent: number
  answered: number
  total: number
  missingSteps: number[]
} {
  const startedSteps = fill.filter((s) => s.started).length
  const answered = fill.reduce((n, s) => n + s.filled, 0)
  const total = fill.reduce((n, s) => n + s.total, 0)
  return {
    startedSteps,
    totalSteps: SURVEY_TOTAL_STEPS,
    percent: total ? Math.round((answered / total) * 100) : 0,
    answered,
    total,
    missingSteps: fill.filter((s) => !s.started).map((s) => s.step),
  }
}

/** The checks behind «Минимум для Точки А». */
export const POINT_A_MINIMUM_CHECKS = minimumChecks(stepForQuestionKey)

/** «Минимум для Точки А: X из N» + what is still missing (label, step to open). */
export function pointAMinimum(answers: Readonly<Record<string, unknown>>): PointAMinimum {
  return computePointAMinimum(answers, stepForQuestionKey)
}

/** «~4 мин» for an empty step, less as it fills up; 0 when every field is answered. */
export function stepTimeLeft(fill: StepFill, minutes: number): number {
  if (!fill.total) return 0
  const left = 1 - fill.filled / fill.total
  return left <= 0 ? 0 : Math.max(1, Math.round(minutes * left))
}

/** «~4 мин» for an untouched step, «осталось ~2 мин» for a started one, «всё заполнено». */
export function stepTimeHint(fill: StepFill | undefined, minutes: number): string {
  if (!fill || fill.filled === 0) return `~${minutes} мин`
  const left = stepTimeLeft(fill, minutes)
  return left === 0 ? 'всё заполнено' : `осталось ~${left} мин`
}
