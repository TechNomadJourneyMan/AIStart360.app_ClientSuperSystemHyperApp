/**
 * lib/simulator/core.ts — deterministic business-simulator engine (MVP).
 *
 * Numbers are computed HERE, never by an LLM (the LLM only narrates on top, spec
 * 09). Produces optimistic/realistic/pessimistic monthly projections as RANGES,
 * with explicit assumptions, missing-data and a confidence level — a forecast is
 * never presented as a fact. MVP covers revenue_growth and cost_reduction.
 *
 * R-039 (BI-42): the base pace comes from the client's monthly revenue history (≥ 6 months), the goal is a
 * separate line with a verdict (`target`) and never becomes the forecast; without history the result says
 * «нет данных для прогноза» and shows only a conditional corridor; «Антикризис» never grows above the base.
 */

export type SimType = 'revenue_growth' | 'cost_reduction' | 'anti_crisis'

export interface SimInput {
  simType: SimType
  currentRevenueMonthly: number
  marginPct: number
  horizonMonths: 3 | 6 | 12
  targetRevenueMonthly?: number | null
  monthlyCostsFixed?: number
  costCutPct?: number
  /**
   * The client's monthly revenue by business period, oldest → newest, consecutive months (R-039). The base
   * pace of the forecast comes ONLY from here; fewer than HISTORY_MIN_POINTS positive values → no forecast.
   */
  revenueHistoryMonthly?: number[] | null
}

export interface MonthlyPoint {
  month: number
  revenueRange: [number, number]
  cashRange: [number, number]
}

export interface ScenarioProjection {
  label: string
  monthly: MonthlyPoint[]
  outcome: { revenueEnd: [number, number]; profitEnd: [number, number] }
}

/** Where the goal stands against the forecast (R-039): the goal is a separate line, never the forecast itself. */
export type TargetVerdict = 'reached' | 'on_track' | 'stretch' | 'unrealistic' | 'no_forecast'

export interface SimTarget {
  revenueMonthly: number
  /** The monthly pace the goal needs over the horizon, % (negative for a goal below today). */
  requiredMonthlyGrowthPct: number | null
  verdict: TargetVerdict
  /** Goal − the realistic central revenue at the end of the horizon (₸); null without a forecast. */
  gapAtEnd: number | null
  text: string
}

export interface SimResult {
  scenarios: { optimistic: ScenarioProjection; realistic: ScenarioProjection; pessimistic: ScenarioProjection }
  assumptions: string[]
  missingData: string[]
  confidence: 'low' | 'medium' | 'high'
  /** false — there is no history to forecast from: the scenarios are a conditional corridor, not a forecast. */
  forecastAvailable: boolean
  /** The base pace: from the client's history, or none. */
  base: { source: 'history' | 'none'; points: number; monthlyGrowthPct: number | null }
  /** The goal line with its verdict; null when no goal was given (or for cost_reduction). */
  target: SimTarget | null
}

/** Below this many monthly points the pace is not estimated (R-039 / R-040: the same rule as the metric forecast). */
export const HISTORY_MIN_POINTS = 6
/** At most this many latest months make the pace. */
const HISTORY_WINDOW = 12
/** The smallest spread of the pace between the scenarios, per month. */
const MIN_SPREAD = 0.01
const BAND = 0.1 // ±10% uncertainty band around each scenario's central path

function round(n: number): number {
  return Math.round(n)
}

const pct1 = (g: number) => `${g > 0 ? '+' : ''}${(g * 100).toFixed(1)}%/мес`

function buildScenario(
  label: string,
  currentRevenue: number,
  monthlyGrowth: number,
  horizon: number,
  marginPct: number,
  fixedCosts: number,
): ScenarioProjection {
  const monthly: MonthlyPoint[] = []
  for (let m = 1; m <= horizon; m++) {
    const central = currentRevenue * Math.pow(1 + monthlyGrowth, m)
    const lo = central * (1 - BAND)
    const hi = central * (1 + BAND)
    const profitLo = (lo * marginPct) / 100 - fixedCosts
    const profitHi = (hi * marginPct) / 100 - fixedCosts
    monthly.push({ month: m, revenueRange: [round(lo), round(hi)], cashRange: [round(profitLo), round(profitHi)] })
  }
  const last = monthly[monthly.length - 1]
  return {
    label,
    monthly,
    outcome: { revenueEnd: last.revenueRange, profitEnd: last.cashRange },
  }
}

