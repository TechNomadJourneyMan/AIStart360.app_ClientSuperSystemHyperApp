// ============================================================
// lib/metrics/timeseries-fetch.ts
// Reads the history of a metric and flattens it into the
// `TimeseriesPoint[]` shape that the engines (forecast, anomalies,
// trend, seasonality) consume.
//
// Source: `metric_value_history` (migration 085) — every real change of a
// materialised value. `public.metrics` keeps only the latest value per
// key / period / source, so reading it gave one or two points at most.
//
//   • rows with a business period (period_year [+ quarter | month]) form a
//     series BY PERIOD: the latest recorded value of each period, placed at
//     the period's end (annual revenue 2023, 2024, 2025 …);
//   • rows without a period form a series of change events by recorded_at.
//
// Before migration 085 the history table does not exist: the old read of
// `public.metrics` is used instead.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js'
import type { TimeseriesPoint } from '@/types/metrics'

export type FetchPeriod = '1M' | '3M' | '6M' | '1Y' | 'ALL'

export interface FetchTimeseriesOptions {
  companyId: string
  metricKey: string
  period?: FetchPeriod
  source?: string
}

const MONTHS_RU = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек']

function shortDateRu(d: Date): string {
  const m = MONTHS_RU[d.getMonth()]
  const day = d.getDate()
  const y = String(d.getFullYear()).slice(2)
  // Use month + short year so labels are unambiguous across years.
  return `${day < 10 ? '0' + day : day} ${m} '${y}`
}

function periodCutoffIso(period: FetchPeriod, now: Date): string | null {
  if (period === 'ALL') return null
  const d = new Date(now)
  switch (period) {
    case '1M':
      d.setMonth(d.getMonth() - 1)
      break
    case '3M':
      d.setMonth(d.getMonth() - 3)
      break
    case '6M':
      d.setMonth(d.getMonth() - 6)
      break
    case '1Y':
      d.setFullYear(d.getFullYear() - 1)
      break
  }
  return d.toISOString()
}

interface HistoryRow {
  value: number | string | null
  source: string | null
  period_year: number | null
  period_quarter: string | null
  period_month: number | null
  recorded_at: string | null
}

interface MetricRow {
  metric_value: number | string | null
  metric_unit: string | null
  computed_at: string | null
  recorded_at: string | null
  source: string | null
}

function num(v: number | string | null | undefined): number | null {
  if (v === null || v === undefined) return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/** End of a business period (UTC); null when the row has no period. */
export function periodEnd(row: Pick<HistoryRow, 'period_year' | 'period_quarter' | 'period_month'>): Date | null {
  const y = row.period_year
  if (!y || !Number.isInteger(y)) return null
  if (row.period_month && row.period_month >= 1 && row.period_month <= 12) return new Date(Date.UTC(y, row.period_month, 0))
  const q = /^Q([1-4])$/i.exec(row.period_quarter ?? '')
  if (q) return new Date(Date.UTC(y, Number(q[1]) * 3, 0))
  return new Date(Date.UTC(y, 12, 0))
}

function periodLabel(row: Pick<HistoryRow, 'period_year' | 'period_quarter' | 'period_month'>, end: Date): string {
  if (row.period_month) return `${MONTHS_RU[end.getUTCMonth()]} '${String(row.period_year).slice(2)}`
  if (row.period_quarter) return `${row.period_quarter.toUpperCase()} ${row.period_year}`
  return String(row.period_year)
}

/** History rows → points (pure; exported for tests). */
export function historyToPoints(rows: ReadonlyArray<HistoryRow>, cutoffIso: string | null): TimeseriesPoint[] {
  const cutoff = cutoffIso ? Date.parse(cutoffIso) : null
  const periodic = rows.filter((r) => periodEnd(r) !== null)
  if (periodic.length) {
    // Latest recorded value per period.
    const latest = new Map<string, HistoryRow>()
    for (const r of periodic) {
      const k = `${r.period_year}|${r.period_quarter ?? ''}|${r.period_month ?? ''}`
      const prev = latest.get(k)
      if (!prev || Date.parse(r.recorded_at ?? '') >= Date.parse(prev.recorded_at ?? '')) latest.set(k, r)
    }
    const points: TimeseriesPoint[] = []
    for (const r of latest.values()) {
      const value = num(r.value)
      const end = periodEnd(r) as Date
      if (value === null || (cutoff !== null && end.getTime() < cutoff)) continue
      points.push({ timestamp: end.toISOString(), value, label: periodLabel(r, end) })
    }
    return points.sort((a, b) => a.timestamp.localeCompare(b.timestamp))
  }
  const points: TimeseriesPoint[] = []
  for (const r of rows) {
    const value = num(r.value)
    const t = Date.parse(r.recorded_at ?? '')
    if (value === null || Number.isNaN(t) || (cutoff !== null && t < cutoff)) continue
    const date = new Date(t)
    points.push({ timestamp: date.toISOString(), value, label: shortDateRu(date) })
  }
  return points.sort((a, b) => a.timestamp.localeCompare(b.timestamp))
}

function isMissingTable(error: { code?: string; message?: string } | null): boolean {
  return Boolean(error) && (error?.code === '42P01' || error?.code === 'PGRST205' || /does not exist|could not find the table/i.test(error?.message ?? ''))
}

export async function fetchTimeseries(
  supabase: SupabaseClient,
  opts: FetchTimeseriesOptions,
): Promise<TimeseriesPoint[]> {
  const period: FetchPeriod = opts.period ?? '3M'
  const cutoff = periodCutoffIso(period, new Date())

  let history = supabase
    .from('metric_value_history')
    .select('value, source, period_year, period_quarter, period_month, recorded_at')
    .eq('company_id', opts.companyId)
    .eq('metric_key', opts.metricKey)
    .order('recorded_at', { ascending: true })
    .limit(2000)
  if (opts.source) history = history.eq('source', opts.source)
  const h = await history
  if (!h.error) return historyToPoints((h.data ?? []) as HistoryRow[], cutoff)
  if (!isMissingTable(h.error)) return []

  return fetchFromMetrics(supabase, opts, cutoff)
}

/** Pre-085 fallback: the latest materialised rows only. */
async function fetchFromMetrics(
  supabase: SupabaseClient,
  opts: FetchTimeseriesOptions,
  cutoff: string | null,
): Promise<TimeseriesPoint[]> {
  let query = supabase
    .from('metrics')
    .select('metric_value, metric_unit, computed_at, recorded_at, source')
    .eq('company_id', opts.companyId)
    .eq('metric_key', opts.metricKey)
    .order('recorded_at', { ascending: true })

  if (cutoff) query = query.gte('recorded_at', cutoff)
  if (opts.source) query = query.eq('source', opts.source)

  const { data, error } = await query
  if (error || !data) return []

  const rows = data as MetricRow[]
  const points: TimeseriesPoint[] = []
  for (const row of rows) {
    const iso = row.computed_at ?? row.recorded_at
    if (!iso) continue
    const value = num(row.metric_value)
    if (value === null) continue
    const date = new Date(iso)
    if (Number.isNaN(date.getTime())) continue
    points.push({
      timestamp: date.toISOString(),
      value,
      label: shortDateRu(date),
    })
  }
  return points
}
