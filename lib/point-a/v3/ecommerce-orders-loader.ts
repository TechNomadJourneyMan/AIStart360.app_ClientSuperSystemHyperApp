import type { SupabaseClient } from '@supabase/supabase-js'
import type { MetricSummary } from '@/types/metrics'
import type { ClientBaseExtractResult, ClientBaseRow } from './client-base-loader'
import type { FilterOption, SalesRow, TopTablePeriod } from './top-table'

const PAGE_SIZE = 1_000
const MAX_ROWS = 100_000
const MYHONOR_SOURCE = 'myhonor.shop'
const EXCLUDED_STATUSES = new Set([
  'draft',
  'pending',
  'payment_pending',
  'unpaid',
  'cancelled',
  'canceled',
  'void',
  'failed',
])

interface EcommerceOrderRecord {
  id: string
  external_id: string
  status: string
  placed_at: string
  paid_at: string | null
  currency: string
  net_paid_amount: number | string
  customer_hash: string
  synced_at: string
}

interface EcommerceOrderItemRecord {
  order_id: string
  product_external_id: string | null
  sku: string | null
  name: string
  quantity: number | string
  line_total: number | string
}

export interface EcommerceAnalyticsLoadResult {
  available: boolean
  allSalesRows: SalesRow[]
  selectedSalesRows: SalesRow[]
  clientBase: ClientBaseExtractResult
  products: FilterOption[]
  syncedAt: string | null
}

interface LoadOptions {
  productId?: string | null
}

