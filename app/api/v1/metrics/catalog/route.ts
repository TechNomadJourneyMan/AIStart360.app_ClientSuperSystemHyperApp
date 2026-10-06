// ============================================================
// app/api/v1/metrics/catalog/route.ts
// GET /api/v1/metrics/catalog
// The code metric registry (lib/metrics/registry.ts) as a paginated,
// filterable list — the Point A «Метрики» section (level 2).
//
// Filters: namespace, department (biz), category / subcategory
// (lib/metrics/taxonomy.ts), search. Sorts: label, value, confidence,
// freshness, trend_up / trend_down (by deltaPct from metric_value_history,
// signed by the metric's better direction: a falling CAC is an improvement).
//
// With includeValues=true (default) and a session, the company is resolved by
// lib/tenancy (read access, optional ?companyId=) and every item carries its
// latest public.metrics value plus the enrichment of MetricCatalogEnrichment
// (types/metric-catalog.ts): category, description («what»), calculation
// method, target (metric_targets / owner revenue goal), benchmark (labelled
// code sources only), previous value / delta / trend (history), status,
// period, lastUpdated and provenance. The demo `current_state` texts of the
// catalog are never returned.
// ============================================================

import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { getMetricRegistry } from '@/lib/metrics/registry'
import type { MetricEntry } from '@/lib/metrics/types'
import type { MetricSource } from '@/lib/metrics/descriptions'
import type { MetricCatalogEnrichment, MetricCategoryKey } from '@/types/metric-catalog'
import {
  applyGriSectionScores,
  countByNamespace,
  enrichMetric,
  isMissingTable,
  type EnrichmentContext,
  type MetricHistoryRow,
  type MetricTargetRow,
  type ValueRowLike,
} from '@/lib/metrics/catalog-helpers'
import { METRIC_CATEGORIES, classifyMetric, countByCategory } from '@/lib/metrics/taxonomy'
import { resolveTenantWith, tenantErrorMessage } from '@/lib/tenancy'
import { apiError, safeErrorMessage } from '@/lib/api-error'
import { isLowerBetter } from '@/components/metrics/catalog-model'

const FRESH_WINDOW_MS = 24 * 60 * 60 * 1000
/** History rows read per request (newest first) — enough for the previous value of every metric. */
const HISTORY_LIMIT = 5000

// ── Query schema (Russian error messages) ────────────────────

const NAMESPACE_VALUES = ['all', 'biz', 'kpi', 'gri', 'goal'] as const
const CATEGORY_VALUES = ['all', ...METRIC_CATEGORIES.map((c) => c.key)] as [string, ...string[]]
const SORT_VALUES = [
  'label_asc',
  'label_desc',
  'value_desc',
  'value_asc',
  'trend_up',
  'trend_down',
  'confidence_desc',
  'freshness_desc',
] as const

const QuerySchema = z.object({
  namespace: z
    .enum(NAMESPACE_VALUES, {
      errorMap: () => ({ message: 'Недопустимое значение namespace' }),
    })
    .default('all'),
  category: z
    .enum(CATEGORY_VALUES, {
      errorMap: () => ({ message: 'Недопустимое значение category' }),
    })
    .default('all'),
  subcategory: z.string().min(1).max(50).optional(),
  department: z.string().min(1).max(200).optional(),
  search: z.string().min(1).max(200).optional(),
  companyId: z.string().min(1).max(100).optional(),
  sort: z
    .enum(SORT_VALUES, {
      errorMap: () => ({ message: 'Недопустимое значение sort' }),
    })
    .default('label_asc'),
  page: z.coerce
    .number({ invalid_type_error: 'Параметр page должен быть числом' })
    .int('Параметр page должен быть целым числом')
    .min(1, 'Параметр page должен быть не меньше 1')
    .max(100, 'Параметр page не может превышать 100')
    .default(1),
  pageSize: z.coerce
    .number({ invalid_type_error: 'Параметр pageSize должен быть числом' })
    .int('Параметр pageSize должен быть целым числом')
    .min(10, 'Параметр pageSize должен быть не меньше 10')
    .max(200, 'Параметр pageSize не может превышать 200')
    .default(50),
  includeValues: z
    .union([z.boolean(), z.string()])
    .transform((v) => {
      if (typeof v === 'boolean') return v
      if (v === 'true' || v === '1') return true
      if (v === 'false' || v === '0') return false
      return true
    })
    .default(true),
})

type Query = z.infer<typeof QuerySchema>

// ── Response item shape ──────────────────────────────────────

