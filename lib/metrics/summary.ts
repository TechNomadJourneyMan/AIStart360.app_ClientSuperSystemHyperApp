/**
 * lib/metrics/summary.ts — KPI summaries for GET /api/v1/metrics
 * (MetricSummary, types/metrics.ts), built from the company's own
 * public.metrics rows and metric_value_history.
 *
 * `id` of a summary is the registry metric id (lib/metrics/registry.ts), so
 * the UI can ask for exactly the metrics it shows (`?keys=` / `?ids=`).
 * Without a filter the top KPIs below are returned. A metric without a
 * materialised value is simply absent — the UI renders «нет данных».
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import type { MetricSummary } from '@/types/metrics'
import type { MetricEntry } from './types'
import { getMetricById } from './registry'
import { isMissingTable, previousValueFor, trendFor, type MetricHistoryRow } from './catalog-helpers'

/** Top KPIs returned when no `keys` / `ids` are given (registry ids, display order). */
export const TOP_KPI_METRIC_IDS: readonly string[] = [
  'biz.finansy.vyruchka_god',          // выручка (год)
  'biz.finansy.valovaya_marzha',       // маржа (валовая; чистая — когда пришла из шага 9)
  'biz.klienty.aktivnykh_klientov',    // активные клиенты
  'goal.01.kolichestvo_novykh_klientov', // новые клиенты
  'biz.prodazhi.sredniy_chek',         // средний чек
  'goal.04.ltv',                       // LTV
  'biz.marketing.cac',                 // CAC
  'biz.marketing.ltv_cac',             // LTV / CAC
  'biz.prodazhi.dolya_neyavok_no_show', // доля неявок
]

/** Short names the older UI used → registry ids. */
export const KPI_ALIASES: Readonly<Record<string, string>> = {
  revenue: 'biz.finansy.vyruchka_god',
  margin: 'biz.finansy.valovaya_marzha',
  clients: 'biz.klienty.aktivnykh_klientov',
  new_clients: 'goal.01.kolichestvo_novykh_klientov',
  avg_check: 'biz.prodazhi.sredniy_chek',
  ltv: 'goal.04.ltv',
  cac: 'biz.marketing.cac',
  ltv_cac: 'biz.marketing.ltv_cac',
  no_show_rate: 'biz.prodazhi.dolya_neyavok_no_show',
}

/** The default tiles of the dashboard (types/metrics DEFAULT_METRIC_IDS, by meaning). */
const DEFAULT_IDS = new Set(['biz.finansy.vyruchka_god', 'biz.finansy.valovaya_marzha', 'biz.klienty.aktivnykh_klientov', 'biz.prodazhi.sredniy_chek'])

const ICONS: Record<string, { icon: string; color: string }> = {
  'biz.finansy.vyruchka_god': { icon: 'payments', color: '#4edea3' },
  'biz.finansy.valovaya_marzha': { icon: 'percent', color: '#7bd0ff' },
  'biz.klienty.aktivnykh_klientov': { icon: 'groups', color: '#c0c1ff' },
  'goal.01.kolichestvo_novykh_klientov': { icon: 'person_add', color: '#c0c1ff' },
  'biz.prodazhi.sredniy_chek': { icon: 'receipt_long', color: '#ffb95f' },
  'goal.04.ltv': { icon: 'savings', color: '#4edea3' },
  'biz.marketing.cac': { icon: 'shopping_cart_checkout', color: '#ffb4ab' },
  'biz.marketing.ltv_cac': { icon: 'balance', color: '#7bd0ff' },
  'biz.prodazhi.dolya_neyavok_no_show': { icon: 'event_busy', color: '#ffb4ab' },
}
const DEFAULT_ICON = { icon: 'monitoring', color: '#c0c1ff' }

export const MAX_SUMMARY_KEYS = 30

/**
 * Requested registry ids from `?keys=` / `?ids=` (comma lists, aliases
 * allowed). Unknown ids are dropped. Empty → the top KPIs.
 */
export function requestedMetricIds(keys: string | null, ids: string | null): string[] {
  const tokens = [keys, ids]
    .filter((v): v is string => Boolean(v))
    .flatMap((v) => v.split(','))
    .map((t) => t.trim())
    .filter(Boolean)
    .slice(0, MAX_SUMMARY_KEYS)
  if (tokens.length === 0) return [...TOP_KPI_METRIC_IDS]
  const out: string[] = []
  for (const t of tokens) {
    const id = KPI_ALIASES[t] ?? t
    if (getMetricById(id) && !out.includes(id)) out.push(id)
  }
  return out
}

function group(n: number): string {
  const [int, frac] = Math.abs(n).toFixed(n % 1 === 0 ? 0 : 1).split('.')
  const g = int.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')
  return `${n < 0 ? '−' : ''}${g}${frac && frac !== '0' ? `,${frac}` : ''}`
}