function finiteNumber(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function validDate(value: unknown): string | null {
  if (typeof value !== 'string' || !value) return null
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString()
}

function isAnalyticalOrder(order: EcommerceOrderRecord): boolean {
  const status = order.status.trim().toLowerCase()
  const amount = finiteNumber(order.net_paid_amount)
  return (
    !EXCLUDED_STATUSES.has(status) &&
    order.currency.toUpperCase() === 'KZT' &&
    Boolean(order.customer_hash) &&
    amount !== null &&
    amount > 0 &&
    Boolean(validDate(order.paid_at ?? order.placed_at))
  )
}

async function pagedSelect<T>(
  build: (from: number, to: number) => PromiseLike<{
    data: unknown
    error: { message?: string } | null
  }>,
): Promise<{ rows: T[]; error: string | null }> {
  const rows: T[] = []
  for (let from = 0; from < MAX_ROWS; from += PAGE_SIZE) {
    const { data, error } = await build(from, from + PAGE_SIZE - 1)
    if (error) return { rows: [], error: error.message ?? 'query_failed' }
    const page = Array.isArray(data) ? (data as T[]) : []
    rows.push(...page)
    if (page.length < PAGE_SIZE) return { rows, error: null }
  }
  // A bounded result is safer than silently treating a partial history as a
  // complete RFM or new/repeat classification.
  return { rows: [], error: 'row_limit_exceeded' }
}

async function fetchOrders(
  supabase: SupabaseClient,
  userId: string,
): Promise<{ rows: EcommerceOrderRecord[]; error: string | null }> {
  return pagedSelect<EcommerceOrderRecord>((from, to) =>
    supabase
      .from('ecommerce_orders')
      .select(
        'id,external_id,status,placed_at,paid_at,currency,net_paid_amount,customer_hash,synced_at',
      )
      .eq('user_id', userId)
      .eq('source', MYHONOR_SOURCE)
      .order('placed_at', { ascending: true })
      .order('id', { ascending: true })
      .range(from, to),
  )
}

async function fetchItems(
  supabase: SupabaseClient,
  userId: string,
): Promise<{ rows: EcommerceOrderItemRecord[]; error: string | null }> {
  return pagedSelect<EcommerceOrderItemRecord>((from, to) =>
    supabase
      .from('ecommerce_order_items')
      .select('order_id,product_external_id,sku,name,quantity,line_total')
      .eq('user_id', userId)
      .eq('source', MYHONOR_SOURCE)
      .order('order_id', { ascending: true })
      .order('id', { ascending: true })
      .range(from, to),
  )
}

export function buildEcommerceAnalytics(
  rawOrders: EcommerceOrderRecord[],
  rawItems: EcommerceOrderItemRecord[],
  options: LoadOptions = {},
): Omit<EcommerceAnalyticsLoadResult, 'available'> {
  const orders = rawOrders.filter(isAnalyticalOrder)
  const itemsByOrder = new Map<string, EcommerceOrderItemRecord[]>()
  const products = new Map<string, string>()

  for (const item of rawItems) {
    const current = itemsByOrder.get(item.order_id) ?? []
    current.push(item)
    itemsByOrder.set(item.order_id, current)
    if (item.product_external_id) {
      products.set(
        item.product_external_id,
        item.name?.trim() || item.sku?.trim() || item.product_external_id,
      )
    }
  }

  const allSalesRows: SalesRow[] = []
  const selectedSalesRows: SalesRow[] = []
  let syncedAt: string | null = null

  for (const order of orders) {
    const occurredAt = validDate(order.paid_at ?? order.placed_at)
    const netPaid = finiteNumber(order.net_paid_amount)
    if (!occurredAt || netPaid === null) continue

    const row: SalesRow = {
      sale_id: `ecommerce:${MYHONOR_SOURCE}:${order.external_id}`,
      client_id: order.customer_hash,
      manager_id: null,
      product_id: null,
      amount: netPaid,
      occurred_at: occurredAt,
    }
    allSalesRows.push(row)

    const ingestedAt = validDate(order.synced_at)
    if (ingestedAt && (!syncedAt || ingestedAt > syncedAt)) {
      syncedAt = ingestedAt
    }

    if (!options.productId) {
      selectedSalesRows.push(row)
      continue
    }

    const lines = itemsByOrder.get(order.id) ?? []
    const totalGross = lines.reduce(
      (sum, line) => sum + Math.max(0, finiteNumber(line.line_total) ?? 0),
      0,
    )
    const selectedGross = lines
      .filter((line) => line.product_external_id === options.productId)
      .reduce(
        (sum, line) => sum + Math.max(0, finiteNumber(line.line_total) ?? 0),
        0,
      )
    if (selectedGross <= 0 || totalGross <= 0) continue

    // Allocate order-level discounts/refunds proportionally across line items.
    // This avoids counting the full order value once for every product.
    const allocated = Math.round(netPaid * (selectedGross / totalGross) * 100) / 100
    selectedSalesRows.push({
      ...row,
      product_id: options.productId,
      amount: allocated,
    })
  }

  const byCustomer = new Map<string, ClientBaseRow>()
  for (const row of allSalesRows) {
    const existing = byCustomer.get(row.client_id)
    if (!existing) {
      byCustomer.set(row.client_id, {
        client_id: row.client_id,
        first_purchase_date: row.occurred_at,
        last_purchase_date: row.occurred_at,
        total_spent_kzt: row.amount,
        purchase_count: 1,
        segment_hint: null,
        manager: null,
        product: null,
      })
      continue
    }
    if (row.occurred_at < existing.first_purchase_date) {
      existing.first_purchase_date = row.occurred_at
    }
    if (row.occurred_at > existing.last_purchase_date) {
      existing.last_purchase_date = row.occurred_at
    }
    existing.total_spent_kzt += row.amount
    existing.purchase_count += 1
  }

  const clientRows = Array.from(byCustomer.values())
  return {
    allSalesRows,
    selectedSalesRows,
    clientBase: {
      rows: clientRows,
      has_client_base: clientRows.length > 0,
      source_document_ids: clientRows.length ? ['external:myhonor:orders'] : [],
    },
    products: Array.from(products.entries())
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name, 'ru')),
    syncedAt,
  }
}

export async function loadEcommerceAnalytics(
  supabase: SupabaseClient,
  userId: string,
  options: LoadOptions = {},
): Promise<EcommerceAnalyticsLoadResult> {
  const [ordersResult, itemsResult] = await Promise.all([
    fetchOrders(supabase, userId),
    fetchItems(supabase, userId),
  ])
  if (ordersResult.error || itemsResult.error) {
    return {
      available: false,
      allSalesRows: [],
      selectedSalesRows: [],
      clientBase: {
        rows: [],
        has_client_base: false,
        source_document_ids: [],
      },
      products: [],
      syncedAt: null,
    }
  }
  return {
    available: true,
    ...buildEcommerceAnalytics(ordersResult.rows, itemsResult.rows, options),
  }
}

