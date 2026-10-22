/**
 * lib/survey/answer-value.ts — «Не знаю / не считаем» and «примерно» answers
 * (survey audit 2026-10-22, MVP item 3).
 *
 * Stored in survey_answers.answer (and held in the wizard's flat answer map)
 * as ONE object shape:
 *
 *   «не знаю»   { value: null, unknown: true }
 *   «примерно»  { value: <midpoint, integer>, approx: true, range: [min, max] }   0 ≤ min ≤ max
 *   otherwise   { value }                                          (unchanged)
 *
 * Every reader that unwraps `answer.value` therefore sees «не знаю» as null
 * («нет данных», never 0) and «примерно» as a plain number (the midpoint).
 * Only the readers that SHOW an answer to a person need to know about the
 * marks (formatMarkedAnswer → «Не знаю», «≈ 5 500 000 ₸ (5 000 000 – 6 000 000 ₸)»).
 *
 * Pure, browser-safe, no imports (lib/survey-labels uses it). The «карта
 * слепых зон» list is in lib/survey/blind-spots.ts.
 */

export interface UnknownAnswer { value: null; unknown: true }
export interface ApproxAnswer { value: number; approx: true; range: [number, number] }
export type MarkedAnswer = UnknownAnswer | ApproxAnswer

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v)

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

export function isUnknownAnswer(v: unknown): v is UnknownAnswer {
  return isPlainObject(v) && v.unknown === true && v.value === null
}

export function isApproxAnswer(v: unknown): v is ApproxAnswer {
  if (!isPlainObject(v) || v.approx !== true || !finite(v.value)) return false
  const r = v.range
  return Array.isArray(r) && r.length === 2 && finite(r[0]) && finite(r[1]) && r[0] <= r[1]
}

export function isMarkedAnswer(v: unknown): v is MarkedAnswer {
  return isUnknownAnswer(v) || isApproxAnswer(v)
}

export function unknownAnswer(): UnknownAnswer {
  return { value: null, unknown: true }
}

/** «Примерно от `a` до `b`» (bounds in any order); one number → a point range. */
export function approxAnswer(a: number, b: number): ApproxAnswer {
  const min = Math.min(a, b)
  const max = Math.max(a, b)
  return { value: Math.round((min + max) / 2), approx: true, range: [min, max] }
}

/** Wizard value → the stored envelope (a mark is stored as is). */
export function toAnswerEnvelope(v: unknown): Record<string, unknown> {
  if (isUnknownAnswer(v)) return { value: null, unknown: true }
  if (isApproxAnswer(v)) return { value: v.value, approx: true, range: [v.range[0], v.range[1]] }
  return { value: v }
}

/** Stored envelope → the wizard value (a mark stays a mark, otherwise `.value`). */
export function fromAnswerEnvelope(answer: unknown): unknown {
  if (answer === null || answer === undefined) return undefined
  if (isMarkedAnswer(answer)) return toAnswerEnvelope(answer)
  if (isPlainObject(answer) && 'value' in answer) return answer.value
  return answer
}

/**
 * The value a reader computes with: «не знаю» → null, «примерно» → the
 * midpoint; a `{ value }` envelope is unwrapped; anything else is returned.
 * Never falls back to the envelope itself (the old `answer?.value ?? answer`
 * handed `{ value: null, … }` objects to the engines).
 */
export function unwrapAnswer(answer: unknown): unknown {
  if (isUnknownAnswer(answer)) return null
  if (isApproxAnswer(answer)) return answer.value
  if (isPlainObject(answer) && 'value' in answer) return unwrapAnswer(answer.value)
  return answer
}

const MULTIPLIERS: Array<[RegExp, number]> = [
  [/^(млрд|миллиард\p{L}*|b|bn)$/iu, 1e9],
  [/^(млн|миллион\p{L}*|m|mln|мм)$/iu, 1e6],
  [/^(тыс|тысяч\p{L}*|т|k|к)$/iu, 1e3],
]

function multiplierOf(word: string | undefined): number | null {
  if (!word) return 1
  const w = word.replace(/\.$/, '')
  for (const [re, m] of MULTIPLIERS) if (re.test(w)) return m
  return null
}

