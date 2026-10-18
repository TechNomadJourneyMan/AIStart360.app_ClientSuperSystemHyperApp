/**
 * components/point-b/cashChartModel.ts — geometry and texts of the cash chart (plan Ф3 Task 5),
 * free of React and of the DOM so it can be tested. Input is the `finance` block of one scenario
 * (`cash` by month 1..H). The geometry never contains NaN or Infinity; a series that cannot be
 * drawn gives `null` and the chart shows an honest placeholder.
 */
import type { ScenarioFinance } from '@/lib/point-b/model/types'
import { fmtAxis, fmtMoney, linePath } from './overviewModel'

export type CashSeries = Pick<ScenarioFinance, 'cash' | 'netProfit' | 'minCash' | 'cashGapMonth' | 'reserveRequired'>

export interface CashChartGeometry {
  width: number
  height: number
  plot: { left: number; right: number; top: number; bottom: number }
  months: number
  line: string
  /** Where the cash is below zero is redrawn in the alarm colour: the clip starts here. */
  zeroY: number
  reserveY: number | null
  gap: { x: number; month: number } | null
  min: { x: number; y: number; month: number; value: number }
  yTicks: Array<{ y: number; label: string }>
  xTicks: Array<{ x: number; label: string }>
}

const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n)
const X_STEPS = [1, 2, 3, 6, 12, 24, 36, 60]

/** Round ticks over [lo, hi]; lo ≤ 0 ≤ hi is not required. */
export function niceAxis(lo: number, hi: number): { lo: number; hi: number; ticks: number[] } | null {
  if (!finite(lo) || !finite(hi)) return null
  const span = hi > lo ? hi - lo : Math.max(1, Math.abs(hi))
  const raw = span / 4
  const mag = Math.pow(10, Math.floor(Math.log10(raw)))
  const norm = raw / mag
  const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10) * mag
  const bottom = Math.floor(lo / step) * step
  const top = Math.max(Math.ceil(hi / step) * step, bottom + step)
  const ticks: number[] = []
  for (let v = bottom; v <= top + step / 1000; v += step) ticks.push(Math.abs(v) < step / 1e6 ? 0 : v)
  return { lo: bottom, hi: top, ticks }
}

export function cashGeometry(f: CashSeries, width: number, height: number): CashChartGeometry | null {
  const cash = f.cash
  if (cash.length < 2 || !cash.every(finite) || !finite(f.reserveRequired) || !finite(f.minCash.value) || !finite(f.minCash.month)) return null
  const W = Math.min(1200, Math.max(280, finite(width) ? width : 640))
  const H = Math.max(160, finite(height) ? height : 240)
  const plot = { left: 60, right: W - 14, top: 14, bottom: H - 30 }

  const reserve = Math.max(0, f.reserveRequired)
  const axis = niceAxis(Math.min(0, ...cash), Math.max(reserve, ...cash, 0))
  if (!axis) return null
  const months = cash.length
  const x = (m: number) => plot.left + ((m - 1) / (months - 1)) * (plot.right - plot.left)
  const y = (v: number) => plot.top + (1 - (v - axis.lo) / (axis.hi - axis.lo)) * (plot.bottom - plot.top)

  const line = linePath(cash.map((v, i): [number, number] => [x(i + 1), y(v)]))
  if (!line) return null

  const step = X_STEPS.find((s) => months / s <= 6) ?? 60
  const marks = new Set<number>([1])
  for (let m = step; m <= months; m += step) marks.add(m)
  const minMonth = Math.min(months, Math.max(1, Math.round(f.minCash.month)))

  return {
    width: W,
    height: H,
    plot,
    months,
    line,
    zeroY: y(0),
    reserveY: reserve > 0 ? y(reserve) : null,
    gap: f.cashGapMonth !== null && finite(f.cashGapMonth) && f.cashGapMonth >= 1 && f.cashGapMonth <= months
      ? { x: x(f.cashGapMonth), month: Math.round(f.cashGapMonth) }
      : null,
    min: { x: x(minMonth), y: y(cash[minMonth - 1]), month: minMonth, value: f.minCash.value },
    yTicks: axis.ticks.map((v) => ({ y: y(v), label: fmtAxis(v) })),
    xTicks: [...marks].sort((a, b) => a - b).map((m) => ({ x: x(m), label: m === 1 ? '1 мес.' : `${m} мес.` })),
  }
}

/** Month (1..H) under a pointer at `x`. */
export function nearestCashMonth(geo: Pick<CashChartGeometry, 'plot' | 'months'>, x: number): number | null {
  if (!finite(x) || geo.months < 1) return null
  const t = (x - geo.plot.left) / (geo.plot.right - geo.plot.left)
  return Math.min(geo.months, Math.max(1, Math.round(1 + t * (geo.months - 1))))
}

/** Cash and profit of one month, side by side — they are different numbers on purpose. */
export function cashReadout(f: Pick<ScenarioFinance, 'cash' | 'netProfit'>, month: number): string {
  const i = Math.min(f.cash.length, Math.max(1, month)) - 1
  const cash = f.cash[i]
  const profit = f.netProfit[i]
  const parts = [`Месяц ${i + 1}: касса ${fmtMoney(cash)}`]
  if (finite(profit)) parts.push(`прибыль за месяц ${fmtMoney(profit)}`)
  if (cash < 0) parts.push('касса ниже нуля')
  return parts.join(' · ')
}

export function cashSummary(f: CashSeries, scenarioLabel: string): string {
  const parts = [`Касса по месяцам, сценарий «${scenarioLabel}»`, `минимум ${fmtMoney(f.minCash.value)} в месяце ${Math.round(f.minCash.month)}`]
  parts.push(f.cashGapMonth === null ? 'кассового разрыва нет' : `кассовый разрыв в месяце ${Math.round(f.cashGapMonth)}`)
  if (f.reserveRequired > 0) parts.push(`резерв ${fmtMoney(f.reserveRequired)}`)
  return parts.join('; ')
}