/**
 * The monthly pace from the history: a log-linear fit over the latest ≤ 12 positive months.
 * `spread` is the standard error of the slope (at least MIN_SPREAD). null below HISTORY_MIN_POINTS points.
 */
export function historyPace(history: ReadonlyArray<number> | null | undefined): { growth: number; spread: number; points: number } | null {
  const pts = (history ?? []).filter((v) => typeof v === 'number' && Number.isFinite(v) && v > 0).slice(-HISTORY_WINDOW)
  const n = pts.length
  if (n < HISTORY_MIN_POINTS) return null
  const y = pts.map((v) => Math.log(v))
  const mx = (n - 1) / 2
  const my = y.reduce((a, b) => a + b, 0) / n
  let sxx = 0
  let sxy = 0
  for (let i = 0; i < n; i++) {
    sxx += (i - mx) ** 2
    sxy += (i - mx) * (y[i] - my)
  }
  const slope = sxy / sxx
  let rss = 0
  for (let i = 0; i < n; i++) rss += (y[i] - (my + slope * (i - mx))) ** 2
  const se = Math.sqrt(rss / (n - 2) / sxx)
  const growth = Math.exp(slope) - 1
  if (!Number.isFinite(growth)) return null
  return { growth, spread: Math.max(MIN_SPREAD, Number.isFinite(se) ? se : 0), points: n }
}

function targetLine(
  target: number, current: number, horizon: number, forecast: boolean,
  ends: { realistic: number; optimistic: number },
): SimTarget {
  const required = Math.pow(target / current, 1 / horizon) - 1
  const requiredPct = Number.isFinite(required) ? Math.round(required * 10000) / 100 : null
  const need = requiredPct === null ? '' : ` Для цели нужен темп ${pct1(required)}.`
  // PO rule: the goal is reached when the monthly run-rate × 12 ≥ the goal × 12, i.e. the month itself ≥ the goal.
  if (current >= target) {
    return { revenueMonthly: target, requiredMonthlyGrowthPct: requiredPct, verdict: 'reached', gapAtEnd: forecast ? round(target - ends.realistic) : null,
      text: `Цель ${round(target)} ₸/мес уже достигнута: текущая выручка ${round(current)} ₸/мес не ниже цели.` }
  }
  if (!forecast) {
    return { revenueMonthly: target, requiredMonthlyGrowthPct: requiredPct, verdict: 'no_forecast', gapAtEnd: null,
      text: `Цель ${round(target)} ₸/мес за ${horizon} мес.${need} Нет данных для прогноза: без истории выручки по месяцам нельзя сказать, реален ли этот темп.` }
  }
  const gap = round(target - ends.realistic)
  if (ends.realistic >= target) {
    return { revenueMonthly: target, requiredMonthlyGrowthPct: requiredPct, verdict: 'on_track', gapAtEnd: gap,
      text: `Цель ${round(target)} ₸/мес достигается при текущем темпе.${need}` }
  }
  if (ends.optimistic >= target) {
    return { revenueMonthly: target, requiredMonthlyGrowthPct: requiredPct, verdict: 'stretch', gapAtEnd: gap,
      text: `Цель ${round(target)} ₸/мес достижима только в оптимистичном сценарии: при текущем темпе не хватит ${round(gap)} ₸/мес.${need}` }
  }
  return { revenueMonthly: target, requiredMonthlyGrowthPct: requiredPct, verdict: 'unrealistic', gapAtEnd: gap,
    text: `Цель ${round(target)} ₸/мес нереальна при текущем темпе: к концу периода не хватит ${round(gap)} ₸/мес даже в оптимистичном сценарии.${need}` }
}

