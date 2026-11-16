/**
 * lib/point-b/period.ts — ONE rule for «which month is it» in Точка Б (R3-PB review, L5): the calendar month in
 * Asia/Almaty, where the clients and the team are — not UTC. 1 November 02:00 in Almaty is November already (UTC still
 * says October): the month that has just finished is October and the owner may enter it.
 *
 * Used by the plan-fact (lib/point-b/planfact/kpis.ts periodOf → the current and the last finished month, the «Факт
 * за месяц» form), the forecast's history lag (lib/point-b/model/forecast.ts) and the «Выручка по месяцам» table
 * (lib/point-b/finmodel/revenue-history.ts). Kazakhstan has one time zone, UTC+5, no daylight saving; without the
 * ICU time-zone data the fixed offset is used.
 */
export const POINT_B_TIME_ZONE = 'Asia/Almaty'
const FALLBACK_OFFSET_MS = 5 * 3_600_000

let formatter: Intl.DateTimeFormat | null | undefined
function fmt(): Intl.DateTimeFormat | null {
  if (formatter === undefined) {
    try {
      formatter = new Intl.DateTimeFormat('en-CA', { timeZone: POINT_B_TIME_ZONE, year: 'numeric', month: '2-digit' })
    } catch {
      formatter = null
    }
  }
  return formatter
}

/** { year, month 1..12 } of `d` in Almaty. */
export function monthInAlmaty(d: Date): { year: number; month: number } {
  const f = fmt()
  if (f) {
    const parts = f.formatToParts(d)
    const year = Number(parts.find((p) => p.type === 'year')?.value)
    const month = Number(parts.find((p) => p.type === 'month')?.value)
    if (Number.isFinite(year) && month >= 1 && month <= 12) return { year, month }
  }
  const x = new Date(d.getTime() + FALLBACK_OFFSET_MS)
  return { year: x.getUTCFullYear(), month: x.getUTCMonth() + 1 }
}

/** Ordinal of the Almaty month of `d` (year × 12 + month − 1) — comparable with periodOrdinal('YYYY-MM'). */
export function monthOrdinalInAlmaty(d: Date): number {
  const { year, month } = monthInAlmaty(d)
  return year * 12 + month - 1
}

/** 'YYYY-MM' of `d` in Almaty. */
export function periodInAlmaty(d: Date): string {
  const { year, month } = monthInAlmaty(d)
  return `${year}-${String(month).padStart(2, '0')}`
}
