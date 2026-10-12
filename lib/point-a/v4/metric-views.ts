/**
 * lib/point-a/v4/metric-views.ts — real metrics behind Point A (server only).
 *
 *   blockMetricIds     the catalog metrics of a block: its own key metrics
 *                      first, then every metric of the departments it covers
 *   loadMetricViews    each metric with its current value, period, source,
 *                      confidence, «что это / зачем / как считается», norm,
 *                      dynamics from metric_value_history and — without a
 *                      value — where to get it
 * The values are the company's current ones (public.metrics — what every
 * surface shows); nothing is estimated here.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { getMetricById, getMetricRegistry } from '@/lib/metrics/registry'
import { getBizDescription, getGoalDescription, getGriDescription, getKpiDescription } from '@/lib/metrics/descriptions'
import { benchmarkForMetric } from '@/lib/metrics/catalog-helpers'
import { loadCompanyMetrics } from '@/lib/metrics/company-metrics'
import { valuePeriod } from '@/lib/goals/current'
import { periodLabel } from '@/lib/data-layer/period-key'
import type { MetricEntry } from '@/lib/metrics/types'
import { BLOCK_LIBRARY, type BlockKey } from './config'

/** Catalog departments a block covers. */
export const BLOCK_DEPARTMENTS: Readonly<Record<BlockKey, readonly string[]>> = {
  finance: ['Финансы'],
  sales: ['Продажи', 'Клиенты'],
  operations: ['Операции', 'Автоматизация', 'Цифровизация'],
  marketing: ['Маркетинг'],
  strategy: ['Управление'],
  team: ['HR'],
  product: ['Продукт'],
}

/** Key metrics of the top strip when the company has not chosen its own. */
export const DEFAULT_KEY_METRICS: readonly string[] = [
  'biz.finansy.vyruchka_god',
  'biz.finansy.valovaya_marzha',
  'biz.prodazhi.sredniy_chek',
  'biz.marketing.cac',
  'biz.marketing.ltv_cac',
  'biz.klienty.nps',
]
export const MAX_KEY_METRICS = 8

export function blockMetricIds(key: BlockKey): string[] {
  const ids = new Set<string>(BLOCK_LIBRARY[key].metrics.filter((id) => getMetricById(id)))
  for (const e of getMetricRegistry()) {
    if (e.namespace === 'biz' && e.department && BLOCK_DEPARTMENTS[key].includes(e.department)) ids.add(e.id)
  }
  return [...ids]
}

/** Metrics the owner may pin to the top strip: business metrics and KPIs. */
export function keyMetricCatalog(): Array<{ id: string; label: string; group: string; unit: string }> {
  return getMetricRegistry()
    .filter((e) => e.namespace === 'biz' || e.namespace === 'kpi')
    .map((e) => ({ id: e.id, label: e.label, group: e.department ?? 'KPI', unit: e.unit }))
}

export interface MetricView {
  id: string
  label: string
  unit: string
  flag: boolean
  value: number | null
  period: string | null
  source: string | null
  confidence: number | null
  what: string | null
  why: string | null
  how: string | null
  norm: { value: number; direction: 'higher_is_better' | 'lower_is_better'; label: string } | null
  /** Meets the norm (when there is one). */
  normOk: boolean | null
  trend: { previous: number; deltaPct: number | null; direction: 'up' | 'down' | 'flat' } | null
  /** Recent values, oldest first (for a sparkline). */
  history: number[]
  /** Without a value: where to get it. */
  needs: string | null
}

const SOURCE_RU: Record<string, string> = { survey: 'анкета', document: 'документ', manual: 'вручную', calculated: 'расчёт', external: 'интеграция', resolver: 'расчёт' }

function describe(entry: MetricEntry): { what: string | null; why: string | null; how: string | null } {
  let d: { what?: string; why?: string; how?: string; formula?: string } | undefined
  if (entry.namespace === 'biz' && entry.department) d = getBizDescription(entry.department, entry.label)
  else if (entry.namespace === 'kpi') d = getKpiDescription(entry.label)
  else if (entry.namespace === 'gri') d = getGriDescription(entry.label)
  else if (entry.namespace === 'goal' && entry.goalNumber) d = getGoalDescription(entry.goalNumber)?.items.find((i) => i.label === entry.label)
  const clean = (s: string | undefined) => (s && s.trim() ? s.trim() : null)
  return { what: clean(d?.what), why: clean(d?.why), how: clean(d?.how) ?? clean(d?.formula) ?? clean(entry.formula) }
}

