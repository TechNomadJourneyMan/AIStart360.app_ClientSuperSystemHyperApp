import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import type { ForecastPoint } from '@/types/metrics'
import type { Period } from '@/types/periods'
import { PERIOD_CONFIG } from '@/types/periods'

const BASE_VALUES: Record<string, number> = {
  revenue: 84.2, margin: 34.2, clients: 48, avg_check: 1.75,
  expenses: 55.4, ebitda: 28.8, cac: 0.12, ltv: 5.25,
  ltv_cac: 43.75, churn: 4.2, retention: 71.8, mrr: 7.0,
  arr: 84.2, nps: 62, new_clients: 8, gri_score: 4.59,
}

const GROWTH_RATES: Record<string, number> = {
  revenue: 0.035, margin: 0.004, clients: 0.04, avg_check: -0.001,
  expenses: 0.025, ebitda: 0.05, cac: -0.01, ltv: 0.03,
  ltv_cac: 0.04, churn: -0.01, retention: 0.005, mrr: 0.035,
  arr: 0.035, nps: 0.01, new_clients: 0.05, gri_score: 0.01,
}

function buildLabel(date: Date, granularity: string): string {
  const MONTHS_RU = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек']
  const m = MONTHS_RU[date.getMonth()]
  const d = date.getDate()
  const y = String(date.getFullYear()).slice(2)
  if (granularity === 'day' || granularity === 'week') return `${d < 10 ? '0' + d : d} ${m}`
  if (granularity === 'month') return `${m} '${y}`
  const q = Math.floor(date.getMonth() / 3) + 1
  return `Q${q} '${y}`
}

function addStep(date: Date, granularity: string, n: number): Date {
  const d = new Date(date)
  if (granularity === 'day')     d.setDate(d.getDate() + n)
  if (granularity === 'week')    d.setDate(d.getDate() + n * 7)
  if (granularity === 'month')   d.setMonth(d.getMonth() + n)
  if (granularity === 'quarter') d.setMonth(d.getMonth() + n * 3)
  return d
}

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const { id } = params
  const period = (req.nextUrl.searchParams.get('period') ?? '1M') as Period
  const cfg = PERIOD_CONFIG[period]

  if (!cfg || !cfg.showForecast) {
    return NextResponse.json({ data: [], confidence: 0, method: 'none' })
  }

  const base = BASE_VALUES[id] ?? 10
  const monthlyGrowth = GROWTH_RATES[id] ?? 0.02
  const stepGrowth: Record<string, number> = {
    day: monthlyGrowth / 30, week: monthlyGrowth / 4.3,
    month: monthlyGrowth, quarter: monthlyGrowth * 3,
  }
  const g = stepGrowth[cfg.granularity] ?? 0.01

  // Forecast = 30% of the period steps forward from now
  const forecastSteps = Math.ceil(cfg.defaultPoints * 0.3)
  const now = new Date()
  const points: ForecastPoint[] = []

  // Include current point as the overlap (isForecast starts here)
  for (let i = 0; i <= forecastSteps; i++) {
    const date = addStep(now, cfg.granularity, i)
    const value = parseFloat((base * Math.pow(1 + g, i)).toFixed(2))
    const band = value * 0.06 // ±6% confidence band

    points.push({
      timestamp: date.toISOString(),
      value,
      label: buildLabel(date, cfg.granularity),
      isForecast: true,
      confidenceLow: parseFloat((value - band).toFixed(2)),
      confidenceHigh: parseFloat((value + band).toFixed(2)),
    })
  }

  return NextResponse.json({
    data: points,
    confidence: 0.72,
    method: 'linear',
  })
}
