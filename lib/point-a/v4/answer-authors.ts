/**
 * lib/point-a/v4/answer-authors.ts — who answered the questions behind Point A
 * and when (PO 2026-11-02): «Заполнил: вы · 22.10.2026», «Изменил эксперт
 * Иван Петров · 01.11.2026», «Заполнил ИИ (из документов) · …», «Изменил
 * админ · …» — the same lines as under the questionnaire fields
 * (lib/survey/attribution-label.ts). Pure, browser-safe.
 */
import { formatAttribution, type AnswerAttribution, type AttributionViewer } from '@/lib/survey/attribution-label'
import { surveyQuestion } from '@/lib/survey/questions'
import type { BlockKey } from './config'
import { CHECK_QUESTION_KEYS } from './check-questions'

/** Every question key a Point A check is answered by — the authors the page needs. */
export const POINT_A_QUESTION_KEYS: readonly string[] = [
  ...new Set(Object.values(CHECK_QUESTION_KEYS).flatMap((checks) => Object.values(checks).flat())),
]

export interface AnswerAuthorLine {
  key: string
  /** The question as the questionnaire names it. */
  label: string
  /** «Заполнил: вы · 22.10.2026». */
  line: string
}

/** Author lines of the answered questions of a check (no author recorded → no line). */
export function checkAuthorLines(
  block: BlockKey,
  checkId: string,
  attribution: Readonly<Record<string, AnswerAttribution | undefined>>,
  viewer: AttributionViewer = {},
): AnswerAuthorLine[] {
  return (CHECK_QUESTION_KEYS[block]?.[checkId] ?? []).flatMap((key) => {
    const line = formatAttribution(attribution[key], viewer)
    return line ? [{ key, label: surveyQuestion(key)?.label ?? key, line }] : []
  })
}

/** The latest change among the answers (ISO), or null. */
export function lastAnswerChange(attribution: Readonly<Record<string, AnswerAttribution | undefined>>): string | null {
  let last: string | null = null
  for (const a of Object.values(attribution)) {
    const at = a?.updatedAt
    if (at && (!last || Date.parse(at) > Date.parse(last))) last = at
  }
  return last
}

/** The latest answer change among the questions of a block: «Изменил эксперт Иван · 01.11.2026», or null. */
export function latestBlockAuthor(
  block: BlockKey,
  attribution: Readonly<Record<string, AnswerAttribution | undefined>>,
  viewer: AttributionViewer = {},
): string | null {
  let latest: AnswerAttribution | null = null
  for (const keys of Object.values(CHECK_QUESTION_KEYS[block] ?? {})) {
    for (const k of keys) {
      const a = attribution[k]
      if (a?.updatedByRole && a.updatedAt && (!latest?.updatedAt || Date.parse(a.updatedAt) > Date.parse(latest.updatedAt))) latest = a
    }
  }
  return formatAttribution(latest, viewer)
}
