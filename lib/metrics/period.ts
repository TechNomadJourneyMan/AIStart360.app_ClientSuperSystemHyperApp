/**
 * lib/metrics/period.ts — what period a value refers to, and how to bring it
 * to the period of a metric.
 *
 * A P&L for Q1 2025 states quarterly revenue; «Выручка (год)» is yearly. The
 * resolver rescales flow values (×4 for a quarter, ×12 for a month, ÷12 for a
 * monthly metric fed by a yearly figure) and records the conversion in the
 * provenance. Point-in-time values, ratios and averages (metric without a
 * period) are never rescaled.
 *
 * Period of a document value, in order: the field's own period label
 * («2025-Q1», «март 2025», «за 9 месяцев 2025»), the document metadata
 * (documents.period_year / period_quarter chosen at upload), the file name
 * and the document text (summary / preview: «за 2025 год», «1 квартал 2025»).
 */

import type { MetricPeriod } from './format'

export interface DetectedPeriod {
  /** Number of months the value covers (12 = year, 3 = quarter, 1 = month, 9 = «9 месяцев»). */
  months: number
  year: number | null
  quarter: 'Q1' | 'Q2' | 'Q3' | 'Q4' | null
  /** Last month covered (1..12) — for ordering by recency. */
  endMonth: number | null
}

const MONTHS: ReadonlyArray<readonly [RegExp, number]> = [
  [/январ|january|jan(?![a-z])/i, 1],
  [/феврал|february|feb(?![a-z])/i, 2],
  [/март|march|mar(?![a-z])/i, 3],
  [/апрел|april|apr(?![a-z])/i, 4],
  [/(?<!\p{L})ма[йя](?!\p{L})|may(?![a-z])/iu, 5],
  [/июн|june|jun(?![a-z])/i, 6],
  [/июл|july|jul(?![a-z])/i, 7],
  [/август|august|aug(?![a-z])/i, 8],
  [/сентябр|september|sep(?![a-z])/i, 9],
  [/октябр|october|oct(?![a-z])/i, 10],
  [/ноябр|november|nov(?![a-z])/i, 11],
  [/декабр|december|dec(?![a-z])/i, 12],
]

const ROMAN: Record<string, number> = { i: 1, ii: 2, iii: 3, iv: 4 }

function yearIn(s: string): number | null {
  const m = s.match(/(?<!\d)(20\d{2}|19\d{2})(?!\d)/)
  return m ? Number(m[1]) : null
}

function quarterOf(n: number): DetectedPeriod['quarter'] {
  return n >= 1 && n <= 4 ? (`Q${n}` as DetectedPeriod['quarter']) : null
}

/**
 * Parse a period label. Returns null when the label names no period
 * («итого», «факт», empty).
 */
export function parsePeriodLabel(raw: string | null | undefined): DetectedPeriod | null {
  if (!raw) return null
  const s = String(raw).toLowerCase().replace(/ё/g, 'е').trim()
  if (!s) return null
  const year = yearIn(s)

  // «9 месяцев 2025», «за 6 мес.»
  const span = s.match(/(?<!\d)(\d{1,2})\s*(?:мес(?:\p{L}*)?\.?|months?)(?!\p{L})/u)
  if (span) {
    const months = Number(span[1])
    if (months >= 1 && months <= 12) return { months, year, quarter: null, endMonth: months }
  }

  // Quarters: «2025-Q1», «Q1 2025», «1 кв. 2025», «I квартал 2025», «1-й квартал»
  const q =
    s.match(/(?<![a-z])q\s*([1-4])(?!\d)/) ??
    s.match(/(?<!\d)([1-4])\s*(?:-?\s*(?:й|ый|ой))?\s*(?:кв(?:\.|артал\p{L}*)?)(?!\p{L})/u) ??
    s.match(/(?<![a-z])(i{1,3}|iv)\s*(?:кв(?:\.|артал\p{L}*)?)(?!\p{L})/u)
  if (q) {
    const n = /^\d$/.test(q[1]) ? Number(q[1]) : ROMAN[q[1]] ?? 0
    if (n >= 1 && n <= 4) return { months: 3, year, quarter: quarterOf(n), endMonth: n * 3 }
  }

  // Half-year: «1 полугодие 2025», «H1 2025»
  const h = s.match(/(?<![a-z])h([12])(?!\d)/) ?? s.match(/(?<!\d)([12])\s*(?:-?\s*(?:е|ое))?\s*полугод/u)
  if (h) return { months: 6, year, quarter: null, endMonth: Number(h[1]) * 6 }

  // Month ranges: «январь–март 2025» → a quarter-length span
  const named = MONTHS.filter(([re]) => re.test(s)).map(([, n]) => n)
  if (named.length >= 2) {
    const from = Math.min(...named)
    const to = Math.max(...named)
    const months = to - from + 1
    const quarter = months === 3 && from % 3 === 1 ? quarterOf((from + 2) / 3) : null
    return { months, year, quarter, endMonth: to }
  }
  if (named.length === 1) return { months: 1, year, quarter: null, endMonth: named[0] }

  // «2025-03», «03.2025», «03/2025»
  const ym = s.match(/(?<!\d)(20\d{2})[-./](0?[1-9]|1[0-2])(?!\d)/) ?? null
  if (ym) return { months: 1, year: Number(ym[1]), quarter: null, endMonth: Number(ym[2]) }
  const my = s.match(/(?<![\d.])(0?[1-9]|1[0-2])[./](20\d{2})(?!\d)/)
  if (my) return { months: 1, year: Number(my[2]), quarter: null, endMonth: Number(my[1]) }

  // «месяц», «в месяц» without a date
  if (/(?<!\p{L})(месяц\p{L}*|monthly|month)(?!\p{L})/u.test(s)) return { months: 1, year, quarter: null, endMonth: null }
  if (/(?<!\p{L})(квартал\p{L}*|quarterly|quarter)(?!\p{L})/u.test(s)) return { months: 3, year, quarter: null, endMonth: null }

  // A bare year or «за 2025 год», «FY2025»
  if (year !== null) return { months: 12, year, quarter: null, endMonth: 12 }
  if (/(?<!\p{L})(год\p{L}*|annual|yearly|fy)(?!\p{L})/u.test(s)) return { months: 12, year: null, quarter: null, endMonth: 12 }
  return null
}

