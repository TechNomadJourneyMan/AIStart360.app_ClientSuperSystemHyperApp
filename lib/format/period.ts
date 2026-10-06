/**
 * lib/format/period.ts — the reporting period of a date in the business time
 * zone (Asia/Almaty), as shown in page headers: «IV квартал 2026».
 *
 * The quarter is taken from the calendar date in that zone, not in UTC or the
 * server's zone, so the label flips at local midnight of 1 Jan / 1 Apr /
 * 1 Jul / 1 Oct.
 */

export const BUSINESS_TIME_ZONE = 'Asia/Almaty'

const ROMAN = ['I', 'II', 'III', 'IV'] as const

export interface Quarter {
  year: number
  quarter: 1 | 2 | 3 | 4
}

export function quarterOf(date: Date, timeZone: string = BUSINESS_TIME_ZONE): Quarter {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    throw new RangeError('quarterOf: invalid date')
  }
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: 'numeric' }).formatToParts(date)
  const year = Number(parts.find((p) => p.type === 'year')?.value)
  const month = Number(parts.find((p) => p.type === 'month')?.value)
  return { year, quarter: (Math.floor((month - 1) / 3) + 1) as Quarter['quarter'] }
}

/** «IV квартал 2026» for any date in October–December 2026 (Asia/Almaty). */
export function quarterLabel(date: Date = new Date(), timeZone: string = BUSINESS_TIME_ZONE): string {
  const { year, quarter } = quarterOf(date, timeZone)
  return `${ROMAN[quarter - 1]} квартал ${year}`
}