function periodStart(period: TopTablePeriod, now: Date): Date {
  const year = now.getUTCFullYear()
  const month = now.getUTCMonth()
  const day = now.getUTCDate()
  if (period === 'year') return new Date(Date.UTC(year, 0, 1))
  if (period === 'quarter') {
    return new Date(Date.UTC(year, Math.floor(month / 3) * 3, 1))
  }
  if (period === 'month') return new Date(Date.UTC(year, month, 1))
  if (period === 'week') {
    return new Date(now.getTime() - 7 * 86_400_000)
  }
  return new Date(Date.UTC(year, month, day))
}

function formatKzt(value: number): string {
  if (Math.abs(value) >= 1_000_000) {
    return `₸${(value / 1_000_000).toLocaleString('ru-RU', {
      maximumFractionDigits: 1,
    })}М`
  }
  if (Math.abs(value) >= 1_000) {
    return `₸${(value / 1_000).toLocaleString('ru-RU', {
      maximumFractionDigits: 1,
    })}К`
  }
  return `₸${Math.round(value).toLocaleString('ru-RU')}`
}

function trend(current: number, previous: number): {
  percent: number
  absolute: number
  direction: MetricSummary['trendDirection']
} {
  const absolute = current - previous
  const percent = previous > 0 ? Math.round((absolute / previous) * 1_000) / 10 : 0
  return {
    percent,
    absolute,
    direction: absolute > 0 ? 'up' : absolute < 0 ? 'down' : 'flat',
  }
}

export function buildOrderMetricSummaries(
  rows: SalesRow[],
  period: TopTablePeriod,
  now = new Date(),
): MetricSummary[] {
  if (rows.length === 0) return []
  const start = periodStart(period, now)
  const duration = Math.max(86_400_000, now.getTime() - start.getTime())
  const previousStart = new Date(start.getTime() - duration)
  const currentRows = rows.filter((row) => {
    const timestamp = new Date(row.occurred_at).getTime()
    return timestamp >= start.getTime() && timestamp <= now.getTime()
  })
  const previousRows = rows.filter((row) => {
    const timestamp = new Date(row.occurred_at).getTime()
    return timestamp >= previousStart.getTime() && timestamp < start.getTime()
  })

  const currentRevenue = currentRows.reduce((sum, row) => sum + row.amount, 0)
  const previousRevenue = previousRows.reduce((sum, row) => sum + row.amount, 0)
  const currentAov = currentRows.length ? currentRevenue / currentRows.length : 0
  const previousAov = previousRows.length
    ? previousRevenue / previousRows.length
    : 0
  const currentClients = new Set(currentRows.map((row) => row.client_id)).size
  const previousClients = new Set(previousRows.map((row) => row.client_id)).size

  if (currentRows.length === 0) return []

  const make = (
    id: string,
    label: string,
    rawValue: number,
    previous: number,
    displayValue: string,
    unit: string,
    icon: string,
  ): MetricSummary => {
    const delta = trend(rawValue, previous)
    return {
      id,
      label,
      displayValue,
      rawValue,
      unit,
      unitPosition: unit === '₸' ? 'before' : 'after',
      trend: delta.percent,
      trendAbs: delta.absolute,
      trendDirection: delta.direction,
      trendLabel: 'к предыдущему сопоставимому периоду',
      icon,
      color: '#6effc0',
      goalCategory: null,
      isDefault: true,
      isRemovable: false,
    }
  }

  return [
    make(
      'revenue',
      'Выручка',
      currentRevenue,
      previousRevenue,
      formatKzt(currentRevenue),
      '₸',
      'payments',
    ),
    make(
      'clients',
      'Клиенты',
      currentClients,
      previousClients,
      currentClients.toLocaleString('ru-RU'),
      '',
      'groups',
    ),
    make(
      'avg_check',
      'Средний чек',
      currentAov,
      previousAov,
      formatKzt(currentAov),
      '₸',
      'receipt_long',
    ),
  ]
}
