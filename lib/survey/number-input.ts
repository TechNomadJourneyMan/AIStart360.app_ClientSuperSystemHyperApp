/**
 * lib/survey/number-input.ts — the pure part of the questionnaire's number
 * field (survey audit 2026-10-22, MVP item 4; components/onboarding/shared/NumberField.tsx).
 *
 *  • thousands separators WHILE typing, the caret stays after the same digit;
 *  • an integer field drops «.»/«,» (no «1.500» → 1,5 — an order-of-magnitude
 *    error in revenue); a decimal field keeps one decimal comma, several
 *    separators are thousands («1,500,000»);
 *  • empty stays empty: a cleared field is null, never 0 (the audit found 62
 *    «silent zeros» written by `Number(v) || 0`).
 */
import { approxAnswer, groupThousands, isApproxAnswer, isUnknownAnswer, parseApproxRange, type ApproxAnswer } from './answer-value'

export interface NumberDraftOptions {
  /** Whole numbers only (counts, money): separators are dropped. */
  integer?: boolean
  allowNegative?: boolean
  /** Digits after the decimal comma (decimal fields). */
  maxDecimals?: number
}

const SIGNIFICANT = /[\d,.-]/

/** Normalise raw input: digits, one decimal comma (decimal fields), a leading minus (when allowed). */
function normalise(raw: string, opts: NumberDraftOptions): string {
  const negative = !!opts.allowNegative && /^\s*-/.test(raw)
  let s = raw.replace(/[^\d.,]/g, '')
  const seps = s.match(/[.,]/g) ?? []
  if (opts.integer || seps.length > 1) {
    s = s.replace(/[.,]/g, '')
  } else if (seps.length === 1) {
    const [int, frac] = s.split(/[.,]/)
    s = `${int},${frac.slice(0, opts.maxDecimals ?? 2)}`
  }
  return negative ? `-${s}` : s
}

function group(normalised: string): string {
  const neg = normalised.startsWith('-')
  const body = neg ? normalised.slice(1) : normalised
  const comma = body.indexOf(',')
  const int = comma === -1 ? body : body.slice(0, comma)
  const frac = comma === -1 ? null : body.slice(comma + 1)
  const grouped = int.replace(/^0+(?=\d)/, '').replace(/\B(?=(\d{3})+(?!\d))/g, ' ')
  return `${neg ? '-' : ''}${grouped}${frac === null ? '' : `,${frac}`}`
}

/**
 * Re-format what the user typed and move the caret so it stays after the same
 * digit: «1500000|» → «1 500 000|», «15|00000» → «1 5|00 000».
 */
export function formatNumberDraft(raw: string, caret: number, opts: NumberDraftOptions = {}): { text: string; caret: number } {
  const text = group(normalise(raw, opts))
  // Significant characters left of the caret in what was typed (a separator
  // that the normalisation dropped is not counted).
  const before = normalise(raw.slice(0, Math.max(0, caret)), { ...opts, maxDecimals: 99 })
  let need = before.replace(/[^\d,-]/g, '').length
  let pos = 0
  while (pos < text.length && need > 0) {
    if (SIGNIFICANT.test(text[pos])) need -= 1
    pos += 1
  }
  return { text, caret: Math.min(pos, text.length) }
}

/** The number in a formatted draft; '' / '-' / ',' → null (never 0). */
export function parseNumberDraft(text: string): number | null {
  const compact = text.replace(/[\s  ]/g, '').replace(',', '.')
  if (!/\d/.test(compact)) return null
  const n = Number(compact.endsWith('.') ? compact.slice(0, -1) : compact)
  return Number.isFinite(n) ? n : null
}

/**
 * What the input shows for a stored value: a number grouped, a legacy text
 * answer as typed («около 60 %»), «не знаю» / blank → '', «примерно» → its midpoint.
 */
export function numberDraftFromValue(value: unknown): string {
  if (isUnknownAnswer(value)) return ''
  if (isApproxAnswer(value)) return groupThousands(value.value)
  if (typeof value === 'number' && Number.isFinite(value)) return groupThousands(value)
  if (typeof value === 'string') return value
  return ''
}

/** The «примерно» input's text: «5 000 000 – 6 000 000» for a range, the number otherwise. */
export function approxDraftFromValue(value: unknown): string {
  if (isApproxAnswer(value)) {
    const [min, max] = value.range
    return min === max ? groupThousands(min) : `${groupThousands(min)} – ${groupThousands(max)}`
  }
  if (typeof value === 'number' && Number.isFinite(value)) return groupThousands(value)
  return ''
}

/** «5–6 млн», «около 300 тыс» → the «примерно» answer; unreadable → null. */
export function commitApproxDraft(text: string): ApproxAnswer | null {
  const r = parseApproxRange(text)
  return r ? approxAnswer(r.min, r.max) : null
}

/**
 * Step 1 «год = месяц × 12»: what to write into the year field after the month
 * field rendered. `undefined` = leave the year alone.
 *  • a month (or the midpoint of «примерно») → month × 12, unless the year
 *    already rounds to it (a goal set elsewhere: month = round(year / 12));
 *  • the month was CLEARED / answered «не знаю» → the year is cleared (null) —
 *    it used to become 0;
 *  • no month on first render → the year is left as it is (it may come from
 *    Точка Б / the goals page); it used to be overwritten with 0.
 */
export function autoYearUpdate(month: unknown, year: unknown, monthChanged: boolean): number | null | undefined {
  const m = isUnknownAnswer(month) ? null : isApproxAnswer(month) ? month.value : typeof month === 'number' && Number.isFinite(month) && month > 0 ? month : null
  const y = typeof year === 'number' && Number.isFinite(year) ? year : null
  if (m === null) return monthChanged && y !== null ? null : undefined
  if (y !== null && Math.round(y / 12) === Math.round(m)) return undefined
  return Math.round(m * 12)
}
