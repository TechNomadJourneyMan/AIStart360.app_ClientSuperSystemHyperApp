// ============================================================
// app/api/v1/metrics/catalog/route.ts
// GET /api/v1/metrics/catalog
// Returns the Point A metric registry (122 metrics) as a
// paginated, filterable list. When `includeValues=true`, the
// endpoint also batch-fetches the latest materialized row from
// `public.metrics` for each metric and merges value/confidence/
// freshness onto the response items.
//
// This is the endpoint the redesigned `/metrics` page calls.
// ============================================================

import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { getMetricRegistry } from '@/lib/metrics/registry'
import type { MetricEntry } from '@/lib/metrics/types'
import type { MetricSource } from '@/lib/metrics/descriptions'

const FRESH_WINDOW_MS = 24 * 60 * 60 * 1000

// ── Query schema (Russian error messages) ────────────────────

const NAMESPACE_VALUES = ['all', 'biz', 'kpi', 'gri', 'goal'] as const
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
  department: z.string().min(1).max(200).optional(),
  search: z.string().min(1).max(200).optional(),
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

// ── Response item shape ──────────────────────────────────────

interface CatalogItemSource {
  type: string
  key?: string
  field?: string
  doc_type?: string
  system?: string
}

interface CatalogItem {
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

interface MetricRow {
  metric_key: string
  metric_value: number | string | null
  metric_unit: string | null
  confidence: number | string | null
  source: string | null
  computed_at: string | null
  recorded_at: string | null
}

// ── Helpers ──────────────────────────────────────────────────

function projectSource(s: MetricSource): CatalogItemSource {
  const out: CatalogItemSource = { type: s.type }
  if (s.key !== undefined) out.key = s.key
  if (s.field !== undefined) out.field = s.field
  if (s.doc_type !== undefined) out.doc_type = s.doc_type
  if (s.system !== undefined) out.system = s.system
  return out
}

function entryToItem(e: MetricEntry): CatalogItem {
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

function compareWithNullsLast(
  a: number | null,
  b: number | null,
  direction: 'asc' | 'desc',
): number {
  if (a === null && b === null) return 0
  if (a === null) return 1
  if (b === null) return -1
  return direction === 'asc' ? a - b : b - a
}

function compareTimestampsDesc(
  a: string | null,
  b: string | null,
): number {
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

function sortItems(
  items: CatalogItem[],
  sort: (typeof SORT_VALUES)[number],
): CatalogItem[] {
  const arr = items.slice()
  switch (sort) {
    case 'label_asc':
      arr.sort((a, b) => a.label.localeCompare(b.label, 'ru'))
      break
    case 'label_desc':
      arr.sort((a, b) => b.label.localeCompare(a.label, 'ru'))
      break
    case 'value_desc':
      arr.sort((a, b) =>
        compareWithNullsLast(numericValue(a.value), numericValue(b.value), 'desc'),
      )
      break
    case 'value_asc':
      arr.sort((a, b) =>
        compareWithNullsLast(numericValue(a.value), numericValue(b.value), 'asc'),
      )
      break
    case 'confidence_desc':
      arr.sort((a, b) => compareWithNullsLast(a.confidence, b.confidence, 'desc'))
      break
    case 'freshness_desc':
      arr.sort((a, b) => compareTimestampsDesc(a.computedAt, b.computedAt))
      break
    case 'trend_up':
      // TODO(phase3): join with trend analysis once available; fall back to value desc.
      arr.sort((a, b) =>
        compareWithNullsLast(numericValue(a.value), numericValue(b.value), 'desc'),
      )
      break
    case 'trend_down':
      // TODO(phase3): join with trend analysis once available; fall back to value asc.
      arr.sort((a, b) =>
        compareWithNullsLast(numericValue(a.value), numericValue(b.value), 'asc'),
      )
      break
  }
  return arr
}

function filterRegistry(
  registry: MetricEntry[],
  q: {
    namespace: (typeof NAMESPACE_VALUES)[number]
    department?: string
    search?: string
  },
): MetricEntry[] {
  let out = registry
  if (q.namespace !== 'all') {
    out = out.filter((e) => e.namespace === q.namespace)
  }
  if (q.department && q.namespace === 'biz') {
    out = out.filter((e) => e.department === q.department)
  } else if (q.department) {
    // department filter is only meaningful for biz; ignore otherwise.
  }
  if (q.search) {
    const needle = q.search.toLowerCase()
    out = out.filter((e) =>
      e.label.toLowerCase().includes(needle) ||
      e.id.toLowerCase().includes(needle),
    )
  }
  return out
}

function mergeLatestRows(
  items: CatalogItem[],
  rows: MetricRow[],
  now: Date,
): CatalogItem[] {
  // Pick the most-recent row per metric_key (input is ordered by
  // metric_key then computed_at DESC NULLS LAST).
  const latest = new Map<string, MetricRow>()
  for (const row of rows) {
    if (!latest.has(row.metric_key)) {
      latest.set(row.metric_key, row)
    }
  }
  return items.map((item) => {
    const row = latest.get(item.id)
    if (!row) return item
    const computedAt =
      row.computed_at ?? row.recorded_at ?? null
    const rawValue = row.metric_value
    const numeric = numericValue(rawValue ?? null)
    return {
      ...item,
      value: numeric ?? (rawValue !== null && rawValue !== undefined ? String(rawValue) : null),
      confidence:
        row.confidence === null || row.confidence === undefined
          ? null
          : Number(row.confidence),
      source: row.source ?? null,
      computedAt,
      fresh: isFresh(computedAt, now),
      unit: row.metric_unit ?? item.unit,
    }
  })
}

// ── Route handler ────────────────────────────────────────────

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url)
    const rawQuery = {
      namespace: url.searchParams.get('namespace') ?? undefined,
      department: url.searchParams.get('department') ?? undefined,
      search: url.searchParams.get('search') ?? undefined,
      sort: url.searchParams.get('sort') ?? undefined,
      page: url.searchParams.get('page') ?? undefined,
      pageSize: url.searchParams.get('pageSize') ?? undefined,
      includeValues: url.searchParams.get('includeValues') ?? undefined,
    }

    const parsed = QuerySchema.safeParse(rawQuery)
    if (!parsed.success) {
      const firstIssue = parsed.error.issues[0]
      const message = firstIssue?.message ?? 'Некорректные параметры запроса'
      return NextResponse.json(
        { ok: false, error: message },
        { status: 400 },
      )
    }

    const q = parsed.data
    let includeValues = q.includeValues

    // 1. Auth (optional when includeValues=false)
    const supabase = await createClient()
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if ((authError || !user) && includeValues) {
      // Soft-fallback: drop value resolution, still return registry.
      includeValues = false
    }

    // 2. Pull registry + filter
    const registry = getMetricRegistry()
    const filtered = filterRegistry(registry, {
      namespace: q.namespace,
      department: q.department,
      search: q.search,
    })

    let items: CatalogItem[] = filtered.map(entryToItem)
    const now = new Date()

    // 3. Resolve user's company + batch-fetch latest values
    if (includeValues && user) {
      const { data: companyRow, error: companyError } = await supabase
        .from('companies')
        .select('id')
        .eq('user_id', user.id)
        .maybeSingle()

      if (companyError) {
        return NextResponse.json(
          { ok: false, error: companyError.message },
          { status: 500 },
        )
      }

      if (companyRow) {
        const companyId = companyRow.id as string
        const metricKeys = items.map((i) => i.id)
        if (metricKeys.length > 0) {
          const { data: rows, error: metricsError } = await supabase
            .from('metrics')
            .select(
              'metric_key, metric_value, metric_unit, confidence, source, computed_at, recorded_at',
            )
            .eq('company_id', companyId)
            .in('metric_key', metricKeys)
            .order('metric_key', { ascending: true })
            .order('computed_at', { ascending: false, nullsFirst: false })

          if (metricsError) {
            return NextResponse.json(
              { ok: false, error: metricsError.message },
              { status: 500 },
            )
          }

          items = mergeLatestRows(items, (rows ?? []) as MetricRow[], now)
        }
      }
    }

    // 4. Sort + paginate
    const sorted = sortItems(items, q.sort)
    const total = sorted.length
    const start = (q.page - 1) * q.pageSize
    const end = start + q.pageSize
    const slice = sorted.slice(start, end)

    return NextResponse.json({
      ok: true,
      data: {
        total,
        page: q.page,
        pageSize: q.pageSize,
        items: slice,
      },
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Неизвестная ошибка'
    return NextResponse.json({ ok: false, error: message }, { status: 500 })
  }
}
