import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import type { TimeseriesPoint } from '@/types/metrics'
import type { Period } from '@/types/periods'
import { PERIOD_CONFIG } from '@/types/periods'

// ─── Mock data generators ───────────────────────────────────────────────────

function buildLabel(date: Date, granularity: string): string {
  const MONTHS_RU = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек']
  const m = MONTHS_RU[date.getMonth()]
  const d = date.getDate()
  const y = String(date.getFullYear()).slice(2)

  if (granularity === 'day') return `${d < 10 ? '0' + d : d} ${m}`
  if (granularity === 'week') return `${d < 10 ? '0' + d : d} ${m}`
  if (granularity === 'month') return `${m} '${y}`
  if (granularity === 'quarter') {
    const q = Math.floor(date.getMonth() / 3) + 1
    return `Q${q} '${y}`
  }
  return `${d} ${m}`
}

function addDays(date: Date, n: number): Date {
  const d = new Date(date)
  d.setDate(d.getDate() + n)
  return d
}

function addWeeks(date: Date, n: number): Date {
  return addDays(date, n * 7)
}

function addMonths(date: Date, n: number): Date {
  const d = new Date(date)
  d.setMonth(d.getMonth() + n)
  return d
}

function addQuarters(date: Date, n: number): Date {
  return addMonths(date, n * 3)
}

// Base current values
const BASE_VALUES: Record<string, number> = {
  revenue:     84.2,
  margin:      34.2,
  clients:     48,
  avg_check:   1.75,
  expenses:    55.4,
  ebitda:      28.8,
  cac:         0.12,
  ltv:         5.25,
  ltv_cac:     43.75,
  churn:       4.2,
  retention:   71.8,
  mrr:         7.0,
  arr:         84.2,
  nps:         62,
  new_clients: 8,
  gri_score:   4.59,
}

// Monthly growth rates (approximate)
const GROWTH_RATES: Record<string, number> = {
  revenue:     0.035,
  margin:      0.004,
  clients:     0.04,
  avg_check:   -0.001,
  expenses:    0.025,
  ebitda:      0.05,
  cac:         -0.01,
  ltv:         0.03,
  ltv_cac:     0.04,
  churn:       -0.01,
  retention:   0.005,
  mrr:         0.035,
  arr:         0.035,
  nps:         0.01,
  new_clients: 0.05,
  gri_score:   0.01,
}

function generateSeries(
  metricId: string,
  period: Period,
  now: Date
): TimeseriesPoint[] {
  const cfg = PERIOD_CONFIG[period]
  const base = BASE_VALUES[metricId] ?? 10
  const monthlyGrowth = GROWTH_RATES[metricId] ?? 0.02

  // Calculate growth per step based on granularity
  const stepGrowth: Record<string, number> = {
    day:     monthlyGrowth / 30,
    week:    monthlyGrowth / 4.3,
    month:   monthlyGrowth,
    quarter: monthlyGrowth * 3,
  }
  const g = stepGrowth[cfg.granularity] ?? 0.01

  const points: TimeseriesPoint[] = []
  const n = cfg.defaultPoints

  for (let i = n - 1; i >= 0; i--) {
    let date: Date
    switch (cfg.granularity) {
      case 'day':     date = addDays(now, -i); break
      case 'week':    date = addWeeks(now, -i); break
      case 'month':   date = addMonths(now, -i); break
      case 'quarter': date = addQuarters(now, -i); break
      default:        date = addDays(now, -i)
    }

    // Value: compound back from base
    const stepsFromNow = i
    const value = base / Math.pow(1 + g, stepsFromNow)
    // Add small noise
    const noise = (Math.random() - 0.5) * value * 0.02
    const finalValue = Math.max(0, parseFloat((value + noise).toFixed(2)))

    points.push({
      timestamp: date.toISOString(),
      value: finalValue,
      label: buildLabel(date, cfg.granularity),
    })
  }

  return points
}

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const { id } = params
  const period = (req.nextUrl.searchParams.get('period') ?? '1M') as Period

  if (!PERIOD_CONFIG[period]) {
    return NextResponse.json({ error: 'Invalid period' }, { status: 400 })
  }

  const now = new Date()
  const data = generateSeries(id, period, now)

  return NextResponse.json({
    metricId: id,
    period,
    granularity: PERIOD_CONFIG[period].granularity,
    unit: id === 'margin' || id === 'churn' || id === 'retention' ? '%' : '',
    data,
  })
}
