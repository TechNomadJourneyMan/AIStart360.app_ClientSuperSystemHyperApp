/**
 * lib/metrics/numbers.ts — read ONE number out of an answer or a document cell.
 *
 * Owners type free text into survey fields («около 5 млн в месяц», «8 из 10»,
 * «2–3 млн», «нет данных»). The old coercion stripped every non-digit and glued
 * what was left together («8 из 10» → 810, which then showed up as a churn of
 * 810 %). The rules here:
 *
 *   • exactly one number, optionally with a scale word (тыс / млн / млрд / k /
 *     m / bn), a currency (₸ тг тенге KZT $ € ₽), a percent sign, a RATE
 *     period («в месяц», «/год», «в квартал», «в день», «в неделю»,
 *     «ежемесячно») and an approximator («около», «~»);
 *   • unit nouns are allowed («12 сотрудников», «30 заказов»); a TIME noun
 *     right after the number is a DURATION («30 дней», «3 месяца», «45 мин»,
 *     «2 часа») and is reported in `duration` — the source adapters check it
 *     against the metric's unit (lib/metrics/source-adapters.ts) and convert
 *     or refuse it, never take «3 месяца» as 3 days;
 *   • a time word after a preposition («в», «за», «на», «per», «/») or after a
 *     scale / currency word («5 млн месяц») is a rate period; two different
 *     rates, two different durations or a rate the metrics cannot use
 *     («в час») → null;
 *   • separators: «84 200 000», «84,2», «1.234.567», «84,200,000». A single
 *     comma OR dot followed by exactly three digits (and a 1–3 digit leading
 *     group, not «0,») is a THOUSANDS separator when no scale word and no
 *     percent sign is written («1,200» = «1.200» = 1200); with a scale word or
 *     a percent sign it is always the decimal separator («1,500 млн» = 1.5 млн,
 *     «12.345%» = 12.345 %);
 *   • a range («2–3 млн», «от 5 до 7»), a ratio («8 из 10», «8/10», «3:1»),
 *     several numbers or any other words → null (never a guess);
 *   • numeric JSON values pass through unchanged.
 *
 * `parseScale` reads a score on a 0..max scale («8 из 10», «8/10», «8»).
 */

import type { MetricPeriod } from './format'

/** Length of time a duration noun names. */
export type TimeUnit = 'minute' | 'hour' | 'day' | 'week' | 'month' | 'quarter' | 'year'

/** Period of a rate written next to the number («в месяц», «в день»). */
export type RatePeriod = MetricPeriod | 'day' | 'week'

export interface ParsedNumber {
  value: number
  /** A percent sign / «процент» was written. */
  percent: boolean
  /** Rate period written next to the number («в месяц», «/год», «в день»). */
  period: RatePeriod | null
  /** Currency written next to the number. */
  currency: '₸' | '$' | '€' | '₽' | null
  /** Duration noun right after the number («3 месяца» → 'month', «45 мин» → 'minute'). */
  duration: TimeUnit | null
}

/** Words that may accompany a single number without changing its meaning. */
const ALLOWED_WORDS: readonly RegExp[] = [
  // scale
  /^(тыс|тысяч[аи]?|тысяч|т|k|к|млн|миллион(а|ов)?|m|м|млрд|миллиард(а|ов)?|bn|b|mln|mn)$/,
  // currency
  /^(тг|тенге|kzt|usd|eur|руб|рублей|рубля|долл|долларов)$/,
  // percent
  /^(процент(а|ов)?|проц)$/,
  // rate prepositions / adverbs (the time words themselves are TIME_WORDS)
  /^(в|за|на|per|a|в\/|\/|ежедневно|еженедельно|ежемесячно|ежеквартально|ежегодно|daily|weekly|monthly|quarterly|yearly|annually|annual)$/,
  // approximators
  // (bounds such as «до», «более», «свыше» are not a value → the answer is rejected)
  /^(около|примерно|приблизительно|порядка|где|то|почти|ок|approx|about|around|~)$/,
  // unit nouns
  /^(шт|штук[аи]?|ед|единиц[аы]?|чел|человек[а]?|сотрудник(а|ов)?|клиент(а|ов)?|сдел(ка|ки|ок)|лид(а|ов)?|заказ(а|ов)?|заяв(ка|ки|ок)|звон(ок|ка|ков)|раз[а]?|sku|позици[йия]|товар(а|ов)?|подписчик(а|ов)?|визит(а|ов)?|посещени[йея])$/,
]

/** Time nouns: a duration right after the number, a rate period after «в / за / / …». */
const TIME_WORDS: ReadonlyArray<readonly [RegExp, TimeUnit]> = [
  [/^(мин|минут[аы]?|min|mins|minutes?)$/, 'minute'],
  [/^(ч|час|часа|часов|hours?|hrs?)$/, 'hour'],
  [/^(дн|дня|дней|день|сутки|суток|days?)$/, 'day'],
  [/^(нед|недел[яиюе]|недель|weeks?)$/, 'week'],
  [/^(мес|месяц|месяца|месяцев|months?|month)$/, 'month'],
  [/^(кв|квартал|квартала|кварталов|quarters?)$/, 'quarter'],
  [/^(год|года|году|лет|г|years?)$/, 'year'],
]

const RATE_ADVERBS: ReadonlyArray<readonly [RegExp, RatePeriod]> = [
  [/^(ежедневно|daily)$/, 'day'],
  [/^(еженедельно|weekly)$/, 'week'],
  [/^(ежемесячно|monthly)$/, 'month'],
  [/^(ежеквартально|quarterly)$/, 'quarter'],
  [/^(ежегодно|yearly|annually|annual)$/, 'year'],
]

