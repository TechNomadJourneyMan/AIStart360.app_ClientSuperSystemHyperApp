import type { SupabaseClient } from '@supabase/supabase-js'
import {
  buildStoreAlerts,
  calculateSalesMetrics,
  summarizeChannels,
  summarizeWarehouses,
} from './metrics'
import type {
  StoreCatalogFact,
  StoreInventoryFact,
  StoreOverview,
  StoreSalesFact,
} from './types'

const PAGE_SIZE = 1_000
const MAX_FACT_ROWS = 100_000
const MAX_REFERENCE_ROWS = 10_000
const MYHONOR_SOURCE = 'myhonor.shop'
const EXCLUDED_ORDER_STATUSES = new Set([
  'draft',
  'pending',
  'payment_pending',
  'unpaid',
  'cancelled',
  'canceled',
  'void',
  'failed',
  'refunded',
])

interface ImportRunRow {
  id: string
  company_id: string
  import_kind: 'prices' | 'inventory' | 'sales'
  scope_key: string
  period_start: string | null
  period_end: string | null
  row_count: number | string
  published_at: string
}

interface VariantRow {
  id: string
  sku: string
  name: string
  is_active: boolean
}

interface WarehouseRow {
  id: string
  name: string
}

interface SalesRow {
  id: string
  external_line_id: string
  variant_id: string | null
  warehouse_id: string | null
  sku_snapshot: string | null
  name_snapshot: string
  channel: string
  occurred_on: string
  quantity: number | string
  list_amount: number | string
  net_revenue: number | string
  cost_amount: number | string
  discount_amount: number | string
}

interface InventoryRow {
  variant_id: string
  warehouse_id: string
  snapshot_date: string
  quantity_available: number | string
  quantity_reserved: number | string
}

interface PriceRow {
  variant_id: string
  purchase_price: number | string | null
  retail_price: number | string | null
}

interface EcommerceProductRow {
  id: string
  sku: string
  name: string
  price: number | string
  availability: string
  image_url: string | null
  catalog_active: boolean
  catalog_synced_at: string | null
}

interface EcommerceOrderRow {
  id: string
  order_number: string
  status: string
  placed_at: string
  paid_at: string | null
  currency: string
  gross_amount: number | string
  discount_amount: number | string
  refund_amount: number | string
  net_paid_amount: number | string
  synced_at: string
}

interface EcommerceOrderItemRow {
  id: string
  order_id: string
  sku: string
  name: string
  quantity: number | string
  line_total: number | string
}

type QueryResult<T> = { rows: T[]; error: string | null; truncated: boolean }

