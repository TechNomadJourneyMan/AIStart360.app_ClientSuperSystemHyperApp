/**
 * lib/survey/calcs/fmt.ts — number words of the field calculations, on top of
 * the plain formatters of the Point B model (lib/point-b/model/format.ts).
 */
import { fmtMoney, fmtNum, fmtTimes } from '@/lib/point-b/model/format'

export { fmtMoney as money, fmtTimes as times }

/** 4.23 → «4,2 %», 64 → «64 %» (one decimal below 10). */
export function pct(x: number): string {
  const digits = Math.abs(x) < 10 ? 1 : 0
  return `${fmtNum(x, digits).replace(/,0$/, '')} %`
}

/** 4.23 → «+4,2 %», −20 → «−20 %». */
export function signedPct(x: number): string {
  return x > 0 ? `+${pct(x)}` : pct(x)
}

/** A count: 29.6 → «30». */
export const count = (x: number): string => fmtNum(Math.round(x), 0)

/** Hours etc. with at most one decimal: 7.5 → «7,5», 8 → «8». */
export const plain = (x: number): string => fmtNum(x, Number.isInteger(x) ? 0 : 1).replace(/,0$/, '')
