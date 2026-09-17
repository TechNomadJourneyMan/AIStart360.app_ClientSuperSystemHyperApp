/**
 * lib/survey/progress.ts — how much of the survey is filled, per step.
 *
 * One definition for the wizard tabs, the user dashboard and GIGA-CRM, so the
 * three never disagree. Overall percent follows the server rule in
 * `surveyProgressFromRows` (a step counts once it has at least one answer);
 * `filled/total` per step is the finer-grained number shown next to it.
 */
import { SURVEY_KEY_STEP, SURVEY_TOTAL_STEPS } from './steps'

export interface StepFill {
  step: number
  filled: number
  total: number
  started: boolean
}

export function hasAnswerValue(v: unknown): boolean {
  if (v === null || v === undefined) return false
  if (typeof v === 'string') return v.trim().length > 0
  if (Array.isArray(v)) return v.length > 0
  if (typeof v === 'object') return Object.keys(v as object).length > 0
  return true
}

const KEYS_BY_STEP: ReadonlyArray<ReadonlyArray<string>> = (() => {
  const out: string[][] = Array.from({ length: SURVEY_TOTAL_STEPS }, () => [])
  for (const [key, step] of Object.entries(SURVEY_KEY_STEP)) out[step - 1]?.push(key)
  return out
})()

export function keysForStep(step: number): ReadonlyArray<string> {
  return KEYS_BY_STEP[step - 1] ?? []
}

/** `answers` = flat question_key → value map (already unwrapped from `{value}`). */
export function stepFillFromAnswers(answers: Readonly<Record<string, unknown>>): StepFill[] {
  return KEYS_BY_STEP.map((keys, i) => {
    let filled = 0
    for (const k of keys) if (hasAnswerValue(answers[k])) filled++
    return { step: i + 1, filled, total: keys.length, started: filled > 0 }
  })
}

export function overallFill(fill: ReadonlyArray<StepFill>): {
  startedSteps: number
  totalSteps: number
  percent: number
  missingSteps: number[]
} {
  const startedSteps = fill.filter((s) => s.started).length
  return {
    startedSteps,
    totalSteps: SURVEY_TOTAL_STEPS,
    percent: Math.round((startedSteps / SURVEY_TOTAL_STEPS) * 100),
    missingSteps: fill.filter((s) => !s.started).map((s) => s.step),
  }
}
