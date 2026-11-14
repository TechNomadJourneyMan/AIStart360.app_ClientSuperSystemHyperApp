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
// Every point says which it is (`basis: 'period' | 'event'`, R-040): the chart
// shows both, the forecast runs on business periods only (lib/metrics/forecast).
//
// Before migration 085 the history table does not exist: the old read of
// `public.metrics` is used instead.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js'
import { resolveTenantWith, tenantErrorMessage } from '@/lib/tenancy'
import { isMissingTable } from './catalog-helpers'
import type { SeriesPoint } from './forecast'

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

function periodKey(row: Pick<HistoryRow, 'period_year' | 'period_quarter' | 'period_month'>): string {
  if (row.period_month) return `${row.period_year}-${String(row.period_month).padStart(2, '0')}`
  if (row.period_quarter) return `${row.period_year}-${row.period_quarter.toUpperCase()}`
  return String(row.period_year)
}

/** History rows → points (pure; exported for tests). */
export function historyToPoints(rows: ReadonlyArray<HistoryRow>, cutoffIso: string | null): SeriesPoint[] {
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
    const points: SeriesPoint[] = []
    for (const r of latest.values()) {
      const value = num(r.value)
      const end = periodEnd(r) as Date
      if (value === null || (cutoff !== null && end.getTime() < cutoff)) continue
      points.push({ timestamp: end.toISOString(), value, label: periodLabel(r, end), basis: 'period', period: periodKey(r) })
    }
    return points.sort((a, b) => a.timestamp.localeCompare(b.timestamp))
  }
  const points: SeriesPoint[] = []
  for (const r of rows) {
    const value = num(r.value)
    const t = Date.parse(r.recorded_at ?? '')
    if (value === null || Number.isNaN(t) || (cutoff !== null && t < cutoff)) continue
    const date = new Date(t)
    // A change of the value at a moment (an input edit, a new source) — not a business period.
    points.push({ timestamp: date.toISOString(), value, label: shortDateRu(date), basis: 'event' })
  }
  return points.sort((a, b) => a.timestamp.localeCompare(b.timestamp))
}

export async function fetchTimeseries(
  supabase: SupabaseClient,
  opts: FetchTimeseriesOptions,
): Promise<SeriesPoint[]> {
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
  // A failed read is not «no history»: the routes answer 500 instead of an
  // empty series that forecast / anomalies would then run on.
  if (!isMissingTable(h.error)) throw new Error(`metric history read failed (${h.error.code ?? 'unknown'})`)

  return fetchFromMetrics(supabase, opts, cutoff)
}

/** Pre-085 fallback: the latest materialised rows only. */
async function fetchFromMetrics(
  supabase: SupabaseClient,
  opts: FetchTimeseriesOptions,
  cutoff: string | null,
): Promise<SeriesPoint[]> {
  let query = supabase
    .from('metrics')
    .select('metric_value, metric_unit, computed_at, recorded_at, source')
    .eq('company_id', opts.companyId)
    .eq('metric_key', opts.metricKey)
    .order('recorded_at', { ascending: true })

  if (cutoff) query = query.gte('recorded_at', cutoff)
  if (opts.source) query = query.eq('source', opts.source)

  const { data, error } = await query
  if (error) throw new Error(`metric values read failed (${error.code ?? 'unknown'})`)
  if (!data) return []

  const rows = data as MetricRow[]
  const points: SeriesPoint[] = []
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
      basis: 'event', // the latest materialised value at the time of computing, not a business period
    })
  }
  return points
}

// ─── Business periods from the data layer (metric_facts) ─────

/**
 * Why a second source (R-040, I1): the materialiser keeps ONE current row per
 * metric in public.metrics (its key carries no period, see lib/metrics/resolver),
 * so metric_value_history rarely holds business periods and the forecast would
 * vanish. metric_facts (migration 110) is rebuilt on every materialisation with
 * every observation by calendar period — that is where the periods are.
 */