/** «₸88,0 млн», «₸50 000», «34%», «1 240», «3,5». */
export function formatSummaryValue(value: number, unit: string): string {
  if (unit === '₸') {
    const abs = Math.abs(value)
    if (abs >= 1e9) return `₸${(value / 1e9).toFixed(2).replace('.', ',')} млрд`
    if (abs >= 1e6) return `₸${(value / 1e6).toFixed(1).replace('.', ',')} млн`
    return `₸${group(Math.round(value))}`
  }
  if (unit === '%') return `${group(Math.round(value * 10) / 10)}%`
  if (unit === '' ) return group(Math.round(value * 100) / 100)
  if (unit === 'count') return group(Math.round(value))
  if (unit === 'days') return `${group(Math.round(value))} дн.`
  return `${group(Math.round(value * 100) / 100)} ${unit}`
}

/** Latest public.metrics row per metric key. */
export interface SummaryValueRow {
  metric_key: string
  metric_value: number | string | null
  metric_unit: string | null
  source: string | null
  confidence: number | string | null
  provenance: unknown
  computed_at: string | null
  recorded_at: string | null
  period_year: number | null
  period_quarter: string | null
  period_month: number | null
}

export interface MetricSummaryExtra {
  /** Registry id (same as `id`). */
  metricKey: string
  source: string | null
  confidence: number | null
  computedAt: string | null
}

function pickedKey(provenance: unknown): string | null {
  const picked = (provenance as { picked?: { key?: unknown } } | null)?.picked
  return typeof picked?.key === 'string' ? picked.key : null
}

function labelFor(entry: MetricEntry, row: SummaryValueRow): string {
  // The margin metric accepts the step-9 NET margin as a proxy — say so.
  if (entry.id === 'biz.finansy.valovaya_marzha' && pickedKey(row.provenance) === 's9n_net_margin') return 'Чистая маржа'
  return entry.label
}

/** Pure: summaries in the order of `ids`, only for metrics with a numeric value. */
export function buildMetricSummaries(
  ids: readonly string[],
  rows: readonly SummaryValueRow[],
  history: readonly MetricHistoryRow[],
): Array<MetricSummary & MetricSummaryExtra> {
  const latest = new Map<string, SummaryValueRow>()
  for (const r of rows) {
    if (r.metric_value === null || r.metric_value === undefined) continue
    const prev = latest.get(r.metric_key)
    const t = Date.parse(r.computed_at ?? r.recorded_at ?? '')
    const pt = prev ? Date.parse(prev.computed_at ?? prev.recorded_at ?? '') : NaN
    if (!prev || (Number.isFinite(t) && (!Number.isFinite(pt) || t > pt))) latest.set(r.metric_key, r)
  }
  const out: Array<MetricSummary & MetricSummaryExtra> = []
  for (const id of ids) {
    const entry = getMetricById(id)
    const row = latest.get(id)
    if (!entry || !row) continue
    const value = Number(row.metric_value)
    if (!Number.isFinite(value)) continue
    const unit = row.metric_unit ?? entry.unit ?? ''
    const previous = previousValueFor(
      { metric_key: id, value, source: row.source, period_year: row.period_year, period_quarter: row.period_quarter, period_month: row.period_month },
      history,
    )
    const t = trendFor(value, previous)
    const look = ICONS[id] ?? DEFAULT_ICON
    const isDefault = DEFAULT_IDS.has(id)
    out.push({
      id,
      label: labelFor(entry, row),
      displayValue: formatSummaryValue(value, unit),
      rawValue: value,
      unit,
      unitPosition: unit === '₸' ? 'before' : 'after',
      trend: t.deltaPct ?? 0,
      trendAbs: t.delta ?? 0,
      trendDirection: t.trend === 'up' || t.trend === 'down' ? t.trend : 'flat',
      trendLabel: t.trend === 'unknown' ? 'нет истории' : 'к прошлому значению',
      icon: look.icon,
      color: look.color,
      goalCategory: null,
      isDefault,
      isRemovable: !isDefault,
      metricKey: id,
      source: row.source,
      confidence: row.confidence === null || row.confidence === undefined ? null : Number(row.confidence),
      computedAt: row.computed_at ?? row.recorded_at ?? null,
    })
  }
  return out
}

/** Read values + history of `ids` for one company (caller's client — RLS applies). */
export async function loadMetricSummaries(
  client: SupabaseClient,
  companyId: string,
  ids: readonly string[],
): Promise<Array<MetricSummary & MetricSummaryExtra>> {
  if (ids.length === 0) return []
  const [values, history] = await Promise.all([
    client
      .from('metrics')
      .select('metric_key, metric_value, metric_unit, source, confidence, provenance, computed_at, recorded_at, period_year, period_quarter, period_month')
      .eq('company_id', companyId)
      .in('metric_key', ids as string[]),
    client
      .from('metric_value_history')
      .select('metric_key, value, source, period_year, period_quarter, period_month, recorded_at')
      .eq('company_id', companyId)
      .in('metric_key', ids as string[])
      .order('recorded_at', { ascending: false })
      .limit(1000),
  ])
  if (values.error) throw new Error(`metrics summary: metrics failed (${values.error.code ?? 'unknown'})`)
  // History is optional (migration 085): a missing table → no trend. Any other
  // failed read is an error, not «no history».
  if (history.error && !isMissingTable(history.error)) {
    throw new Error(`metrics summary: history failed (${history.error.code ?? 'unknown'})`)
  }
  const historyRows = history.error ? [] : ((history.data ?? []) as MetricHistoryRow[])
  return buildMetricSummaries(ids, (values.data ?? []) as SummaryValueRow[], historyRows)
}