const RATE_PREPOSITION = /^(в|за|на|per|a|в\/|\/)$/
const SCALE_OR_CURRENCY = [ALLOWED_WORDS[0], ALLOWED_WORDS[1], ALLOWED_WORDS[2]]

/** Duration noun of a word, or null. */
export function timeUnitOf(word: string): TimeUnit | null {
  const w = word.trim().toLowerCase().replace(/ё/g, 'е').replace(/\.$/, '')
  for (const [re, unit] of TIME_WORDS) if (re.test(w)) return unit
  return null
}

const NUMBER_MARK = '\u0000'

function hasRange(s: string): boolean {
  if (/\d\s*(?:-|–|—|\.\.\.?|…)\s*\d/.test(s.replace(/^[\s~≈]*[-−–]/, ''))) return true
  if (/(?<!\p{L})от\s*[\d.,]+[^\d]{0,12}?\s+до\s*[\d.,]+/iu.test(s)) return true
  if (/\d[\d\s.,]*(?:тыс|млн|млрд|k|m)?\.?\s+до\s+\d/i.test(s)) return true
  return false
}

function hasRatio(s: string): boolean {
  return /\d\s*(?:из|of|\/|:)\s*\d/i.test(s)
}

/**
 * Parse the digits of one numeric token: «84 200 000», «84,2», «1.234.567»,
 * «84,200,000». `decimalOnly`: a scale word or a percent sign is written —
 * a single separator is then always the decimal one («1,500 млн» = 1.5 млн).
 */
function tokenValue(token: string, decimalOnly = false): number | null {
  let t = token.replace(/[\s\u00a0\u202f\u2009]/g, '')
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
  } else if (commas === 1 || dots === 1) {
    // One separator, comma or dot alike: «84,200» / «84.200» with exactly 3
    // digits after it and a 1–3 digit leading group → thousands, unless a
    // scale word / percent sign makes it a decimal («1,500 млн», «12.345%»).
    const thousands = !decimalOnly && /^\d{1,3}[.,]\d{3}$/.test(t) && !/^0[.,]/.test(t)
    t = thousands ? t.replace(/[.,]/, '') : t.replace(',', '.')
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
  if (typeof raw === 'number') return Number.isFinite(raw) ? { value: raw, percent: false, period: null, currency: null, duration: null } : null
  if (typeof raw === 'boolean') return { value: raw ? 1 : 0, percent: false, period: null, currency: null, duration: null }
  if (typeof raw !== 'string') return null
  const s = raw.replace(/[\u00a0\u202f\u2009]/g, ' ').trim()
  if (s === '' || !/\d/.test(s)) return null
  if (hasRatio(s) || hasRange(s)) return null

  // Wrapped negative «(500 000)» = −500 000 (accounting notation).
  const accountingNeg = /^\(\s*[\d\s.,]+\s*\)/.test(s)
  const body = accountingNeg ? s.replace(/^\(\s*([\d\s.,]+)\s*\)/, '$1') : s

  const tokens = body.match(/[-−+]?\d(?:[\d.,]|[\s\u00a0](?=\d{3}(?!\d)))*/g) ?? []
  if (tokens.length !== 1) return null

  const rest = body.replace(tokens[0], ` ${NUMBER_MARK} `).toLowerCase()
  const percent = /%|процент/.test(rest)
  const scale = percent ? 1 : detectScale(rest.replace(NUMBER_MARK, ' '))
  let value = tokenValue(tokens[0], percent || scale !== 1)
  if (value === null) return null
  if (accountingNeg) value = -Math.abs(value)

  // Every remaining word must be a known companion word.
  const words = rest
    .replace(/\//g, ' / ')
    .replace(/[%₸$€₽~≈±+().,;:!?«»"'\\]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
  const time = timeAnnotations(words, value)
  if (!time) return null
  for (const w of words) {
    if (w === NUMBER_MARK) continue
    if (!ALLOWED_WORDS.some((re) => re.test(w)) && !timeUnitOf(w)) return null
  }
  return {
    value: value * scale,
    percent,
    period: time.period,
    currency: detectCurrency(rest),
    duration: time.duration,
  }
}

/**
 * Rate period and duration of the words around the number; null when they
 * conflict (two different rates or durations) or name a rate the metrics
 * cannot use («в час», «в минуту»).
 */
function timeAnnotations(words: readonly string[], value: number): { period: RatePeriod | null; duration: TimeUnit | null } | null {
  let period: RatePeriod | null = null
  let duration: TimeUnit | null = null
  const setRate = (p: TimeUnit | RatePeriod): boolean => {
    if (p === 'minute' || p === 'hour') return false
    if (period !== null && period !== p) return false
    period = p
    return true
  }
  for (let i = 0; i < words.length; i++) {
    const w = words[i]
    const adverb = RATE_ADVERBS.find(([re]) => re.test(w))
    if (adverb) {
      if (!setRate(adverb[1])) return null
      continue
    }
    const unit = timeUnitOf(w)
    if (!unit) continue
    const prev = words[i - 1] ?? ''
    if (RATE_PREPOSITION.test(prev)) {
      if (!setRate(unit)) return null
    } else if (prev === NUMBER_MARK) {
      // «2025 г», «2015 год»: a calendar year, not a duration.
      if (unit === 'year' && (w === 'г' || (Number.isInteger(value) && value >= 1900 && value <= 2100))) continue
      if (duration !== null && duration !== unit) return null
      duration = unit
    } else if (SCALE_OR_CURRENCY.some((re) => re.test(prev))) {
      // «5 млн месяц», «500 000 тг мес»: the amount per month.
      if (!setRate(unit)) return null
    } else {
      return null
    }
  }
  return { period, duration }
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
