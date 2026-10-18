/**
 * lib/point-b/model/format.ts — numbers in the texts of the model (Russian: a space between the
 * thousands, a comma for decimals). Plain functions, so the texts do not depend on the ICU data of
 * the runtime. A number that is not finite is shown as «—», never as «NaN».
 */
const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n)

function group(intPart: string): string {
  return intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')
}

/** 1234567.891 → «1 234 568» (digits = 0), «1 234 567,9» (digits = 1). */
export function fmtNum(n: number | null | undefined, digits = 0): string {
  if (!finite(n)) return '—'
  const neg = n < 0 ? '−' : ''
  const fixed = Math.abs(n).toFixed(digits)
  const [i, f] = fixed.split('.')
  return `${neg}${group(i)}${f ? `,${f}` : ''}`
}

/** A fraction as percent: 0.125 → «13%» (digits = 0), «12,5%» (digits = 1). */
export function fmtPct(fraction: number | null | undefined, digits = 0): string {
  if (!finite(fraction)) return '—'
  return `${fmtNum(fraction * 100, digits)}%`
}

/** 62 400 000 → «62,4 млн ₸»; 1 250 000 000 → «1,25 млрд ₸»; 850 000 → «850 тыс. ₸». */
export function fmtMoney(n: number | null | undefined): string {
  if (!finite(n)) return '—'
  const a = Math.abs(n)
  if (a >= 1e9) return `${fmtNum(n / 1e9, 2).replace(/,?0+$/, '')} млрд ₸`
  if (a >= 1e6) return `${fmtNum(n / 1e6, 1).replace(/,0$/, '')} млн ₸`
  if (a >= 1e3) return `${fmtNum(n / 1e3, a >= 1e4 ? 0 : 1).replace(/,0$/, '')} тыс. ₸`
  return `${fmtNum(n, 0)} ₸`
}

export const fmtMonths = (n: number | null | undefined): string => (finite(n) ? `${fmtNum(n, 0)} мес.` : '—')

/** «×1,4» for a multiplier. */
export function fmtTimes(n: number | null | undefined): string {
  return finite(n) ? `×${fmtNum(n, 1).replace(/,0$/, '')}` : '—'
}

/** A ratio that may be undefined (division by zero) → null instead of Infinity / NaN. */
export function safeRatio(a: number, b: number): number | null {
  if (!finite(a) || !finite(b) || b === 0) return null
  const r = a / b
  return finite(r) ? r : null
}

/** Rounds to `digits` decimals and refuses to return anything but a finite number. */
export function round(n: number, digits = 2): number {
  if (!finite(n)) return 0
  const f = 10 ** digits
  return Math.round(n * f) / f
}
