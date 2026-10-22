/**
 * lib/point-b/insights/numbers.ts — «числа только из модели» (plan Ф6a, Global Constraints). Pure.
 *
 * A number in a text is reduced to a CANONICAL form, so the same value written in different ways
 * compares equal: «62,4», «62.4» → "62.4"; «1 250 000», «1250000» → "1250000"; «−3» → "3" (the sign is
 * part of the wording, not of the number). `allowedNumbers` collects the canonical forms of every number
 * a model result (or a context text) can legitimately show:
 *   - every number that appears in its TEXTS (verdict reason, infeasibility reason, warnings, …);
 *   - every numeric VALUE in the forms the UI writes it (lib/point-b/model/format.ts): whole and one /
 *     two decimals, percent of a fraction, money in тыс. / млн / млрд with its mantissa, «×» multipliers —
 *     and their decompositions (62,4 млн → 62.4 and 62400000).
 * `foreignNumbers(text, allowed)` lists the numbers of a text that are not in the set.
 */
import { fmtMoney, fmtNum, fmtPct, fmtTimes } from '../model/format'

/** A number in Russian or plain writing: groups of thousands by spaces, a comma or a dot for decimals. */
const NUMBER_RE = /\d+(?:[   ]\d{3})*(?:[.,]\d+)?/g

/** «62,40» → "62.4"; «1 250 000» → "1250000"; anything unparsable → null. */
export function canonicalNumber(raw: string): string | null {
  const plain = raw.replace(/[\s  ]/g, '').replace(',', '.')
  const n = Number(plain)
  return Number.isFinite(n) ? String(Math.abs(n)) : null
}

/** The canonical numbers written in a text, in order. */
export function extractNumbers(text: string | null | undefined): string[] {
  if (!text) return []
  const out: string[] = []
  for (const m of text.match(NUMBER_RE) ?? []) {
    const c = canonicalNumber(m)
    if (c !== null) out.push(c)
  }
  return out
}

/** The canonical forms of one value as the UI may write it. */
export function numberVariants(v: number): string[] {
  if (!Number.isFinite(v)) return []
  const texts = [
    fmtNum(v, 0), fmtNum(v, 1), fmtNum(v, 2), fmtMoney(v), fmtTimes(v),
    // fractions are written as percent
    ...(Math.abs(v) <= 10 ? [fmtPct(v, 0), fmtPct(v, 1)] : []),
  ]
  const out = new Set<string>()
  for (const t of texts) for (const c of extractNumbers(t)) out.add(c)
  // the full value of a money mantissa: «62,4 млн ₸» also allows 62400000 written in full
  const money = fmtMoney(v)
  const mant = extractNumbers(money)[0]
  if (mant !== undefined) {
    const scale = /млрд/.test(money) ? 1e9 : /млн/.test(money) ? 1e6 : /тыс/.test(money) ? 1e3 : 1
    const full = Number(mant) * scale
    if (Number.isFinite(full)) out.add(String(Math.round(full)))
  }
  return [...out]
}

/** Every number (canonical) a JSON-safe value can show: numeric leaves in UI forms, numbers inside strings. */
export function allowedNumbers(value: unknown, into: Set<string> = new Set()): Set<string> {
  const walk = (x: unknown, depth: number): void => {
    if (depth > 12 || x === null || x === undefined) return
    if (typeof x === 'number') {
      for (const c of numberVariants(x)) into.add(c)
    } else if (typeof x === 'string') {
      for (const c of extractNumbers(x)) into.add(c)
    } else if (Array.isArray(x)) {
      for (const v of x) walk(v, depth + 1)
    } else if (typeof x === 'object') {
      for (const v of Object.values(x as Record<string, unknown>)) walk(v, depth + 1)
    }
  }
  walk(value, 0)
  return into
}

/** The numbers of `text` that are not in `allowed` (empty = every number is grounded). */
export function foreignNumbers(text: string | null | undefined, allowed: ReadonlySet<string>): string[] {
  return extractNumbers(text).filter((n) => !allowed.has(n))
}