export function runSimulation(input: SimInput): SimResult {
  const assumptions: string[] = []
  const missingData: string[] = []
  const marginPct = input.marginPct > 0 ? input.marginPct : 0
  const fixedCosts = Math.max(0, input.monthlyCostsFixed ?? 0)
  const horizon = input.horizonMonths
  const noBase: SimResult['base'] = { source: 'none', points: 0, monthlyGrowthPct: null }

  if (marginPct === 0) missingData.push('маржа (не указана — прибыль не оценивается)')

  const current = input.currentRevenueMonthly
  if (!current || current <= 0) {
    missingData.push('текущая выручка')
    assumptions.push('Без текущей выручки прогноз недоступен — заполните финансовые данные.')
    const flat = buildScenario('—', 0, 0, horizon, marginPct, fixedCosts)
    return {
      scenarios: { optimistic: flat, realistic: flat, pessimistic: flat },
      assumptions,
      missingData,
      confidence: 'low',
      forecastAvailable: false,
      base: noBase,
      target: null,
    }
  }

  if (input.simType === 'cost_reduction') {
    const cut = Math.max(0, Math.min(100, input.costCutPct ?? 0))
    const effectiveFixed = fixedCosts * (1 - cut / 100)
    assumptions.push(`Затраты снижены на ${cut}% (${round(fixedCosts)} → ${round(effectiveFixed)} ₸/мес).`)
    assumptions.push('Выручка принята неизменной; эффект идёт в прибыль.')
    const mk = (label: string, g: number) => buildScenario(label, current, g, horizon, marginPct, effectiveFixed)
    return {
      scenarios: {
        optimistic: mk('Оптимистичный', 0.01),
        realistic: mk('Реалистичный', 0),
        pessimistic: mk('Пессимистичный', -0.01),
      },
      assumptions,
      missingData,
      confidence: fixedCosts > 0 ? 'medium' : 'low',
      forecastAvailable: false,
      base: noBase,
      target: null,
    }
  }

  // revenue_growth / anti_crisis: the base pace comes from the client's history, never from the goal (R-039).
  const pace = historyPace(input.revenueHistoryMonthly)
  const forecast = pace !== null
  const g = pace?.growth ?? 0
  const spread = pace?.spread ?? MIN_SPREAD
  if (pace) {
    assumptions.push(`Базовый темп — по вашей истории выручки за ${pace.points} мес.: ${pct1(g)} (разброс между сценариями ±${(spread * 100).toFixed(1)} п.п. в месяц).`)
  } else {
    missingData.push(`история выручки по месяцам (нужно не меньше ${HISTORY_MIN_POINTS} мес.)`)
    assumptions.push(`Нет данных для прогноза: истории выручки по месяцам меньше ${HISTORY_MIN_POINTS} мес. Сценарии ниже — не прогноз, а условный коридор ±${(MIN_SPREAD * 100).toFixed(0)}% в месяц вокруг текущего уровня.`)
  }

  let rates: { optimistic: number; realistic: number; pessimistic: number }
  if (input.simType === 'anti_crisis') {
    // A stress test: never better than the base pace and never growth.
    const top = Math.min(g, 0)
    rates = { optimistic: top, realistic: top - spread, pessimistic: top - 2 * spread }
    assumptions.push(`Антикризисный сценарий — стресс-тест: в лучшем случае ${top === 0 ? 'выручка держится на текущем уровне' : `сохраняется текущий темп ${pct1(top)}`}, в реалистичном и пессимистичном — падение (${pct1(rates.realistic)} и ${pct1(rates.pessimistic)}). Рост в этом режиме не показывается.`)
  } else {
    rates = { optimistic: g + spread, realistic: g, pessimistic: g - spread }
  }
  assumptions.push('Диапазоны ±10% отражают неопределённость; проверяйте ключевые предположения на практике.')

  const scenarios = {
    optimistic: buildScenario('Оптимистичный', current, rates.optimistic, horizon, marginPct, fixedCosts),
    realistic: buildScenario('Реалистичный', current, rates.realistic, horizon, marginPct, fixedCosts),
    pessimistic: buildScenario('Пессимистичный', current, rates.pessimistic, horizon, marginPct, fixedCosts),
  }

  let target: SimTarget | null = null
  if (input.targetRevenueMonthly && input.targetRevenueMonthly > 0) {
    const endOf = (rate: number) => current * Math.pow(1 + rate, horizon)
    target = targetLine(input.targetRevenueMonthly, current, horizon, forecast, { realistic: endOf(rates.realistic), optimistic: endOf(rates.optimistic) })
    assumptions.push(target.text)
  }

  // Confidence comes from the data behind the pace, never from the goal.
  const confidence: SimResult['confidence'] = !pace ? 'low'
    : pace.points >= 12 && marginPct > 0 && spread <= 0.02 ? 'medium'
      : 'low'

  return {
    scenarios,
    assumptions,
    missingData,
    confidence,
    forecastAvailable: forecast,
    base: pace ? { source: 'history', points: pace.points, monthlyGrowthPct: Math.round(g * 1e8) / 1e6 } : noBase,
    target,
  }
}
