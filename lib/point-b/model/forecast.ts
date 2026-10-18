/**
 * lib/point-b/model/forecast.ts — «куда придёт бизнес при текущем ходе» and the verdict (spec §5,
 * §7). Pure, no clock (the time is `inputs.now`).
 *
 * The trend is the mean monthly growth between the last 6 and the previous 6 months of the revenue
 * history (seasonality removed when ≥ 24 months allow estimating it). It needs 12 months IN A ROW
 * and a history that is not older than 4 months; otherwise the forecast is «insufficient» and the
 * verdict «no_data» — never «отстаём» or «на курсе» from nothing.
 */
import { bandText, deseasonalise, monthOrdinal, trailingRun, volatilityBand } from './bands'
import { fmtMoney, fmtPct } from './format'
import type { Forecast, ModelGoal, ModelInputs, ModelResult, Range } from './types'

export const HISTORY_MIN_MONTHS = 12
export const HISTORY_MAX_LAG_MONTHS = 4
export const ON_TRACK_RATIO = 0.95
export const AT_RISK_RATIO = 0.8

const NO_RANGE: Range = { low: null, base: null, high: null }
const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n)

/** What is wrong with the revenue history, for the warnings. */
export function describeHistory(history: ModelInputs['history'], nowIso: string): {
  points: number
  run: number
  hasGaps: boolean
  lagMonths: number | null
} {
  const run = trailingRun(history)
  const sorted = history.filter((h) => monthOrdinal(h.period) !== null)
  const last = run.length ? monthOrdinal(run[run.length - 1].period) : null
  const now = new Date(nowIso)
  const nowOrd = Number.isFinite(now.getTime()) ? now.getUTCFullYear() * 12 + now.getUTCMonth() : null
  return {
    points: new Set(sorted.map((h) => h.period)).size,
    run: run.length,
    hasGaps: run.length < new Set(sorted.map((h) => h.period)).size,
    lagMonths: last !== null && nowOrd !== null ? Math.max(0, nowOrd - last) : null,
  }
}

export function projectCurrentPace(i: ModelInputs): Forecast {
  const insufficient: Forecast = { atCurrentPace: { ...NO_RANGE }, trendMonthlyPct: null, basis: 'insufficient' }
  const d = describeHistory(i.history, i.now)
  if (d.run < HISTORY_MIN_MONTHS || d.lagMonths === null || d.lagMonths > HISTORY_MAX_LAG_MONTHS) return insufficient

  const run = deseasonalise(trailingRun(i.history), i.history).slice(-HISTORY_MIN_MONTHS)
  const mean = (xs: ModelInputs['history']) => xs.reduce((s, p) => s + p.revenue, 0) / xs.length
  const prev = mean(run.slice(0, 6))
  const last = mean(run.slice(6))
  const growth = prev > 0 ? (last / prev) ** (1 / 6) - 1 : NaN
  if (!finite(growth)) return insufficient

  const base = i.base.revenueYear.value
  const months = i.goal?.months
  if (!finite(base) || base <= 0 || !finite(months) || months < 0) {
    return { atCurrentPace: { ...NO_RANGE }, trendMonthlyPct: growth * 100, basis: 'history' }
  }
  const at = base * (1 + growth) ** months
  if (!finite(at)) return { atCurrentPace: { ...NO_RANGE }, trendMonthlyPct: growth * 100, basis: 'history' }
  const { delta } = volatilityBand(i.history)
  return {
    atCurrentPace: { low: at * (1 - delta), base: at, high: at * (1 + delta) },
    trendMonthlyPct: growth * 100,
    basis: 'history',
  }
}

/** The text of the band behind the forecast range (for the warnings / assumptions). */
export function forecastBandText(history: ModelInputs['history']): string {
  return bandText(volatilityBand(history))
}

const HEADLINE: Record<ModelResult['verdict']['key'], string> = {
  on_track: 'На курсе',
  at_risk: 'Есть риск не дойти до цели',
  behind: 'Отстаём от цели',
  no_data: 'Пока нельзя сказать, успеваете ли вы',
}

export function verdictFor(args: { goal: ModelGoal | null; forecast: Forecast; baseAnnual: number | null }): ModelResult['verdict'] {
  const { goal, forecast, baseAnnual } = args
  const no = (reason: string): ModelResult['verdict'] => ({ key: 'no_data', headline: HEADLINE.no_data, reason })
  if (!goal) return no('Цель по выручке не задана — сравнивать прогноз не с чем.')
  if (goal.months < 1) return no('Срок цели уже прошёл или меньше месяца — задайте новый срок, и мы сравним прогноз с целью.')
  if (forecast.basis === 'insufficient') {
    return no('Для прогноза при текущем ходе нужна история выручки по месяцам: не меньше 12 месяцев подряд, без пропусков и не старше четырёх месяцев.')
  }
  const at = forecast.atCurrentPace.base
  if (!finite(at)) return no('Нет данных, чтобы сравнить прогноз с целью.')

  const ratio = at / goal.targetAnnual
  const key = ratio >= ON_TRACK_RATIO ? 'on_track' : ratio >= AT_RISK_RATIO ? 'at_risk' : 'behind'
  const now = finite(baseAnnual) ? ` Сейчас: ${fmtMoney(baseAnnual)} в год.` : ''
  return {
    key,
    headline: HEADLINE[key],
    reason: `При текущем ходе к ${goal.deadline} выручка выйдет на ${fmtMoney(at)} в год — это ${fmtPct(ratio)} от цели в ${fmtMoney(goal.targetAnnual)}.${now}`,
  }
}
