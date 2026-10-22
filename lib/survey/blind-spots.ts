/**
 * lib/survey/blind-spots.ts — «карта слепых зон»: the questions the owner
 * answered «Не знаю / не считаем» (survey audit 2026-10-22, MVP item 3).
 * «Не знаю конверсию» is itself a finding (a metric nobody tracks); the review
 * screen lists them. Pure, browser-safe.
 */
import { SURVEY_LABELS } from '@/lib/survey-labels'
import { SURVEY_KEY_STEP } from '@/lib/survey/steps'
import { isUnknownAnswer } from '@/lib/survey/answer-value'

export interface BlindSpot { key: string; step: number; label: string }

const LABEL_ORDER = new Map(Object.keys(SURVEY_LABELS).map((k, i) => [k, i]))

/** Questions answered «не знаю», in wizard order (step, then the order the form asks them). */
export function blindSpots(answers: Readonly<Record<string, unknown>>): BlindSpot[] {
  return Object.entries(answers)
    .filter(([k, v]) => k in SURVEY_KEY_STEP && isUnknownAnswer(v))
    .map(([key]) => ({ key, step: SURVEY_KEY_STEP[key], label: SURVEY_LABELS[key] ?? key }))
    .sort((a, b) => a.step - b.step || (LABEL_ORDER.get(a.key) ?? 1e9) - (LABEL_ORDER.get(b.key) ?? 1e9))
}
