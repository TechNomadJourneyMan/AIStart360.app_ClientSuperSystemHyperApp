/**
 * lib/metrics/numbers.ts — read ONE number out of an answer or a document cell.
 *
 * Owners type free text into survey fields («около 5 млн в месяц», «8 из 10»,
 * «2–3 млн», «нет данных»). The old coercion stripped every non-digit and glued
 * what was left together («8 из 10» → 810, which then showed up as a churn of
 * 810 %). The rules here:
 *
 *   • exactly one number, optionally with a scale word (тыс / млн / млрд / k /
 *     m / bn), a currency (₸ тг тенге KZT $ € ₽), a percent sign, a period word
 *     («в месяц», «/год», «в квартал») and an approximator («около», «~»);
 *   • unit nouns are allowed («30 дней», «12 сотрудников», «45 мин»);
 *   • a range («2–3 млн», «от 5 до 7»), a ratio («8 из 10», «8/10», «3:1»),
 *     several numbers or any other words → null (never a guess);
 *   • numeric JSON values pass through unchanged.
 *
 * `parseScale` reads a score on a 0..max scale («8 из 10», «8/10», «8»).
 */

import type { MetricPeriod } from './format'

export interface ParsedNumber {
  value: number
  /** A percent sign / «процент» was written. */
  percent: boolean
  /** Period word written next to the number. */
  period: MetricPeriod | null
  /** Currency written next to the number. */
  currency: '₸' | '$' | '€' | '₽' | null
}

/** Words that may accompany a single number without changing its meaning. */
const ALLOWED_WORDS: readonly RegExp[] = [
  // scale
  /^(тыс|тысяч[аи]?|тысяч|т|k|к|млн|миллион(а|ов)?|m|м|млрд|миллиард(а|ов)?|bn|b|mln|mn)$/,
  // currency
  /^(тг|тенге|kzt|usd|eur|руб|рублей|рубля|долл|долларов)$/,
  // percent
  /^(процент(а|ов)?|проц)$/,
  // period
  /^(в|за|на|per|a|в\/|ежемесячно|ежеквартально|ежегодно|monthly|quarterly|yearly|annually|annual|month|year|quarter|мес|месяц|месяца|месяцев|кв|квартал|квартала|год|года|году|г|день|сутки)$/,
  // approximators
  // (bounds such as «до», «более», «свыше» are not a value → the answer is rejected)
  /^(около|примерно|приблизительно|порядка|где|то|почти|ок|approx|about|around|~)$/,
  // unit nouns
  /^(дн|дня|дней|день|days?|шт|штук[аи]?|ед|единиц[аы]?|чел|человек[а]?|сотрудник(а|ов)?|клиент(а|ов)?|сдел(ка|ки|ок)|лид(а|ов)?|заказ(а|ов)?|заяв(ка|ки|ок)|звон(ок|ка|ков)|раз[а]?|мин|минут[аы]?|час(а|ов)?|ч|sku|позици[йия]|товар(а|ов)?|подписчик(а|ов)?|визит(а|ов)?|посещени[йея])$/,
]

function hasRange(s: string): boolean {
  if (/\d\s*(?:-|–|—|\.\.\.?|…)\s*\d/.test(s.replace(/^[\s~≈]*[-−–]/, ''))) return true
  if (/(?<!\p{L})от\s*[\d.,]+[^\d]{0,12}?\s+до\s*[\d.,]+/iu.test(s)) return true
  if (/\d[\d\s.,]*(?:тыс|млн|млрд|k|m)?\.?\s+до\s+\d/i.test(s)) return true
  return false
}

function hasRatio(s: string): boolean {
  return /\d\s*(?:из|of|\/|:)\s*\d/i.test(s)
}

/** Parse the digits of one numeric token: «84 200 000», «84,2», «1.234.567», «84,200,000». */
function tokenValue(token: string): number | null {
  let t = token.replace(/[\s   ]/g, '')
  const neg = /^[-−]/.test(t)
  t = t.replace(/^[-−+]/, '')
  if (!/^\d[\d.,]*$/.test(t)) return null
  const commas = (t.match(/,/g) ?? []).length
  const dots = (t.match(/\./g) ?? []).length
  if (commas > 0 && dots > 0) {
    // the last separator is the decimal one
    if (t.lastIndexOf(',') > t.lastIndexOf('.')) t = t.replace(/\./g, '').replace(',', '.')
    else t = t.replace(/,/g, '')
  } else if (commas > 1) {
    t = t.replace(/,/g, '')
  } else if (dots > 1) {
    t = t.replace(/\./g, '')
  } else if (commas === 1) {
    // «84,200» with exactly 3 digits after the comma and a leading group → thousands
    t = /^\d{1,3},\d{3}$/.test(t) && !/^0,/.test(t) ? t.replace(',', '') : t.replace(',', '.')
  }
  const n = Number(t)
  if (!Number.isFinite(n)) return null
  return neg ? -n : n
}