interface CatalogItemSource {
  type: string
  key?: string
  keys?: string[]
  field?: string
  doc_type?: string
  system?: string
  label?: string
  step?: number
  coerce?: MetricSource['coerce']
}

interface CatalogItemBase {
  id: string
  label: string
  namespace: string
  department: string | null
  goalNumber: string | null
  unit: string
  formula: string | null
  sources: CatalogItemSource[]
  value: number | string | null
  confidence: number | null
  source: string | null
  computedAt: string | null
  fresh: boolean
}

type CatalogItem = CatalogItemBase & MetricCatalogEnrichment

interface MetricRow {
  metric_key: string
  metric_value: number | string | null
  metric_unit: string | null
  confidence: number | string | null
  source: string | null
  computed_at: string | null
  recorded_at: string | null
  period_year: number | null
  period_quarter: string | null
  period_month: number | null
}

// ── Helpers ──────────────────────────────────────────────────

function projectSource(s: MetricSource): CatalogItemSource {
  const out: CatalogItemSource = { type: s.type }
  if (s.key !== undefined) out.key = s.key
  if (s.keys !== undefined) out.keys = s.keys
  if (s.field !== undefined) out.field = s.field
  if (s.doc_type !== undefined) out.doc_type = s.doc_type
  if (s.system !== undefined) out.system = s.system
  if (s.label !== undefined) out.label = s.label
  if (s.step !== undefined) out.step = s.step
  if (s.coerce !== undefined) out.coerce = s.coerce
  return out
}

function entryToBase(e: MetricEntry): CatalogItemBase {
  return {
    id: e.id,
    label: e.label,
    namespace: e.namespace,
    department: e.department ?? null,
    goalNumber: e.goalNumber ?? null,
    unit: e.unit ?? '',
    formula: e.formula ?? null,
    sources: (e.sources ?? []).map(projectSource),
    value: null,
    confidence: null,
    source: null,
    computedAt: null,
    fresh: false,
  }
}

function isFresh(computedAt: string | null, now: Date): boolean {
  if (!computedAt) return false
  const ts = Date.parse(computedAt)
  if (Number.isNaN(ts)) return false
  return now.getTime() - ts <= FRESH_WINDOW_MS
}

function compareWithNullsLast(a: number | null, b: number | null, direction: 'asc' | 'desc'): number {
  if (a === null && b === null) return 0
  if (a === null) return 1
  if (b === null) return -1
  return direction === 'asc' ? a - b : b - a
}

function compareTimestampsDesc(a: string | null, b: string | null): number {
  const ta = a ? Date.parse(a) : NaN
  const tb = b ? Date.parse(b) : NaN
  const aValid = !Number.isNaN(ta)
  const bValid = !Number.isNaN(tb)
  if (!aValid && !bValid) return 0
  if (!aValid) return 1
  if (!bValid) return -1
  return tb - ta
}

function numericValue(v: number | string | null): number | null {
  if (v === null || v === undefined) return null
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : null
}

/** Relative change in the metric's good direction (+ = better), null without history. */
function improvementPct(item: CatalogItem): number | null {
  if (item.deltaPct === null || item.deltaPct === undefined) return null
  return isLowerBetter(item) ? -item.deltaPct : item.deltaPct
}

function sortItems(items: CatalogItem[], sort: Query['sort']): CatalogItem[] {
  const arr = items.slice()
  switch (sort) {
    case 'label_asc':
      arr.sort((a, b) => a.label.localeCompare(b.label, 'ru'))
      break
    case 'label_desc':
      arr.sort((a, b) => b.label.localeCompare(a.label, 'ru'))
      break
    case 'value_desc':
      arr.sort((a, b) => compareWithNullsLast(numericValue(a.value), numericValue(b.value), 'desc'))
      break
    case 'value_asc':
      arr.sort((a, b) => compareWithNullsLast(numericValue(a.value), numericValue(b.value), 'asc'))
      break
    case 'confidence_desc':
      arr.sort((a, b) => compareWithNullsLast(a.confidence, b.confidence, 'desc'))
      break
    case 'freshness_desc':
      arr.sort((a, b) => compareTimestampsDesc(a.computedAt, b.computedAt))
      break
    case 'trend_up':
      // «Лучшая динамика»: biggest improvement first — growth, or a drop for
      // metrics where lower is better (CAC, costs, churn …); no history last.
      arr.sort((a, b) => compareWithNullsLast(improvementPct(a), improvementPct(b), 'desc'))
      break
    case 'trend_down':
      // «Худшая динамика»: biggest deterioration first; no history last.
      arr.sort((a, b) => compareWithNullsLast(improvementPct(a), improvementPct(b), 'asc'))
      break
  }
  return arr
}