function number(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function validIso(value: unknown): string | null {
  if (typeof value !== 'string' || !value) return null
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString()
}

function latest(values: Array<string | null | undefined>): string | null {
  return values.reduce<string | null>((current, value) => {
    const iso = validIso(value)
    return iso && (!current || iso > current) ? iso : current
  }, null)
}

function newestRun(runs: ImportRunRow[]): ImportRunRow | null {
  return runs.reduce<ImportRunRow | null>((current, run) => {
    if (!current) return run
    const currentPublishedAt = validIso(current.published_at)
    const runPublishedAt = validIso(run.published_at)
    if (!runPublishedAt) return current
    if (!currentPublishedAt || runPublishedAt > currentPublishedAt) return run
    return current
  }, null)
}

/**
 * Corrections to an older month may be published after the latest business
 * period. Keep the dashboard on the newest factual period and use publication
 * time only to break ties for defensive legacy duplicates.
 */
function latestSalesPeriodRun(runs: ImportRunRow[]): ImportRunRow | null {
  return runs.reduce<ImportRunRow | null>((current, run) => {
    if (!current) return run
    const currentEnd = validIso(current.period_end) ?? validIso(current.period_start)
    const runEnd = validIso(run.period_end) ?? validIso(run.period_start)
    if (runEnd && !currentEnd) return run
    if (!runEnd && currentEnd) return current
    if (runEnd && currentEnd && runEnd !== currentEnd) {
      return runEnd > currentEnd ? run : current
    }

    const currentStart = validIso(current.period_start)
    const runStart = validIso(run.period_start)
    if (runStart && !currentStart) return run
    if (!runStart && currentStart) return current
    if (runStart && currentStart && runStart !== currentStart) {
      return runStart > currentStart ? run : current
    }
    return newestRun([current, run])
  }, null)
}

/**
 * Defensive legacy handling: the current partial unique index allows only one
 * published run per kind/scope, but selecting here keeps the loader correct if
 * it reads data created before that constraint existed.
 */
function latestPublishedRunsByScope(runs: ImportRunRow[]): ImportRunRow[] {
  const selected = new Map<string, ImportRunRow>()
  for (const run of runs) {
    const key = `${run.import_kind}\u0000${run.scope_key}`
    const current = selected.get(key)
    if (!current || newestRun([current, run]) === run) selected.set(key, run)
  }
  return Array.from(selected.values())
}

async function pagedSelect<T>(
  build: (from: number, to: number) => PromiseLike<{
    data: unknown
    error: { message?: string } | null
  }>,
  maxRows: number,
): Promise<QueryResult<T>> {
  const rows: T[] = []
  for (let from = 0; from < maxRows; from += PAGE_SIZE) {
    const { data, error } = await build(from, Math.min(from + PAGE_SIZE, maxRows) - 1)
    if (error) {
      return { rows: [], error: error.message?.slice(0, 200) ?? 'query_failed', truncated: false }
    }
    const page = Array.isArray(data) ? (data as T[]) : []
    rows.push(...page)
    if (page.length < PAGE_SIZE) {
      return { rows, error: null, truncated: false }
    }
  }
  return { rows, error: null, truncated: true }
}

function emptyOverview(companyName: string | null): StoreOverview {
  return {
    source: 'empty',
    confidence: 'empty',
    companyName,
    period: null,
    asOf: null,
    versionLabel: null,
    availability: { sales: false, inventory: false, prices: false },
    metrics: calculateSalesMetrics([]),
    catalog: { products: 0, activeProducts: 0, latest: [] },
    inventory: {
      availableUnits: null,
      reservedUnits: null,
      inventoryCost: null,
      inventoryRetail: null,
      warehouses: [],
    },
    channels: [],
    alerts: buildStoreAlerts({
      salesRows: [],
      inventoryRows: [],
      hasPublishedSales: false,
      hasPublishedInventory: false,
      hasPublishedPrices: false,
    }),
    limitations: ['Нет опубликованных данных магазина. Загрузите прайс, остатки или продажи.'],
  }
}

function operationalSalesFacts(
  rows: SalesRow[],
  warehouses: Map<string, WarehouseRow>,
): StoreSalesFact[] {
  return rows.flatMap((row) => {
    const quantity = number(row.quantity)
    const listAmount = number(row.list_amount)
    const netRevenue = number(row.net_revenue)
    const costAmount = number(row.cost_amount)
    const discountAmount = number(row.discount_amount)
    if (
      quantity === null
      || listAmount === null
      || netRevenue === null
      || costAmount === null
      || discountAmount === null
    ) return []
    return [{
      id: row.id,
      occurredOn: row.occurred_on,
      channel: row.channel,
      warehouseName: row.warehouse_id
        ? warehouses.get(row.warehouse_id)?.name ?? null
        : null,
      productName: row.name_snapshot,
      sku: row.sku_snapshot,
      quantity,
      listAmount,
      netRevenue,
      costAmount,
      discountAmount,
    }]
  })
}

export function buildMyHonorSalesFacts(
  orders: EcommerceOrderRow[],
  items: EcommerceOrderItemRow[],
): StoreSalesFact[] {
  const itemsByOrder = new Map<string, EcommerceOrderItemRow[]>()
  for (const item of items) {
    const current = itemsByOrder.get(item.order_id) ?? []
    current.push(item)
    itemsByOrder.set(item.order_id, current)
  }

  const result: StoreSalesFact[] = []
  for (const order of orders) {
    if (
      EXCLUDED_ORDER_STATUSES.has(order.status.trim().toLowerCase())
      || order.currency.toUpperCase() !== 'KZT'
    ) continue
    const gross = number(order.gross_amount)
    const orderDiscount = number(order.discount_amount)
    const refund = number(order.refund_amount)
    const netPaid = number(order.net_paid_amount)
    const occurredOn = validIso(order.paid_at ?? order.placed_at)
    if (
      gross === null
      || orderDiscount === null
      || refund === null
      || netPaid === null
      || netPaid <= 0
      || !occurredOn
    ) continue
    const merchandiseNet = gross - orderDiscount - refund
    if (merchandiseNet <= 0) continue

    const orderItems = itemsByOrder.get(order.id) ?? []
    const totalLineValue = orderItems.reduce(
      (sum, item) => sum + Math.max(0, number(item.line_total) ?? 0),
      0,
    )
    if (orderItems.length === 0 || totalLineValue <= 0) {
      result.push({
        id: `myhonor:${order.id}`,
        occurredOn,
        channel: 'MyHonor.shop',
        warehouseName: null,
        productName: `Заказ ${order.order_number}`,
        sku: null,
        quantity: 1,
        listAmount: gross,
        netRevenue: merchandiseNet,
        costAmount: null,
        discountAmount: gross - merchandiseNet,
      })
      continue
    }

    let allocatedSoFar = 0
    orderItems.forEach((item, index) => {
      const lineTotal = Math.max(0, number(item.line_total) ?? 0)
      const share = lineTotal / totalLineValue
      const allocatedNet = index === orderItems.length - 1
        ? merchandiseNet - allocatedSoFar
        : Math.round(merchandiseNet * share * 100) / 100
      allocatedSoFar += allocatedNet
      result.push({
        id: `myhonor:${order.id}:${item.id}`,
        occurredOn,
        channel: 'MyHonor.shop',
        warehouseName: null,
        productName: item.name,
        sku: item.sku,
        quantity: number(item.quantity) ?? 0,
        listAmount: lineTotal,
        netRevenue: allocatedNet,
        costAmount: null,
        discountAmount: lineTotal - allocatedNet,
      })
    })
  }
  return result
}

export async function loadStoreOverview(
  supabase: SupabaseClient,
  userId: string,
): Promise<StoreOverview> {
  const [companyResult, runResult, ecommerceProducts, ecommerceOrders, ecommerceItems] = await Promise.all([
    supabase
      .from('companies')
      .select('id,name')
      .eq('user_id', userId)
      .limit(1)
      .maybeSingle(),
    supabase
      .from('store_import_runs')
      .select('id,company_id,import_kind,scope_key,period_start,period_end,row_count,published_at')
      .eq('user_id', userId)
      .eq('status', 'published')
      .order('published_at', { ascending: false })
      .limit(MAX_REFERENCE_ROWS),
    pagedSelect<EcommerceProductRow>((from, to) => supabase
      .from('ecommerce_products')
      .select('id,sku,name,price,availability,image_url,catalog_active,catalog_synced_at')
      .eq('user_id', userId)
      .eq('source', MYHONOR_SOURCE)
      .order('name', { ascending: true })
      .range(from, to), MAX_REFERENCE_ROWS),
    pagedSelect<EcommerceOrderRow>((from, to) => supabase
      .from('ecommerce_orders')
      .select('id,order_number,status,placed_at,paid_at,currency,gross_amount,discount_amount,refund_amount,net_paid_amount,synced_at')
      .eq('user_id', userId)
      .eq('source', MYHONOR_SOURCE)
      .order('placed_at', { ascending: true })
      .range(from, to), MAX_FACT_ROWS),
    pagedSelect<EcommerceOrderItemRow>((from, to) => supabase
      .from('ecommerce_order_items')
      .select('id,order_id,sku,name,quantity,line_total')
      .eq('user_id', userId)
      .eq('source', MYHONOR_SOURCE)
      .order('order_id', { ascending: true })
      .range(from, to), MAX_FACT_ROWS),
  ])

  const company = companyResult.data as { id?: unknown; name?: unknown } | null
  const companyId = typeof company?.id === 'string' ? company.id : null
  const companyName = typeof company?.name === 'string' ? company.name : null
  const fallback = emptyOverview(companyName)
  const runs = !runResult.error && Array.isArray(runResult.data) && companyId
    ? (runResult.data as ImportRunRow[]).filter((run) => run.company_id === companyId)
    : []
  const currentRuns = latestPublishedRunsByScope(runs)
  const inventoryRuns = currentRuns.filter((run) => run.import_kind === 'inventory')
  // Monthly sales scopes are independent. Show the latest factual month even
  // when an older month was corrected more recently.
  const salesRun = latestSalesPeriodRun(
    currentRuns.filter((run) => run.import_kind === 'sales'),
  )
  // Price publication owns one global scope; ignore any malformed/non-global
  // legacy scope instead of blending incompatible price versions.
  const priceRun = newestRun(currentRuns.filter(
    (run) => run.import_kind === 'prices' && run.scope_key === 'global',
  ))
  const operationalCompanyId = salesRun?.company_id
    ?? inventoryRuns[0]?.company_id
    ?? priceRun?.company_id
    ?? null

  let salesRows: SalesRow[] = []
  let inventoryRows: InventoryRow[] = []
  let priceRows: PriceRow[] = []
  let variants: VariantRow[] = []
  let warehouses: WarehouseRow[] = []
  let operationalQueryFailed = false
  let operationalTruncated = false

  if (operationalCompanyId) {
    const [variantResult, warehouseResult, salesResult, inventoryResult, priceResult] = await Promise.all([
      pagedSelect<VariantRow>((from, to) => supabase
        .from('store_product_variants')
        .select('id,sku,name,is_active')
        .eq('user_id', userId)
        .eq('company_id', operationalCompanyId)
        .order('name', { ascending: true })
        .range(from, to), MAX_REFERENCE_ROWS),
      pagedSelect<WarehouseRow>((from, to) => supabase
        .from('store_warehouses')
        .select('id,name')
        .eq('user_id', userId)
        .eq('company_id', operationalCompanyId)
        .order('name', { ascending: true })
        .range(from, to), MAX_REFERENCE_ROWS),
      salesRun
        ? pagedSelect<SalesRow>((from, to) => supabase
            .from('store_sales_lines')
            .select('id,external_line_id,variant_id,warehouse_id,sku_snapshot,name_snapshot,channel,occurred_on,quantity,list_amount,net_revenue,cost_amount,discount_amount')
            .eq('user_id', userId)
            .eq('import_run_id', salesRun.id)
            .order('occurred_on', { ascending: true })
            .order('id', { ascending: true })
            .range(from, to), MAX_FACT_ROWS)
        : Promise.resolve({ rows: [], error: null, truncated: false }),
      inventoryRuns.length > 0
        ? pagedSelect<InventoryRow>((from, to) => supabase
            .from('store_inventory_snapshots')
            .select('variant_id,warehouse_id,snapshot_date,quantity_available,quantity_reserved')
            .eq('user_id', userId)
            .in('import_run_id', inventoryRuns.map((run) => run.id))
            .order('id', { ascending: true })
            .range(from, to), MAX_FACT_ROWS)
        : Promise.resolve({ rows: [], error: null, truncated: false }),
      priceRun
        ? pagedSelect<PriceRow>((from, to) => supabase
            .from('store_price_snapshots')
            .select('variant_id,purchase_price,retail_price')
            .eq('user_id', userId)
            .eq('import_run_id', priceRun.id)
            .order('id', { ascending: true })
            .range(from, to), MAX_REFERENCE_ROWS)
        : Promise.resolve({ rows: [], error: null, truncated: false }),
    ])
    operationalQueryFailed = [variantResult, warehouseResult, salesResult, inventoryResult, priceResult]
      .some((result) => Boolean(result.error))
    operationalTruncated = [variantResult, warehouseResult, salesResult, inventoryResult, priceResult]
      .some((result) => result.truncated)
    if (!operationalQueryFailed) {
      variants = variantResult.rows
      warehouses = warehouseResult.rows
      salesRows = salesResult.rows
      inventoryRows = inventoryResult.rows
      priceRows = priceResult.rows
    }
  }

  const warehouseMap = new Map(warehouses.map((row) => [row.id, row]))
  const variantMap = new Map(variants.map((row) => [row.id, row]))
  const priceMap = new Map(priceRows.map((row) => [row.variant_id, row]))
  // A published operational period is authoritative even when it contains no
  // transactions. Falling back to overlapping MyHonor orders would double
  // count or contradict an intentionally empty report.
  const hasOperationalSales = Boolean(salesRun && !operationalQueryFailed)
  const operationalSales = hasOperationalSales
    ? operationalSalesFacts(salesRows, warehouseMap)
    : []
  const myHonorFacts = !hasOperationalSales && !ecommerceOrders.error && !ecommerceItems.error
    ? buildMyHonorSalesFacts(ecommerceOrders.rows, ecommerceItems.rows)
    : []
  const selectedSales = hasOperationalSales ? operationalSales : myHonorFacts

  const inventoryFacts: StoreInventoryFact[] = inventoryRows.flatMap((row) => {
    const variant = variantMap.get(row.variant_id)
    const warehouse = warehouseMap.get(row.warehouse_id)
    const quantityAvailable = number(row.quantity_available)
    const quantityReserved = number(row.quantity_reserved)
    if (!variant || !warehouse || quantityAvailable === null || quantityReserved === null) return []
    const price = priceMap.get(row.variant_id)
    return [{
      variantId: variant.id,
      productName: variant.name,
      sku: variant.sku,
      warehouseName: warehouse.name,
      snapshotDate: row.snapshot_date,
      quantityAvailable,
      quantityReserved,
      purchasePrice: number(price?.purchase_price),
      retailPrice: number(price?.retail_price),
    }]
  })
  const warehouseSummaries = summarizeWarehouses(inventoryFacts)

  const operationalCatalog: StoreCatalogFact[] = variants.map((variant) => ({
    id: variant.id,
    sku: variant.sku,
    name: variant.name,
    price: number(priceMap.get(variant.id)?.retail_price),
    availability: inventoryFacts.some(
      (fact) => fact.variantId === variant.id && fact.quantityAvailable > 0,
    ) ? 'in_stock' : 'unknown',
    imageUrl: null,
    active: variant.is_active,
  }))
  const myHonorCatalog: StoreCatalogFact[] = ecommerceProducts.error ? [] : ecommerceProducts.rows.map((product) => ({
    id: product.id,
    sku: product.sku,
    name: product.name,
    price: number(product.price),
    availability: product.availability,
    imageUrl: product.image_url,
    active: product.catalog_active,
  }))
  const catalog = operationalCatalog.length > 0 ? operationalCatalog : myHonorCatalog

  const hasSales = hasOperationalSales || selectedSales.length > 0
  const hasInventory = inventoryRuns.length > 0 && inventoryFacts.length > 0
  const hasPrices = Boolean(priceRun && priceRows.length > 0)
  const hasAnyData = hasSales || hasInventory || hasPrices || catalog.length > 0
  if (!hasAnyData) return fallback

  const source = hasOperationalSales || hasInventory || hasPrices ? 'operational' : 'myhonor'
  const confidence = hasOperationalSales && hasInventory && hasPrices ? 'complete' : 'partial'
  const periodDates = selectedSales.map((row) => row.occurredOn).sort()
  const period = salesRun?.period_start && salesRun.period_end
    ? { from: salesRun.period_start, to: salesRun.period_end }
    : periodDates.length > 0
      ? { from: periodDates[0].slice(0, 10), to: periodDates.at(-1)!.slice(0, 10) }
      : null
  const inventoryCostValues = warehouseSummaries.map((row) => row.inventoryCost)
  const inventoryRetailValues = warehouseSummaries.map((row) => row.inventoryRetail)
  const inventoryCost = hasInventory && inventoryCostValues.every((value) => value !== null)
    ? inventoryCostValues.reduce<number>((sum, value) => sum + (value ?? 0), 0)
    : null
  const inventoryRetail = hasInventory && inventoryRetailValues.every((value) => value !== null)
    ? inventoryRetailValues.reduce<number>((sum, value) => sum + (value ?? 0), 0)
    : null
  const asOf = latest([
    salesRun?.published_at,
    ...inventoryRuns.map((run) => run.published_at),
    priceRun?.published_at,
    ...ecommerceProducts.rows.map((row) => row.catalog_synced_at),
    ...ecommerceOrders.rows.map((row) => row.synced_at),
  ])
  const limitations: string[] = []
  if (!hasOperationalSales && myHonorFacts.length > 0) {
    limitations.push('Продажи показаны по MyHonor без исторической себестоимости; прибыль и маржа пока недоступны.')
  }
  if (!hasInventory) limitations.push('Нет опубликованного снимка остатков по складам.')
  if (!hasPrices) limitations.push('Нет опубликованного прайса с закупочными и канальными ценами.')
  if (runResult.error || operationalQueryFailed) {
    limitations.push('Операционные данные временно недоступны; показан безопасный доступный источник.')
  }
  if (
    operationalTruncated
    || ecommerceProducts.truncated
    || ecommerceOrders.truncated
    || ecommerceItems.truncated
  ) {
    limitations.push('Объём данных превысил безопасный лимит обзора; итог требует пакетной агрегации.')
  }

  return {
    source,
    confidence,
    companyName,
    period,
    asOf,
    versionLabel: hasOperationalSales && salesRun
      ? `Продажи · ${new Date(salesRun.published_at).toLocaleDateString('ru-RU')}`
      : myHonorFacts.length > 0 ? 'MyHonor · live' : null,
    availability: { sales: hasSales, inventory: hasInventory, prices: hasPrices },
    metrics: calculateSalesMetrics(selectedSales),
    catalog: {
      products: catalog.length,
      activeProducts: catalog.filter((product) => product.active).length,
      latest: catalog.filter((product) => product.active).slice(0, 8),
    },
    inventory: {
      availableUnits: hasInventory
        ? warehouseSummaries.reduce((sum, row) => sum + row.available, 0)
        : null,
      reservedUnits: hasInventory
        ? warehouseSummaries.reduce((sum, row) => sum + row.reserved, 0)
        : null,
      inventoryCost,
      inventoryRetail,
      warehouses: warehouseSummaries,
    },
    channels: summarizeChannels(selectedSales),
    alerts: buildStoreAlerts({
      salesRows: selectedSales,
      inventoryRows: inventoryFacts,
      hasPublishedSales: hasOperationalSales,
      hasPublishedInventory: hasInventory,
      hasPublishedPrices: hasPrices,
    }),
    limitations,
  }
}