function detectScale(rest: string): number {
  if (/(?:^|[^a-zа-яё])(млрд|миллиард\p{L}*|bn|b)(?![a-zа-яё])/iu.test(rest)) return 1e9
  if (/(?:^|[^a-zа-яё])(млн|миллион\p{L}*|mln|mn|m|м)(?![a-zа-яё])/iu.test(rest)) return 1e6
  if (/(?:^|[^a-zа-яё])(тыс\p{L}*|k|к|т)(?![a-zа-яё])/iu.test(rest)) return 1e3
  return 1
}

function detectPeriod(rest: string): MetricPeriod | null {
  if (/(ежемесячн|monthly|per\s*month|a\s*month|(?<!\p{L})мес(?:яц\p{L}*)?(?!\p{L}))/iu.test(rest)) return 'month'
  if (/(ежекварт|quarterly|per\s*quarter|(?<!\p{L})кв(?:артал\p{L}*)?(?!\p{L}))/iu.test(rest)) return 'quarter'
  if (/(ежегодн|yearly|annual|per\s*year|a\s*year|(?<!\p{L})(?:год\p{L}*|г)(?!\p{L}))/iu.test(rest)) return 'year'
  return null
}

function detectCurrency(s: string): ParsedNumber['currency'] {
  if (/₸|тенге|(?<!\p{L})тг(?!\p{L})|kzt/iu.test(s)) return '₸'
  if (/\$|usd|долл/i.test(s)) return '$'
  if (/€|eur/i.test(s)) return '€'
  if (/₽|руб/i.test(s)) return '₽'
  return null
}

/**
 * One number with its percent / period / currency annotations, or null when
 * the input is not exactly one number (range, ratio, free text, several numbers).
 */
export function parseNumber(raw: unknown): ParsedNumber | null {
  if (raw === null || raw === undefined) return null
  if (typeof raw === 'number') return Number.isFinite(raw) ? { value: raw, percent: false, period: null, currency: null } : null
  if (typeof raw === 'boolean') return { value: raw ? 1 : 0, percent: false, period: null, currency: null }
  if (typeof raw !== 'string') return null
  const s = raw.replace(/[   ]/g, ' ').trim()
  if (s === '' || !/\d/.test(s)) return null
  if (hasRatio(s) || hasRange(s)) return null

  // Wrapped negative «(500 000)» = −500 000 (accounting notation).
  const accountingNeg = /^\(\s*[\d\s.,]+\s*\)/.test(s)
  const body = accountingNeg ? s.replace(/^\(\s*([\d\s.,]+)\s*\)/, '$1') : s

  const tokens = body.match(/[-−+]?\d(?:[\d.,]|[\s ](?=\d{3}(?!\d)))*/g) ?? []
  if (tokens.length !== 1) return null
  let value = tokenValue(tokens[0])
  if (value === null) return null
  if (accountingNeg) value = -Math.abs(value)

  const rest = body.replace(tokens[0], ' ').toLowerCase()
  const percent = /%|процент/.test(rest)
  // Every remaining word must be a known companion word.
  const words = rest
    .replace(/[%₸$€₽~≈±+().,;:!?«»"'/\\]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
  for (const w of words) {
    if (!ALLOWED_WORDS.some((re) => re.test(w))) return null
  }
  const scale = percent ? 1 : detectScale(rest)
  return {
    value: value * scale,
    percent,
    period: detectPeriod(rest),
    currency: detectCurrency(rest),
  }
}

/**
 * Absolute value of an answer, or null. A percentage («+15%») is a relative
 * figure and never an absolute value — use `parseNumber(...).percent` where a
 * percent is the expected unit.
 */
export function coerceNumber(raw: unknown): number | null {
  const p = parseNumber(raw)
  if (!p || p.percent) return null
  return p.value
}

/**
 * A score on a 0..max scale: «8 из 10», «8/10», «8» → 8. A score written on
 * another scale («4 из 5») is converted proportionally; anything outside the
 * scale or not a score → null.
 */
export function parseScale(raw: unknown, max: number): number | null {
  if (typeof raw === 'number') return Number.isFinite(raw) && raw >= 0 && raw <= max ? raw : null
  if (typeof raw !== 'string') return null
  const m = raw.trim().replace(',', '.').match(/^(\d+(?:\.\d+)?)\s*(?:из|of|\/)\s*(\d+(?:\.\d+)?)\s*(?:баллов|балла|балл)?$/i)
  if (m) {
    const v = Number(m[1])
    const outOf = Number(m[2])
    if (!Number.isFinite(v) || !Number.isFinite(outOf) || outOf <= 0 || v > outOf) return null
    return Math.round((v / outOf) * max * 100) / 100
  }
  const single = parseNumber(raw.replace(/\s*(баллов|балла|балл)\s*$/i, ''))
  if (!single || single.percent) return null
  return single.value >= 0 && single.value <= max ? single.value : null
}
