/**
 * lib/data-layer/period-key.ts — stable keys and ordering of calendar periods.
 */
import type { PeriodRef } from './types'

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n)
}

/** '2024' | '2024-Q2' | '2024-03' | '2026-YTD' | 'unknown'. */
export function periodKey(p: PeriodRef | null | undefined): string {
  if (!p) return 'unknown'
  if (p.ytd) return `${p.year}-YTD`
  if (p.month) return `${p.year}-${pad2(p.month)}`
  if (p.quarter) return `${p.year}-Q${p.quarter}`
  return String(p.year)
}

/** End of the period in months since year 0 (for ordering), null when unknown. */
export function periodOrdinal(p: PeriodRef | null | undefined): number | null {
  if (!p) return null
  const endMonth = p.month ?? (p.quarter ? p.quarter * 3 : 12)
  return p.year * 12 + endMonth
}

function quarterOf(q: string | number | null | undefined): PeriodRef['quarter'] {
  if (q === null || q === undefined || q === '') return null
  const n = typeof q === 'number' ? q : Number(String(q).replace(/^q/i, ''))
  return n === 1 || n === 2 || n === 3 || n === 4 ? n : null
}

/** Period from stored columns (period_year / period_quarter 'Q1' | 1 / period_month). */
export function periodFromParts(
  year?: number | null,
  quarter?: string | number | null,
  month?: number | null,
): PeriodRef | null {
  if (typeof year !== 'number' || !Number.isFinite(year)) return null
  const m = typeof month === 'number' && month >= 1 && month <= 12 ? month : null
  return { year, quarter: m ? (Math.ceil(m / 3) as 1 | 2 | 3 | 4) : quarterOf(quarter), month: m }
}

/** Parse a key produced by periodKey back into a period. */
export function parsePeriodKey(key: string): PeriodRef | null {
  let m = /^(\d{4})$/.exec(key)
  if (m) return { year: Number(m[1]), quarter: null, month: null }
  m = /^(\d{4})-Q([1-4])$/.exec(key)
  if (m) return { year: Number(m[1]), quarter: Number(m[2]) as 1 | 2 | 3 | 4, month: null }
  m = /^(\d{4})-(\d{2})$/.exec(key)
  if (m) {
    const month = Number(m[2])
    if (month >= 1 && month <= 12) return { year: Number(m[1]), quarter: Math.ceil(month / 3) as 1 | 2 | 3 | 4, month }
  }
  m = /^(\d{4})-YTD$/.exec(key)
  if (m) return { year: Number(m[1]), quarter: null, month: null, ytd: true }
  return null
}

/** Human label: «2024», «II кв. 2024», «03.2024», «2026 (с начала года)», «период неизвестен». */
export function periodLabel(key: string): string {
  const p = parsePeriodKey(key)
  if (!p) return 'период неизвестен'
  if (p.ytd) return `${p.year} (с начала года)`
  if (p.month) return `${pad2(p.month)}.${p.year}`
  if (p.quarter) return `${['I', 'II', 'III', 'IV'][p.quarter - 1]} кв. ${p.year}`
  return String(p.year)
}
