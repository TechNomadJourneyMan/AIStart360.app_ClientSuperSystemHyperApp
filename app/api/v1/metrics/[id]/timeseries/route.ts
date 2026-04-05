import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import type { TimeseriesPoint } from '@/types/metrics'
import type { Period } from '@/types/periods'
import { PERIOD_CONFIG } from '@/types/periods'
import { createServerClient } from '@/lib/supabase-server'

// ─── Label formatters ────────────────────────────────────────────────────────

const MONTHS_RU = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек']

function buildLabel(date: Date, granularity: string): string {
  const m = MONTHS_RU[date.getMonth()]
  const d = date.getDate()
  const y = String(date.getFullYear()).slice(2)
  if (granularity === 'day' || granularity === 'week') return `${d < 10 ? '0' + d : d} ${m}`
  if (granularity === 'month') return `${m} '${y}`
  if (granularity === 'quarter') return `Q${Math.floor(date.getMonth() / 3) + 1} '${y}`
  return `${d} ${m}`
}

function periodStartDate(period: Period, now: Date): Date {
  const d = new Date(now)
  switch (period) {
    case '1W': d.setDate(d.getDate() - 7); break
    case '1M': d.setDate(d.getDate() - 30); break
    case '3M': d.setDate(d.getDate() - 91); break
    case '1Y': d.setFullYear(d.getFullYear() - 1); break
    case '3Y': d.setFullYear(d.getFullYear() - 3); break
  }
  return d
}

// Aggregate daily rows into weekly/monthly/quarterly buckets
function aggregateRows(
  rows: { date: string; value: number }[],
  granularity: string
): TimeseriesPoint[] {
  if (granularity === 'day') {
    return rows.map((r) => {
      const date = new Date(r.date)
      return { timestamp: date.toISOString(), value: r.value, label: buildLabel(date, 'day') }
    })
  }

  const buckets = new Map<string, { sum: number; count: number; date: Date }>()
  for (const r of rows) {
    const date = new Date(r.date)
    let key: string

    if (granularity === 'week') {
      // ISO week start (Monday)
      const day = date.getDay()
      const diff = date.getDate() - day + (day === 0 ? -6 : 1)
      const monday = new Date(date)
      monday.setDate(diff)
      key = monday.toISOString().slice(0, 10)
      if (!buckets.has(key)) buckets.set(key, { sum: 0, count: 0, date: monday })
    } else if (granularity === 'month') {
      key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
      if (!buckets.has(key)) buckets.set(key, { sum: 0, count: 0, date: new Date(date.getFullYear(), date.getMonth(), 1) })
    } else {
      // quarter
      const q = Math.floor(date.getMonth() / 3)
      key = `${date.getFullYear()}-Q${q + 1}`
      if (!buckets.has(key)) buckets.set(key, { sum: 0, count: 0, date: new Date(date.getFullYear(), q * 3, 1) })
    }

    const b = buckets.get(key)!
    b.sum += r.value
    b.count += 1
  }

  return Array.from(buckets.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, b]) => ({
      timestamp: b.date.toISOString(),
      value: parseFloat((b.sum / b.count).toFixed(2)),
      label: buildLabel(b.date, granularity),
    }))
}

// ─── Mock fallback ────────────────────────────────────────────────────────────

const BASE_VALUES: Record<string, number> = {
  revenue: 84.2, margin: 34.2, clients: 48, avg_check: 1.75,
  expenses: 55.4, ebitda: 28.8, cac: 0.12, ltv: 5.25, ltv_cac: 43.75,
  churn: 4.2, retention: 71.8, mrr: 7.0, arr: 84.2, nps: 62,
  new_clients: 8, gri_score: 4.59,
}

const GROWTH_RATES: Record<string, number> = {
  revenue: 0.035, margin: 0.004, clients: 0.04, avg_check: -0.001,
  expenses: 0.025, ebitda: 0.05, cac: -0.01, ltv: 0.03, ltv_cac: 0.04,
  churn: -0.01, retention: 0.005, mrr: 0.035, arr: 0.035, nps: 0.01,
  new_clients: 0.05, gri_score: 0.01,
}

function addUnits(date: Date, n: number, granularity: string): Date {
  const d = new Date(date)
  if (granularity === 'day') d.setDate(d.getDate() + n)
  else if (granularity === 'week') d.setDate(d.getDate() + n * 7)
  else if (granularity === 'month') d.setMonth(d.getMonth() + n)
  else d.setMonth(d.getMonth() + n * 3)
  return d
}

function generateMock(metricId: string, period: Period, now: Date): TimeseriesPoint[] {
  const cfg = PERIOD_CONFIG[period]
  const base = BASE_VALUES[metricId] ?? 10
  const mg = GROWTH_RATES[metricId] ?? 0.02
  const stepGrowth = { day: mg / 30, week: mg / 4.3, month: mg, quarter: mg * 3 }
  const g = stepGrowth[cfg.granularity as keyof typeof stepGrowth] ?? 0.01
  const n = cfg.defaultPoints

  return Array.from({ length: n }, (_, i) => {
    const stepsFromNow = n - 1 - i
    const date = addUnits(now, -stepsFromNow, cfg.granularity)
    const value = base / Math.pow(1 + g, stepsFromNow)
    const noise = (Math.random() - 0.5) * value * 0.02
    return {
      timestamp: date.toISOString(),
      value: Math.max(0, parseFloat((value + noise).toFixed(2))),
      label: buildLabel(date, cfg.granularity),
    }
  })
}

// ─── Route handler ────────────────────────────────────────────────────────────

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const { id } = params
  const period = (req.nextUrl.searchParams.get('period') ?? '1M') as Period

  if (!PERIOD_CONFIG[period]) {
    return NextResponse.json({ error: 'Invalid period' }, { status: 400 })
  }

  const cfg = PERIOD_CONFIG[period]
  const now = new Date()
  const startDate = periodStartDate(period, now)

  try {
    const supabase = createServerClient()
    const { data: rows, error } = await supabase
      .from('metric_timeseries')
      .select('date, value')
      .eq('metric_id', id)
      .gte('date', startDate.toISOString().slice(0, 10))
      .lte('date', now.toISOString().slice(0, 10))
      .order('date', { ascending: true })

    if (!error && rows && rows.length > 0) {
      const data = aggregateRows(rows as { date: string; value: number }[], cfg.granularity)
      return NextResponse.json({
        metricId: id,
        period,
        granularity: cfg.granularity,
        source: 'supabase',
        data,
      })
    }
  } catch (err) {
    console.error('[timeseries] Supabase error, falling back to mock:', err)
  }

  // Fallback to mock data
  return NextResponse.json({
    metricId: id,
    period,
    granularity: cfg.granularity,
    source: 'mock',
    data: generateMock(id, period, now),
  })
}
