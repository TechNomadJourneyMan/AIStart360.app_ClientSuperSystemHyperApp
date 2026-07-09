/**
 * lib/simulator/core.ts — deterministic business-simulator engine (MVP).
 *
 * Numbers are computed HERE, never by an LLM (the LLM only narrates on top, spec
 * 09). Produces optimistic/realistic/pessimistic monthly projections as RANGES,
 * with explicit assumptions, missing-data and a confidence level — a forecast is
 * never presented as a fact. MVP covers revenue_growth and cost_reduction.
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

export interface SimResult {
  scenarios: { optimistic: ScenarioProjection; realistic: ScenarioProjection; pessimistic: ScenarioProjection }
  assumptions: string[]
  missingData: string[]
  confidence: 'low' | 'medium' | 'high'
}

const DEFAULT_MONTHLY_GROWTH = 0.05 // modest 5%/mo when no target is stated
const BAND = 0.1 // ±10% uncertainty band around each scenario's central path

function round(n: number): number {
  return Math.round(n)
}

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

export function runSimulation(input: SimInput): SimResult {
  const assumptions: string[] = []
  const missingData: string[] = []
  const marginPct = input.marginPct > 0 ? input.marginPct : 0
  const fixedCosts = Math.max(0, input.monthlyCostsFixed ?? 0)
  const horizon = input.horizonMonths

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
    }
  }

  // Determine the realistic monthly growth rate.
  let realisticGrowth: number
  let confidence: SimResult['confidence']
  if (input.simType === 'cost_reduction') {
    realisticGrowth = 0 // revenue flat; the lever is cost.
    const cut = Math.max(0, Math.min(100, input.costCutPct ?? 0))
    const effectiveFixed = fixedCosts * (1 - cut / 100)
    assumptions.push(`Затраты снижены на ${cut}% (${round(fixedCosts)} → ${round(effectiveFixed)} ₸/мес).`)
    assumptions.push('Выручка принята неизменной; эффект идёт в прибыль.')
    confidence = fixedCosts > 0 ? 'medium' : 'low'
    const mk = (label: string, g: number) => buildScenario(label, current, g, horizon, marginPct, effectiveFixed)
    return {
      scenarios: {
        optimistic: mk('Оптимистичный', 0.01),
        realistic: mk('Реалистичный', realisticGrowth),
        pessimistic: mk('Пессимистичный', -0.01),
      },
      assumptions,
      missingData,
      confidence,
    }
  }

  // revenue_growth / anti_crisis
  if (input.targetRevenueMonthly && input.targetRevenueMonthly > 0) {
    realisticGrowth = Math.pow(input.targetRevenueMonthly / current, 1 / horizon) - 1
    assumptions.push(`Целевая выручка ${round(input.targetRevenueMonthly)} ₸/мес за ${horizon} мес → требуемый темп ~${(realisticGrowth * 100).toFixed(1)}%/мес.`)
    confidence = marginPct > 0 ? 'high' : 'medium'
  } else {
    realisticGrowth = DEFAULT_MONTHLY_GROWTH
    assumptions.push(`Цель не задана — взят модельный темп роста по умолчанию ${DEFAULT_MONTHLY_GROWTH * 100}%/мес.`)
    confidence = 'medium'
  }
  assumptions.push('Диапазоны ±10% отражают неопределённость; проверяйте ключевые предположения на практике.')

  return {
    scenarios: {
      optimistic: buildScenario('Оптимистичный', current, realisticGrowth * 1.2, horizon, marginPct, fixedCosts),
      realistic: buildScenario('Реалистичный', current, realisticGrowth, horizon, marginPct, fixedCosts),
      pessimistic: buildScenario('Пессимистичный', current, realisticGrowth * 0.6, horizon, marginPct, fixedCosts),
    },
    assumptions,
    missingData,
    confidence,
  }
}