// One amount: optional minus, digits with spaces / NBSP between groups, an
// optional decimal part, then an optional multiplier word (млн, тыс, k …).
const AMOUNT_RE = /(-?\d[\d\s  ]*(?:[.,]\d+)?)\s*([\p{L}]+\.?)?/u

function amountFrom(numText: string, unitWord: string | undefined): number | null {
  const compact = numText.replace(/[\s  ]/g, '').replace(',', '.')
  const n = Number(compact)
  if (!Number.isFinite(n)) return null
  const m = multiplierOf(unitWord)
  if (m === null) return n // a word that is not a multiplier (₸, дней …) — ignore it
  return n * m
}

/** «1 500 000», «12,5», «5 млн», «300к», «1 500 000 ₸» → number; blank / words → null. */
export function parseLooseNumber(raw: unknown): number | null {
  if (finite(raw)) return raw
  if (typeof raw !== 'string') return null
  const s = raw.trim()
  if (!s) return null
  const m = s.match(AMOUNT_RE)
  if (!m) return null
  const v = amountFrom(m[1], m[2])
  return v === null || !Number.isFinite(v) ? null : v
}

/** The numeric value of a wizard / stored answer: unknown → null, approx → midpoint, «1 500 000» → 1500000. */
export function answerNumber(v: unknown): number | null {
  const u = unwrapAnswer(v)
  if (finite(u)) return u
  if (typeof u === 'string') return parseLooseNumber(u)
  return null
}

// «до» needs spaces around it: \b does not see Cyrillic letters as word characters.
const RANGE_SPLIT_RE = /\s*(?:[–—]|-(?=\s*\d)|\.\.)\s*|\s+до\s+/u

/**
 * «5–6 млн», «от 5 до 6 млн», «500 тыс – 1 млн», «5 000 000 — 6 000 000»,
 * «около 5 млн», «~300 тыс» → { min, max, mid }. A multiplier written only
 * after the second number applies to both («5–6 млн»). Negative → null.
 */
export function parseApproxRange(raw: string): { min: number; max: number; mid: number } | null {
  const s = raw.trim().toLowerCase().replace(/^(около|примерно|приблизительно|от|~|≈)\s*/u, '').trim()
  if (!s || /^-/.test(s)) return null
  const parts = s.split(RANGE_SPLIT_RE).map((p) => p.trim()).filter(Boolean)
  if (parts.length === 0 || parts.length > 2) return null
  const parsed = parts.map((p) => {
    const m = p.match(/^(\d[\d\s  ]*(?:[.,]\d+)?)\s*([\p{L}]+\.?)?/u)
    return m ? { num: m[1], unit: m[2] } : null
  })
  if (parsed.some((p) => p === null)) return null
  const [first, second] = parsed as Array<{ num: string; unit: string | undefined }>
  const a = amountFrom(first.num, first.unit ?? second?.unit)
  const b = second ? amountFrom(second.num, second.unit) : a
  if (a === null || b === null || a < 0 || b < 0) return null
  const min = Math.min(a, b)
  const max = Math.max(a, b)
  return { min, max, mid: Math.round((min + max) / 2) }
}

/** 5500000 → «5 500 000» (plain spaces; decimals keep a comma). */
export function groupThousands(n: number): string {
  const neg = n < 0
  const [int, frac] = Math.abs(n).toString().split('.')
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')
  return `${neg ? '-' : ''}${grouped}${frac ? `,${frac}` : ''}`
}

/** «Не знаю» / «≈ 5 500 000 ₸ (5 000 000 – 6 000 000 ₸)»; null for an unmarked answer. */
export function formatMarkedAnswer(v: unknown, unit = ''): string | null {
  if (isUnknownAnswer(v)) return 'Не знаю'
  if (!isApproxAnswer(v)) return null
  const u = unit ? ` ${unit}` : ''
  const [min, max] = v.range
  if (min === max) return `≈ ${groupThousands(v.value)}${u}`
  return `≈ ${groupThousands(v.value)}${u} (${groupThousands(min)} – ${groupThousands(max)}${u})`
}
