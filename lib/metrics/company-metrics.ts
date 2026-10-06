/**
 * lib/metrics/company-metrics.ts — THE current metric values of a company.
 *
 * One function family that every surface reads, so the Metrics page (catalog,
 * KPI and Goals tabs), the dashboard heroes (GET /api/v1/metrics), Point A
 * (engine inputs) and Point B (current revenue, levers) can never disagree:
 *
 *   companyMetricsFromValues(values)   live resolver output (aggregator)
 *   companyMetricsFromRows(rows)       materialised public.metrics rows
 *   loadCompanyMetrics(client, id)     read + companyMetricsFromRows
 *
 * The values themselves come from lib/metrics/resolver.ts (survey, documents
 * incl. OCR, formulas, GRI assessment) and are written to public.metrics by
 * lib/metrics/materialize.ts, which keeps one current row per metric. When
 * several rows of a key exist anyway (older data), `currentMetricRows` picks
 * the newest computation; on a tie the stronger source wins.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { getMetricById } from './registry'
import { toMaterializedRow } from './materialize'
import type { MetricValue } from './types'

export interface MetricRowLike {
  metric_key: string
  metric_value: number | string | null
  metric_unit?: string | null
  source: string | null
  confidence?: number | string | null
  provenance?: unknown
  computed_at?: string | null
  recorded_at?: string | null
  period_year?: number | null
  period_quarter?: string | null
  period_month?: number | null
}

/** Tie-break between rows computed at the same instant. */
const SOURCE_RANK: Readonly<Record<string, number>> = {
  manual: 7,
  document: 6,
  calculated: 5,
  survey: 4,
  prisma: 3,
  external: 2,
  resolver: 1,
}

function ts(r: MetricRowLike): number {
  const t = Date.parse(r.computed_at ?? r.recorded_at ?? '')
  return Number.isFinite(t) ? t : -Infinity
}

function numeric(v: number | string | null | undefined): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : null
}

/** The current row per metric key: a value, newest computation, then the stronger source. */
export function currentMetricRows<T extends MetricRowLike>(rows: ReadonlyArray<T>): Map<string, T> {
  const out = new Map<string, T>()
  for (const r of rows) {
    if (r.metric_value === null || r.metric_value === undefined || r.metric_value === '') continue
    const prev = out.get(r.metric_key)
    if (!prev) {
      out.set(r.metric_key, r)
      continue
    }
    const d = ts(r) - ts(prev)
    if (d > 0 || (d === 0 && (SOURCE_RANK[r.source ?? ''] ?? 0) > (SOURCE_RANK[prev.source ?? ''] ?? 0))) out.set(r.metric_key, r)
  }
  return out
}

export interface CompanyMetricValue {
  metricId: string
  label: string
  value: number
  unit: string
  /** public.metrics.source label ('survey', 'document', 'calculated' …). */
  source: string | null
  confidence: number | null
  computedAt: string | null
  periodYear: number | null
  periodQuarter: string | null
  provenance: unknown
}

export type CompanyMetrics = ReadonlyMap<string, CompanyMetricValue>

export function companyMetricsFromRows(rows: ReadonlyArray<MetricRowLike>): Map<string, CompanyMetricValue> {
  const out = new Map<string, CompanyMetricValue>()
  for (const [key, r] of currentMetricRows(rows)) {
    if (numeric(r.metric_value) === null) continue
    const entry = getMetricById(key)
    out.set(key, {
      metricId: key,
      label: entry?.label ?? key,
      value: numeric(r.metric_value) as number,
      unit: r.metric_unit ?? entry?.unit ?? '',
      source: r.source ?? null,
      confidence: numeric(r.confidence ?? null),
      computedAt: r.computed_at ?? r.recorded_at ?? null,
      periodYear: r.period_year ?? null,
      periodQuarter: r.period_quarter ?? null,
      provenance: r.provenance ?? null,
    })
  }
  return out
}

/** Live resolver output in the same shape (what materialisation would write). */
export function companyMetricsFromValues(values: ReadonlyArray<MetricValue>, companyId = ''): Map<string, CompanyMetricValue> {
  return companyMetricsFromRows(
    values
      .filter((v) => v.picked !== null && v.numeric !== null)
      .map((v) => toMaterializedRow(v, companyId)),
  )
}

/** Number of a metric, or null. */
export function metricNumber(m: CompanyMetrics, id: string): number | null {
  return m.get(id)?.value ?? null
}

/** First metric of `ids` that has a value. */
export function firstMetric(m: CompanyMetrics, ids: readonly string[]): CompanyMetricValue | null {
  for (const id of ids) {
    const v = m.get(id)
    if (v) return v
  }
  return null
}

export const COMPANY_METRIC_COLUMNS =
  'metric_key, metric_value, metric_unit, source, confidence, provenance, computed_at, recorded_at, period_year, period_quarter, period_month'

/**
 * Current metrics of one company (caller's client — RLS applies). A failed
 * read throws: «no values» must never stand in for «could not read them».
 */
export async function loadCompanyMetrics(
  client: SupabaseClient,
  companyId: string,
  ids?: readonly string[],
): Promise<Map<string, CompanyMetricValue>> {
  let q = client.from('metrics').select(COMPANY_METRIC_COLUMNS).eq('company_id', companyId)
  if (ids && ids.length > 0) q = q.in('metric_key', ids as string[])
  const { data, error } = await q
  if (error) throw new Error(`company metrics: read failed (${error.code ?? 'unknown'})`)
  return companyMetricsFromRows((data ?? []) as MetricRowLike[])
}
