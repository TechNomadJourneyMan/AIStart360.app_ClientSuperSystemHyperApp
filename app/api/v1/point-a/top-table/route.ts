// ============================================================
// GET /api/v1/point-a/top-table
//
// Returns the 8-row × 6-column TOP SALES TABLE for the calling
// user's company. Auth-gated by Supabase session cookie.
//
// Query params:
//   period   day|week|month|quarter|year  (default: month)
//   product  product_id                   (optional dimension filter)
//   manager  manager_id                   (optional dimension filter)
//   year     YYYY                         (optional anchor year)
//
// Response: `TopTableResponse` from @/types/point-a-dashboard.
// The internal compute engine (lib/point-a/v3/top-table.ts) is
// shape-mapped onto the UI contract — the UI keys (sales_sum /
// new_count / etc.) stay stable while internal naming stays
// descriptive (sales_amount / new_sales_count / etc.).
//
// Cache: Next 14 revalidate=60 seconds. Override with dynamic="force-dynamic"
// is intentionally NOT set — we want short-lived ISR per user.
// ============================================================

export const revalidate = 60

import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import {
  computeTopTable,
  discoverFilters,
  type TopTablePeriod,
  type TopTableMetricKey,
  type TopTableRow as EngineRow,
} from '@/lib/point-a/v3/top-table'
import type {
  PointAPeriod,
  TopTableResponse,
  TopTableRow as UiRow,
  TopTableRowKey,
} from '@/types/point-a-dashboard'

const ALLOWED_PERIODS: TopTablePeriod[] = ['day', 'week', 'month', 'quarter', 'year']

// Map engine metric keys → stable UI keys (kept for backwards compat
// with the dashboard components shipped against the original mock).
const KEY_MAP: Record<TopTableMetricKey, TopTableRowKey> = {
  sales_count: 'sales_count',
  sales_amount: 'sales_sum',
  avg_check: 'avg_check',
  new_sales_count: 'new_count',
  new_sales_amount: 'new_sum',
  new_avg_check: 'avg_check_new',
  repeat_sales_count: 'repeat_count',
  repeat_sales_amount: 'repeat_sum',
}

// Count-vs-amount unit hint (₸ for monetary; count for headcounts).
const COUNT_METRICS = new Set<TopTableMetricKey>([
  'sales_count',
  'new_sales_count',
  'repeat_sales_count',
])

function parsePeriod(raw: string | null): TopTablePeriod {
  if (!raw) return 'month'
  return (ALLOWED_PERIODS as string[]).includes(raw)
    ? (raw as TopTablePeriod)
    : 'month'
}

function parseYear(raw: string | null): number | undefined {
  if (!raw) return undefined
  const n = parseInt(raw, 10)
  if (!Number.isFinite(n) || n < 2000 || n > 2100) return undefined
  return n
}

function toUiRow(row: EngineRow): UiRow {
  return {
    key: KEY_MAP[row.metric],
    label_ru: row.label,
    unit: COUNT_METRICS.has(row.metric) ? 'count' : '₸',
    plan_year: row.planYear,
    fact_year: row.factYear,
    plan_month: row.planMonth,
    fact_month: row.factMonth,
    pct_year: row.pctYear,
    pct_3y: row.pct3y,
  }
}

function unauthorized() {
  return NextResponse.json(
    { ok: false, error: 'Unauthorized' },
    { status: 401 },
  )
}

/**
 * GET /api/v1/point-a/top-table
 */
export async function GET(req: NextRequest) {
  const supabase = await createClient()

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()

  if (authError || !user) return unauthorized()

  const search = req.nextUrl.searchParams
  const period = parsePeriod(search.get('period'))
  const product = search.get('product') || null
  const manager = search.get('manager') || null
  const year = parseYear(search.get('year'))

  try {
    const [engineResult, filters] = await Promise.all([
      computeTopTable(supabase, user.id, {
        period,
        productId: product ?? undefined,
        managerId: manager ?? undefined,
        year,
      }),
      discoverFilters(supabase, user.id),
    ])

    const hasRealData =
      engineResult.dataCoverage > 0 || engineResult.planSource !== 'default'
    const rows = hasRealData ? engineResult.rows.map(toUiRow) : []

    const body: TopTableResponse = {
      ok: true,
      data: {
        rows,
        period: period as PointAPeriod,
        product,
        manager,
        // First entry is "Все" so the dropdown can use it as no-filter.
        available_products: ['Все', ...filters.products.map((p) => p.name)],
        available_managers: ['Все', ...filters.managers.map((m) => m.name)],
        computed_at: engineResult.asOf,
        // Keep the compatibility flag for existing clients, but do not expose
        // synthetic zero/default rows as business data.
        is_mock: !hasRealData,
      },
    }
    return NextResponse.json(body)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown error'
    return NextResponse.json(
      { ok: false, error: `top-table failed: ${message}` },
      { status: 500 },
    )
  }
}