/** Period text from the document's own summary / preview / file name («за 1 квартал 2025 года»). */
export function periodFromText(text: string | null | undefined): DetectedPeriod | null {
  if (!text) return null
  const s = text.slice(0, 4000).toLowerCase().replace(/ё/g, 'е')
  // Only phrases that clearly state the reporting period — a bare year in a
  // long text may be anything (founding year, a contract date).
  const patterns: RegExp[] = [
    /за\s+(?:\d{1,2}\s*месяц\p{L}*|[1-4i]{1,3}v?\s*(?:-?\s*(?:й|ый))?\s*квартал\p{L}*|[1-2]\s*полугод\p{L}*|\p{L}+\s*[-–]\s*\p{L}+|\p{L}+)\s+20\d{2}/u,
    /за\s+20\d{2}\s*(?:г\.?|год\p{L}*)/u,
    /(?:q[1-4]|[1-4]\s*кв\.?)\s*20\d{2}/u,
    /20\d{2}\s*[-–]?\s*q[1-4]/u,
    /(?:fy|financial year)\s*20\d{2}/u,
    /период[:\s]+[^\n]{0,40}20\d{2}/u,
  ]
  for (const re of patterns) {
    const m = s.match(re)
    if (m) {
      const p = parsePeriodLabel(m[0])
      if (p) return p
    }
  }
  return null
}

/** Months in a metric period. */
export function monthsOf(period: MetricPeriod): number {
  return period === 'year' ? 12 : period === 'quarter' ? 3 : 1
}

/** Human label of a period length: 'year' / 'quarter' / 'month' / 'months:9'. */
export function periodLength(months: number): string {
  if (months === 12) return 'year'
  if (months === 3) return 'quarter'
  if (months === 1) return 'month'
  return `months:${months}`
}

/**
 * Factor that brings a value covering `sourceMonths` to the metric period.
 * 1 when the metric has no period (point value / ratio) or the source period
 * is unknown.
 */
export function periodFactor(sourceMonths: number | null, target: MetricPeriod | null | undefined): number {
  if (!target || !sourceMonths || sourceMonths <= 0) return 1
  return monthsOf(target) / sourceMonths
}

/** Sort key: later end of period = larger. Unknown periods sort last. */
export function periodRank(p: DetectedPeriod | null): number {
  if (!p || p.year === null) return -1
  return p.year * 12 + (p.endMonth ?? 12)
}

export function quarterToPeriod(year: number | null, quarter: string | null): DetectedPeriod | null {
  if (!quarter) return year !== null ? { months: 12, year, quarter: null, endMonth: 12 } : null
  const m = /q?\s*([1-4])/i.exec(quarter)
  if (!m) return year !== null ? { months: 12, year, quarter: null, endMonth: 12 } : null
  const n = Number(m[1])
  return { months: 3, year, quarter: quarterOf(n), endMonth: n * 3 }
}