/** Where the owner can get a missing value: the current survey question, else a document. */
export function whereToGet(entry: MetricEntry): string | null {
  const survey = entry.sources.find((s) => s.type === 'survey' && !s.legacy)
  if (survey) return `Анкета, шаг ${survey.step ?? '?'}: «${survey.label ?? entry.label}»`
  const doc = entry.sources.find((s) => s.type === 'document')
  if (doc) return 'Загрузите отчётность, где есть этот показатель'
  const ext = entry.sources.find((s) => s.type === 'external')
  if (ext) return `Подключите ${ext.system?.startsWith('integration:') ? 'интеграцию' : ext.system ?? 'источник'}`
  return null
}

export async function loadMetricViews(client: SupabaseClient, companyId: string, ids: readonly string[]): Promise<MetricView[]> {
  const entries = ids.map((id) => getMetricById(id)).filter((e): e is MetricEntry => !!e)
  if (!entries.length) return []
  const keys = entries.map((e) => e.id)
  const [current, hist] = await Promise.all([
    loadCompanyMetrics(client, companyId, keys),
    client
      .from('metric_value_history')
      .select('metric_key, value, recorded_at')
      .eq('company_id', companyId)
      .in('metric_key', keys)
      .order('recorded_at', { ascending: false })
      .limit(keys.length * 12),
  ])
  const history = new Map<string, number[]>()
  for (const r of (hist.error ? [] : hist.data ?? []) as Array<{ metric_key: string; value: unknown }>) {
    const v = Number(r.value)
    if (!Number.isFinite(v)) continue
    const list = history.get(r.metric_key) ?? []
    // consecutive duplicates are re-computations, not changes
    if (list.length < 12 && list[list.length - 1] !== v) list.push(v)
    history.set(r.metric_key, list)
  }

  return entries.map((e) => {
    const cur = current.get(e.id)
    const period = valuePeriod(cur)
    return toMetricView(e, cur ? { value: cur.value, period: period ? periodLabel(period) : null, source: cur.source, confidence: cur.confidence } : undefined, (history.get(e.id) ?? []).slice().reverse())
  })
}

/** A catalog metric with its current value and recent values (oldest first) as the page shows it. Pure. */
export function toMetricView(
  e: MetricEntry,
  cur: { value: number; period: string | null; source: string | null; confidence: number | null } | undefined,
  past: number[],
): MetricView {
  const value = cur?.value ?? null
  const previous = past.length >= 2 ? past[past.length - 2] : null
  const trend = value !== null && previous !== null
    ? {
        previous,
        deltaPct: previous !== 0 ? Math.round(((value - previous) / Math.abs(previous)) * 1000) / 10 : null,
        direction: (value > previous ? 'up' : value < previous ? 'down' : 'flat') as 'up' | 'down' | 'flat',
      }
    : null
  const b = benchmarkForMetric(e)
  const norm = b ? { value: b.value, direction: b.direction ?? ('higher_is_better' as const), label: b.label } : null
  return {
    id: e.id,
    label: e.label,
    unit: e.unit,
    flag: e.valueKind === 'flag',
    value,
    period: cur?.period ?? null,
    source: cur?.source ? SOURCE_RU[cur.source] ?? cur.source : null,
    confidence: cur?.confidence ?? null,
    ...describe(e),
    norm,
    normOk: norm && value !== null ? (norm.direction === 'lower_is_better' ? value <= norm.value : value >= norm.value) : null,
    trend,
    history: past,
    needs: value === null ? whereToGet(e) : null,
  }
}

/** «Подробнее» of a block (GET /api/v1/point-a/block/[key]). */
export interface BlockDetail {
  key: BlockKey
  title: string
  description: string
  block: import('./engine').V4Block | null
  metrics: MetricView[]
}
