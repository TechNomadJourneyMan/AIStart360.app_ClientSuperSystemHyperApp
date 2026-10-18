/**
 * lib/point-b/model/bands.ts — uncertainty bands (spec §9.4): `base ± band`, where the band is the
 * volatility of the revenue itself when there are ≥ 12 monthly facts in a row, otherwise a
 * documented default of ±20% marked «мало данных». A probability of reaching the goal is never
 * derived. Pure.
 */
import { seasonalityIndex } from './funnel'
import { sanitizeHistory } from './inputs'
import type { ModelInputs } from './types'

export const DEFAULT_BAND = 0.2
export const BAND_MIN = 0.05
export const BAND_MAX = 0.5
export const VOLATILITY_MIN_MONTHS = 12
/** The volatility is taken over at most this many of the latest months. */
const VOLATILITY_WINDOW = 36

export function monthOrdinal(period: string): number | null {
  const m = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(period)
  return m ? Number(m[1]) * 12 + Number(m[2]) - 1 : null
}

/** The latest run of consecutive months (no gaps) of an ascending history. */
export function trailingRun(history: ModelInputs['history']): ModelInputs['history'] {
  const h = sanitizeHistory(history)
  let start = h.length
  for (let i = h.length - 1; i >= 0; i--) {
    if (i < h.length - 1 && (monthOrdinal(h[i + 1].period) ?? 0) - (monthOrdinal(h[i].period) ?? 0) !== 1) break
    start = i
  }
  return h.slice(start)
}

/** The series without its seasonal swing (when ≥ 24 months allow estimating one); the index comes from the WHOLE history. */
export function deseasonalise(run: ModelInputs['history'], whole: ModelInputs['history']): ModelInputs['history'] {
  const { index, defaulted } = seasonalityIndex(sanitizeHistory(whole))
  if (defaulted) return run
  return run.map((p) => {
    const m = /^\d{4}-(\d{2})$/.exec(p.period)
    const s = m ? index[Number(m[1]) - 1] : 1
    return { period: p.period, revenue: s > 0 ? p.revenue / s : p.revenue }
  })
}

/** Standard deviation of the monthly growth rates over the latest ≥ 12 months, kept within 5–50%; else 20% by default. */
export function volatilityBand(history: ModelInputs['history']): { delta: number; source: 'history' | 'default' } {
  const run = trailingRun(history)
  if (run.length < VOLATILITY_MIN_MONTHS) return { delta: DEFAULT_BAND, source: 'default' }
  const series = deseasonalise(run.slice(-VOLATILITY_WINDOW), history)
  const rates: number[] = []
  for (let i = 1; i < series.length; i++) rates.push(series[i].revenue / series[i - 1].revenue - 1)
  const mean = rates.reduce((a, b) => a + b, 0) / rates.length
  const sd = Math.sqrt(rates.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, rates.length - 1))
  if (!Number.isFinite(sd)) return { delta: DEFAULT_BAND, source: 'default' }
  return { delta: Math.min(BAND_MAX, Math.max(BAND_MIN, sd)), source: 'history' }
}

export function bandText(b: { delta: number; source: 'history' | 'default' }): string {
  const pct = Math.round(b.delta * 100)
  return b.source === 'history'
    ? `по волатильности выручки за последние месяцы (±${pct}%)`
    : `по умолчанию ±${pct}%: мало данных, диапазон широкий`
}
