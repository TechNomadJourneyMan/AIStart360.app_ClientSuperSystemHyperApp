import type { TimeseriesPoint } from '@/types/metrics'

export type TrendLabel =
  | 'strong_growth' // > +15% / period
  | 'steady_growth' // +5..+15% / period
  | 'flat' // -5..+5% / period
  | 'gentle_decline' // -5..-15% / period
  | 'sharp_decline' // < -15% / period
  | 'volatile' // high stddev, no clear direction
  | 'insufficient_data'

export interface TrendAnalysis {
  label: TrendLabel
  /** Russian, e.g. "Стабильный рост: +8% за последние 4 периода" */
  description: string
  /** Russian, e.g. "Растёт" */
  shortLabel: string
  /** % change first-to-last */
  deltaPct: number
  /** Regression slope (per period) */
  slopePerPeriod: number
  /** Coefficient of variation (stddev / |mean|) */
  volatility: number
  direction: 'up' | 'down' | 'flat'
  /** Optional inversion: for metrics like CAC, churn — "down is good". */
  inverse?: boolean
}

const SHORT_LABELS: Record<TrendLabel, string> = {
  strong_growth: 'Быстро растёт',
  steady_growth: 'Растёт',
  flat: 'Стабильно',
  gentle_decline: 'Снижается',
  sharp_decline: 'Резкое падение',
  volatile: 'Колеблется',
  insufficient_data: '—',
}

/** Build a Russian "N периодов" suffix with correct plural form. */
function periodsRu(n: number): string {
  const abs = Math.abs(n)
  const mod10 = abs % 10
  const mod100 = abs % 100
  if (mod10 === 1 && mod100 !== 11) return `${n} период`
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return `${n} периода`
  return `${n} периодов`
}

function mean(values: number[]): number {
  if (values.length === 0) return 0
  let sum = 0
  for (const v of values) sum += v
  return sum / values.length
}

function stddev(values: number[], mu: number): number {
  if (values.length === 0) return 0
  let s = 0
  for (const v of values) {
    const d = v - mu
    s += d * d
  }
  return Math.sqrt(s / values.length)
}

/** Linear regression y = a + b*x where x = index. Returns { slope, intercept, r2 }. */
function linreg(values: number[]): { slope: number; intercept: number; r2: number } {
  const n = values.length
  if (n < 2) return { slope: 0, intercept: values[0] ?? 0, r2: 0 }
  const xs: number[] = []
  for (let i = 0; i < n; i++) xs.push(i)
  const mx = mean(xs)
  const my = mean(values)
  let num = 0
  let den = 0
  for (let i = 0; i < n; i++) {
    num += (xs[i] - mx) * (values[i] - my)
    den += (xs[i] - mx) * (xs[i] - mx)
  }
  const slope = den === 0 ? 0 : num / den
  const intercept = my - slope * mx
  // r²
  let ssRes = 0
  let ssTot = 0
  for (let i = 0; i < n; i++) {
    const pred = intercept + slope * xs[i]
    ssRes += (values[i] - pred) * (values[i] - pred)
    ssTot += (values[i] - my) * (values[i] - my)
  }
  const r2 = ssTot === 0 ? 1 : 1 - ssRes / ssTot
  return { slope, intercept, r2 }
}

function classifyByDelta(deltaPct: number): TrendLabel {
  if (deltaPct > 15) return 'strong_growth'
  if (deltaPct >= 5) return 'steady_growth'
  if (deltaPct > -5) return 'flat'
  if (deltaPct >= -15) return 'gentle_decline'
  return 'sharp_decline'
}

function roundDelta(x: number): number {
  // 1 decimal if |x| < 10, else integer
  if (Math.abs(x) < 10) return Math.round(x * 10) / 10
  return Math.round(x)
}

export function analyzeTrend(
  series: TimeseriesPoint[],
  opts?: { inverse?: boolean; minPoints?: number }
): TrendAnalysis {
  const inverse = opts?.inverse === true
  const minPoints = opts?.minPoints ?? 3

  if (!Array.isArray(series) || series.length < minPoints) {
    return {
      label: 'insufficient_data',
      description: 'Недостаточно данных для оценки тренда',
      shortLabel: SHORT_LABELS.insufficient_data,
      deltaPct: 0,
      slopePerPeriod: 0,
      volatility: 0,
      direction: 'flat',
      inverse,
    }
  }

  const values = series.map((p) => p.value)
  const n = values.length
  const first = values[0]
  const last = values[n - 1]

  const deltaPct = first === 0 ? (last === 0 ? 0 : last > 0 ? Infinity : -Infinity) : ((last - first) / Math.abs(first)) * 100

  const mu = mean(values)
  const sd = stddev(values, mu)
  const cv = Math.abs(mu) < 1e-9 ? (sd === 0 ? 0 : Infinity) : sd / Math.abs(mu)

  const { slope, r2 } = linreg(values)

  // Volatile: high CV, no clear linear direction
  const finiteDelta = Number.isFinite(deltaPct) ? deltaPct : 0
  if (cv > 0.5 && r2 < 0.4) {
    const swingPct = Math.abs(mu) < 1e-9 ? 0 : Math.round((sd / Math.abs(mu)) * 100)
    return {
      label: 'volatile',
      description: `Высокая волатильность: колебания ±${swingPct}%`,
      shortLabel: SHORT_LABELS.volatile,
      deltaPct: finiteDelta,
      slopePerPeriod: slope,
      volatility: cv,
      direction: slope > 0 ? 'up' : slope < 0 ? 'down' : 'flat',
      inverse,
    }
  }

  const rawLabel = classifyByDelta(finiteDelta)

  // Inversion: for "down is good" metrics, remap label semantics.
  // strong_growth(+) (bad) ↔ sharp_decline (becomes "good" surge downward, but raw bad)
  // We swap so the returned `label` reflects business-good direction.
  let label: TrendLabel = rawLabel
  if (inverse) {
    const swap: Record<TrendLabel, TrendLabel> = {
      strong_growth: 'sharp_decline',
      steady_growth: 'gentle_decline',
      flat: 'flat',
      gentle_decline: 'steady_growth',
      sharp_decline: 'strong_growth',
      volatile: 'volatile',
      insufficient_data: 'insufficient_data',
    }
    label = swap[rawLabel]
  }

  const direction: 'up' | 'down' | 'flat' =
    rawLabel === 'flat' ? 'flat' : finiteDelta > 0 ? 'up' : 'down'

  const rounded = roundDelta(finiteDelta)
  const sign = rounded > 0 ? '+' : ''
  const periods = periodsRu(n)

  let description: string
  if (inverse) {
    // For inverse metrics, describe in terms of "good"/"bad" framing.
    const absRounded = Math.abs(rounded)
    if (rawLabel === 'flat') {
      description = `Стабильно: изменение ${sign}${rounded}% за последние ${periods}`
    } else if (finiteDelta < 0) {
      // metric went down => good for inverse
      description = `Хорошо: снизился на ${absRounded}% за последние ${periods}`
    } else {
      // metric went up => bad for inverse
      description = `Внимание: вырос на ${absRounded}% за последние ${periods}`
    }
  } else {
    description = `${SHORT_LABELS[label]}: ${sign}${rounded}% за последние ${periods}`
  }

  return {
    label,
    description,
    shortLabel: SHORT_LABELS[label],
    deltaPct: finiteDelta,
    slopePerPeriod: slope,
    volatility: cv,
    direction,
    inverse,
  }
}