function filterRegistry(
  registry: MetricEntry[],
  q: Pick<Query, 'namespace' | 'department' | 'search' | 'category' | 'subcategory'>,
): MetricEntry[] {
  let out = registry
  if (q.namespace !== 'all') out = out.filter((e) => e.namespace === q.namespace)
  // department is only meaningful for biz; ignored otherwise.
  if (q.department && q.namespace === 'biz') out = out.filter((e) => e.department === q.department)
  if (q.category !== 'all' || q.subcategory) {
    out = out.filter((e) => {
      const p = classifyMetric(e)
      if (q.category !== 'all' && p.category !== q.category) return false
      if (q.subcategory && p.subcategory?.key !== q.subcategory) return false
      return true
    })
  }
  if (q.search) {
    const needle = q.search.toLowerCase()
    out = out.filter((e) => e.label.toLowerCase().includes(needle) || e.id.toLowerCase().includes(needle))
  }
  return out
}

/** Latest row per metric_key (rows ordered by metric_key, computed_at DESC NULLS LAST). */
function latestRows(rows: MetricRow[]): Map<string, MetricRow> {
  const latest = new Map<string, MetricRow>()
  for (const row of rows) if (!latest.has(row.metric_key)) latest.set(row.metric_key, row)
  return latest
}

function mergeRow(item: CatalogItemBase, row: MetricRow | undefined, now: Date): CatalogItemBase {
  if (!row) return item
  const computedAt = row.computed_at ?? row.recorded_at ?? null
  const numeric = numericValue(row.metric_value ?? null)
  return {
    ...item,
    value: numeric ?? (row.metric_value !== null && row.metric_value !== undefined ? String(row.metric_value) : null),
    confidence: row.confidence === null || row.confidence === undefined ? null : Number(row.confidence),
    source: row.source ?? null,
    computedAt,
    fresh: isFresh(computedAt, now),
    unit: row.metric_unit ?? item.unit,
  }
}

/**
 * Optional table (085): a table that does not exist yet means «absent». Any
 * other read error fails the catalog (500) — otherwise every item silently
 * showed «нет цели» / «нет истории» and the trend sorts fell back to registry
 * order while looking valid.
 */
async function optionalRows<T>(what: string, p: PromiseLike<{ data: unknown; error: { code?: string; message?: string } | null }>): Promise<T[]> {
  const { data, error } = await p
  if (error) {
    if (isMissingTable(error)) return []
    console.error(`[api/v1/metrics/catalog] ${what}`, error.code ?? '', error.message ?? '')
    throw new Error(`metrics catalog: ${what} read failed (${error.code ?? 'unknown'})`)
  }
  return (data ?? []) as T[]
}

