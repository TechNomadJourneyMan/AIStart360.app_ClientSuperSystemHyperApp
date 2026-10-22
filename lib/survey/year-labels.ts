/**
 * lib/survey/year-labels.ts — years in questionnaire labels relative to today
 * (survey audit 2026-10-22, MVP item 9: «Годовая выручка 2024» in October 2026).
 *
 * The year is the year the ANSWER DESCRIBES — from the key (`s3_deals_2024`)
 * or from the data layer's table of stated years (`SURVEY_KEY_YEAR`:
 * «Чистая прибыль» is the 2024 reporting year). Keys never change: a label
 * «последний полный год» over `s9n_revenue_2024` would file 2025 revenue under
 * 2024 in the metrics layer and Point A.
 *
 *   2025 in 2026 → «последний полный год (2025)»
 *   2024 in 2026 → «позапрошлый год (2024)»
 *   2023 in 2026 → «3 года назад (2023)»
 *   2026 in 2026 → «текущий год (2026)»
 */
import { SURVEY_KEY_YEAR } from '@/lib/data-layer/survey-periods'

function plural(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10
  const m100 = n % 100
  if (m10 === 1 && m100 !== 11) return one
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few
  return many
}

/** «последний полный год», «позапрошлый год», «3 года назад», «текущий год», «следующий год». */
export function relativeYearWord(year: number, now: Date = new Date()): string {
  const n = now.getFullYear() - year
  if (n === 0) return 'текущий год'
  if (n === 1) return 'последний полный год'
  if (n === 2) return 'позапрошлый год'
  if (n < 0) return n === -1 ? 'следующий год' : `через ${-n} ${plural(-n, 'год', 'года', 'лет')}`
  return `${n} ${plural(n, 'год', 'года', 'лет')} назад`
}

/** «последний полный год (2025)». */
export function yearPhrase(year: number, now: Date = new Date()): string {
  return `${relativeYearWord(year, now)} (${year})`
}

/** The year a question key describes: the stated year of the data layer, else a year in the key. */
export function yearOfKey(key: string): number | null {
  const stated = SURVEY_KEY_YEAR[key]
  if (stated) return stated
  const m = key.match(/_(20\d{2})$/)
  return m ? Number(m[1]) : null
}

/** «Сделок — последний полный год (2025)»; a key without a year → the prefix alone. */
export function yearLabel(prefix: string, key: string, now: Date = new Date()): string {
  const y = yearOfKey(key)
  return y === null ? prefix : `${prefix} — ${yearPhrase(y, now)}`
}
