// ============================================================
// lib/metrics/timeseries-fetch.ts
// DB helper that reads materialized rows from `public.metrics` and
// flattens them into the `TimeseriesPoint[]` shape that all engine
// functions (forecast, anomalies, trend, seasonality) consume.
//
// We read the table directly rather than going through the resolver
// because the resolver returns a single latest value, while the
// engines need the whole history. Period filter is applied against
// `recorded_at` (the business-time column); `computed_at` is the
// preferred ISO timestamp when present (computation moment).
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

interface MetricRow {
  metric_value: number | string | null
  metric_unit: string | null
  computed_at: string | null
  recorded_at: string | null
  source: string | null
}

export async function fetchTimeseries(
  supabase: SupabaseClient,
  opts: FetchTimeseriesOptions,
): Promise<TimeseriesPoint[]> {
  const period: FetchPeriod = opts.period ?? '3M'
  const cutoff = periodCutoffIso(period, new Date())

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
    const value =
      row.metric_value === null || row.metric_value === undefined
        ? null
        : Number(row.metric_value)
    if (value === null || !Number.isFinite(value)) continue
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