// ── Route handler ────────────────────────────────────────────

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url)
    const raw: Record<string, string | undefined> = {}
    for (const k of ['namespace', 'category', 'subcategory', 'department', 'search', 'companyId', 'sort', 'page', 'pageSize', 'includeValues']) {
      raw[k] = url.searchParams.get(k) ?? undefined
    }
    const parsed = QuerySchema.safeParse(raw)
    if (!parsed.success) {
      return apiError(parsed.error.issues[0]?.message ?? 'Некорректные параметры запроса', 400)
    }
    const q = parsed.data
    const now = new Date()

    // 1. Auth (optional: without a session the registry is still returned, without values).
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    const includeValues = q.includeValues && !authError && Boolean(user)

    // 2. Registry + filters
    const registry = getMetricRegistry()
    const filtered = filterRegistry(registry, q)
    let bases: CatalogItemBase[] = filtered.map(entryToBase)
    const rowsByKey = new Map<string, ValueRowLike>()
    const ctx: EnrichmentContext = { targets: [], revenueTarget12m: null, history: [] }

    // 3. Company values
    if (includeValues && user) {
      const tenant = await resolveTenantWith(supabase, user.id, { companyId: q.companyId, access: 'read' })
      if (!tenant.ok && q.companyId) {
        return apiError(tenant.error === 'no_company' ? 'no_company' : tenantErrorMessage(tenant.error), tenant.status, {
          message: tenantErrorMessage(tenant.error),
        })
      }
      if (tenant.ok) {
        const companyId = tenant.tenant.companyId
        const [companyRes, metricsRes, targets, history] = await Promise.all([
          supabase.from('companies').select('id, user_id, target_revenue_12m_kzt').eq('id', companyId).maybeSingle(),
          supabase
            .from('metrics')
            .select('metric_key, metric_value, metric_unit, confidence, source, computed_at, recorded_at, period_year, period_quarter, period_month')
            .eq('company_id', companyId)
            .order('metric_key', { ascending: true })
            .order('computed_at', { ascending: false, nullsFirst: false }),
          optionalRows<MetricTargetRow>(
            'metric_targets',
            supabase.from('metric_targets').select('metric_key, target_value, direction, period_label, source').eq('company_id', companyId),
          ),
          optionalRows<MetricHistoryRow>(
            'metric_value_history',
            supabase
              .from('metric_value_history')
              .select('metric_key, value, source, period_year, period_quarter, period_month, recorded_at')
              .eq('company_id', companyId)
              .order('recorded_at', { ascending: false })
              .limit(HISTORY_LIMIT),
          ),
        ])
        if (metricsRes.error) {
          console.error('[api/v1/metrics/catalog] metrics', metricsRes.error)
          return apiError('Не удалось загрузить значения метрик', 500)
        }
        const latest = latestRows((metricsRes.data ?? []) as MetricRow[])
        bases = bases.map((b) => mergeRow(b, latest.get(b.id), now))
        for (const [key, row] of latest) {
          rowsByKey.set(key, {
            metric_key: key,
            value: numericValue(row.metric_value),
            source: row.source,
            period_year: row.period_year ?? null,
            period_quarter: row.period_quarter ?? null,
            period_month: row.period_month ?? null,
            computed_at: row.computed_at ?? row.recorded_at ?? null,
          })
        }
        const company = companyRes.data as { user_id: string | null; target_revenue_12m_kzt: number | string | null } | null
        const revenueTarget = numericValue(company?.target_revenue_12m_kzt ?? null)
        ctx.targets = targets
        ctx.history = history
        ctx.revenueTarget12m = revenueTarget

        // 3b. GRI overlay — the 7 gri.* blocks are scored by the GRI assessment
        // (section_avgs), not by survey/document resolution.
        if (bases.some((i) => i.namespace === 'gri' && i.value === null)) {
          const ownerId = company?.user_id ?? null
          const griQuery = supabase.from('gri_assessments').select('section_avgs, created_at')
          const scoped = ownerId ? griQuery.eq('user_id', ownerId) : griQuery.eq('company_id', companyId)
          const griRows = await optionalRows<{ section_avgs: Record<string, unknown> | null; created_at: string | null }>(
            'gri_assessments',
            scoped.order('created_at', { ascending: false }).limit(1),
          )
          const before = new Set(bases.filter((b) => b.value !== null).map((b) => b.id))
          bases = applyGriSectionScores(bases, griRows[0] ?? null, FRESH_WINDOW_MS, now)
          for (const b of bases) {
            if (b.namespace !== 'gri' || before.has(b.id) || b.value === null) continue
            rowsByKey.set(b.id, {
              metric_key: b.id,
              value: numericValue(b.value),
              source: b.source,
              period_year: null,
              period_quarter: null,
              period_month: null,
              computed_at: b.computedAt,
            })
          }
        }
      }
    }

    // 4. Enrichment
    const byId = new Map(filtered.map((e) => [e.id, e]))
    const items: CatalogItem[] = bases.map((b) => ({
      ...b,
      ...enrichMetric(byId.get(b.id) as MetricEntry, rowsByKey.get(b.id) ?? null, ctx),
    }))

    // 5. Tab / chip totals (search-aware, independent of the active tab).
    const searchOnly = filterRegistry(registry, { namespace: 'all', category: 'all', search: q.search })
    const counts = countByNamespace(searchOnly)
    const categoryCounts = countByCategory(searchOnly)
    const categories = METRIC_CATEGORIES.map((c) => ({ ...c, count: categoryCounts[c.key as MetricCategoryKey] }))

    // 6. Sort + paginate
    const sorted = sortItems(items, q.sort)
    const total = sorted.length
    const start = (q.page - 1) * q.pageSize
    const slice = sorted.slice(start, start + q.pageSize)

    return NextResponse.json({
      ok: true,
      data: {
        total,
        counts,
        categoryCounts,
        categories,
        page: q.page,
        pageSize: q.pageSize,
        items: slice,
      },
    })
  } catch (err) {
    console.error('[api/v1/metrics/catalog]', err)
    return apiError(safeErrorMessage(err, 'Не удалось загрузить каталог метрик'), 500)
  }
}
