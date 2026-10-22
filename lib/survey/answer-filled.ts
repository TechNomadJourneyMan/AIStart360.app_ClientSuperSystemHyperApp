/**
 * lib/survey/answer-filled.ts — is a questionnaire answer really answered?
 * One rule for the wizard (lib/survey/progress.ts) and the server summary
 * (lib/survey/steps.ts → surveyProgressFromRows: cabinet, GIGA, status, bot).
 *
 *  • blank strings, empty arrays / objects, null → not answered;
 *  • «Не знаю» / «примерно» (lib/survey/answer-value.ts) → answered;
 *  • a TABLE (array of row objects) is answered only when one row has at
 *    least two filled cells (one, for one-column rows): the 15 prefilled
 *    categories of the influence map and the metric names of the step-8
 *    template with empty / zero cells are not an answer (survey audit К11 —
 *    one edited cell used to save all 15 rows and «finish» step 11).
 *
 * Pure, browser-safe.
 */
import { isMarkedAnswer } from './answer-value'

const isPlainObject = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v)

function cellFilled(v: unknown): boolean {
  if (v === null || v === undefined) return false
  if (typeof v === 'string') return v.trim().length > 0
  if (typeof v === 'number') return Number.isFinite(v) && v !== 0
  if (typeof v === 'boolean') return v
  if (Array.isArray(v)) return v.length > 0
  return isPlainObject(v) && Object.keys(v).length > 0
}

function rowFilled(row: Record<string, unknown>): boolean {
  const keys = Object.keys(row)
  const filled = keys.filter((k) => cellFilled(row[k])).length
  return filled >= Math.min(2, Math.max(1, keys.length))
}

/** The flat (unwrapped) answer value is a real answer. */
export function isAnswerFilled(v: unknown): boolean {
  if (isMarkedAnswer(v)) return true
  if (v === null || v === undefined) return false
  if (typeof v === 'string') return v.trim().length > 0
  if (Array.isArray(v)) {
    if (v.length === 0) return false
    if (v.every(isPlainObject)) return (v as Record<string, unknown>[]).some(rowFilled)
    return true
  }
  if (isPlainObject(v)) return Object.keys(v).length > 0
  return true
}