interface FactRow {
  period_key: string | null
  period_year: number | null
  period_quarter: number | string | null
  period_month: number | null
  value: number | string | null
  source_kind: string | null
  flags: string[] | null
  confidence: number | string | null
}

const FACT_PERIOD_RE = /^\d{4}(-Q[1-4]|-(0[1-9]|1[0-2]))?$/
const FACT_RANK: Record<string, number> = { manual: 5, survey: 4, document: 3, integration: 2, assessment: 1 }

/**
 * Facts → business-period points (pure; exported for tests): calendar periods only
 * ('2025' | '2025-Q1' | '2025-03'; not 'YTD' / 'unknown'), invalid facts skipped,
 * one point per period — the best source (manual > survey > document > integration),
 * then the higher confidence.
 */
export function factsToPoints(rows: ReadonlyArray<FactRow>, cutoffIso: string | null = null): SeriesPoint[] {
  const cutoff = cutoffIso ? Date.parse(cutoffIso) : null
  const best = new Map<string, { row: HistoryRow; value: number; rank: number; confidence: number }>()
  for (const r of rows) {
    const key = String(r.period_key ?? '').toUpperCase()
    if (!FACT_PERIOD_RE.test(key) || !r.period_year) continue
    if (Array.isArray(r.flags) && r.flags.includes('invalid')) continue
    const value = num(r.value)
    if (value === null) continue
    const q = /-Q([1-4])$/.exec(key)
    const m = /-(\d{2})$/.exec(key)
    const row: HistoryRow = {
      value,
      source: r.source_kind,
      period_year: r.period_year,
      period_quarter: q ? `Q${q[1]}` : null,
      period_month: m ? Number(m[1]) : null,
      recorded_at: null,
    }
    const rank = FACT_RANK[r.source_kind ?? ''] ?? 0
    const confidence = num(r.confidence) ?? 0
    const cur = best.get(key)
    if (!cur || rank > cur.rank || (rank === cur.rank && confidence > cur.confidence)) best.set(key, { row, value, rank, confidence })
  }
  const points: SeriesPoint[] = []
  for (const { row, value } of best.values()) {
    const end = periodEnd(row) as Date
    if (cutoff !== null && end.getTime() < cutoff) continue
    points.push({ timestamp: end.toISOString(), value, label: periodLabel(row, end), basis: 'period', period: periodKey(row) })
  }
  return points.sort((a, b) => a.timestamp.localeCompare(b.timestamp))
}

/** The metric's business periods from metric_facts; no table yet (pre-110) → []. */
export async function fetchPeriodFacts(
  supabase: SupabaseClient,
  opts: { companyId: string; metricKey: string },
): Promise<SeriesPoint[]> {
  const { data, error } = await supabase
    .from('metric_facts')
    .select('period_key, period_year, period_quarter, period_month, value, source_kind, flags, confidence')
    .eq('company_id', opts.companyId)
    .eq('metric_key', opts.metricKey)
    .limit(2000)
  if (error) {
    if (isMissingTable(error)) return []
    throw new Error(`metric facts read failed (${error.code ?? 'unknown'})`)
  }
  return factsToPoints((data ?? []) as FactRow[])
}

// ─── Company of a series request ─────────────────────────────

export type SeriesCompany =
  | { ok: true; companyId: string | null }
  | { ok: false; status: number; error: string }

/**
 * The company whose history the caller reads, through lib/tenancy (owner,
 * member, partner; optional ?companyId=) like the other metric routes.
 * No company yet (and none requested) → companyId null: there is no history.
 */
export async function resolveSeriesCompany(
  supabase: SupabaseClient,
  userId: string,
  companyId: string | null,
): Promise<SeriesCompany> {
  const tenant = await resolveTenantWith(supabase, userId, { companyId, access: 'read' })
  if (tenant.ok) return { ok: true, companyId: tenant.tenant.companyId }
  if (tenant.error === 'no_company' && !companyId) return { ok: true, companyId: null }
  return { ok: false, status: tenant.status, error: tenant.error === 'no_company' ? 'no_company' : tenantErrorMessage(tenant.error) }
}
