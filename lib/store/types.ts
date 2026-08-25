export type StoreDataSource = 'operational' | 'myhonor' | 'empty'
export type StoreConfidence = 'complete' | 'partial' | 'empty'

export interface StoreSalesFact {
  id: string
  occurredOn: string
  channel: string
  warehouseName: string | null
  productName: string
  sku: string | null
  quantity: number
  listAmount: number
  netRevenue: number
  costAmount: number | null
  discountAmount: number | null
}

export interface StoreInventoryFact {
  variantId: string
  productName: string
  sku: string
  warehouseName: string
  snapshotDate: string
  quantityAvailable: number
  quantityReserved: number
  purchasePrice: number | null
  retailPrice: number | null
}

export interface StoreCatalogFact {
  id: string
  sku: string
  name: string
  price: number | null
  availability: string
  imageUrl: string | null
  active: boolean
}

export interface StoreSalesMetrics {
  revenue: number | null
  cost: number | null
  grossProfit: number | null
  grossMarginPct: number | null
  listRevenue: number | null
  discount: number | null
  discountRatePct: number | null
  units: number | null
  returns: number | null
}

export type StoreAnalyticsCoverage =
  | 'complete'
  | 'partial'
  | 'not_covered'
  | 'stale'
  | 'unavailable'

export type StoreAnalyticsSource =
  | 'operational'
  | 'myhonor'
  | 'financial_report'
  | 'mixed'
  | 'none'

export type StoreAnalyticsWindowKey =
  | 'today'
  | 'monthToDate'
  | 'latestPublished'
  | 'yearToDate'
  | 'previousYear'

export interface StoreAnalyticsPeriod {
  from: string
  to: string
}

/**
 * One owner-scoped financial window. A null metric is deliberately different
 * from zero: without a published monthly scope or a completeness watermark the
 * dashboard must not claim that an unobserved period had no sales.
 */
export interface StoreAnalyticsSlice {
  key: StoreAnalyticsWindowKey | `month:${string}`
  period: StoreAnalyticsPeriod
  coverage: StoreAnalyticsCoverage
  source: StoreAnalyticsSource
  scopeKey: string | null
  scopeKeys: string[]
  lastFactAt: string | null
  publishedAt: string | null
  syncedAt: string | null
  metrics: StoreSalesMetrics
  message: string | null
}

export interface StoreAnalyticsMonth extends StoreAnalyticsSlice {
  key: `month:${string}`
  month: string
}

export interface StorePnlPeriod {
  month: string
  coverage: StoreAnalyticsCoverage
  source: 'financial_report' | 'sales_fallback'
  scopeKey: string | null
  sourceSheet: string | null
  publishedAt: string | null
  revenue: number | null
  costAmount: number | null
  grossProfit: number | null
  periodExpenses: number | null
  bonuses: number | null
  writeOffs: number | null
  ebitda: number | null
  note: string | null
}

export interface StoreDomainFreshness {
  coverage: StoreAnalyticsCoverage
  lastFactAt: string | null
  publishedAt: string | null
  syncedAt: string | null
}

export interface StoreAnalytics {
  schemaVersion: 2
  timezone: 'Asia/Almaty'
  generatedAt: string
  currentDate: string
  windows: Record<StoreAnalyticsWindowKey, StoreAnalyticsSlice>
  history: StoreAnalyticsMonth[]
  comparableYtd: {
    currentYear: number
    previousYear: number
    current: StoreAnalyticsSlice
    previous: StoreAnalyticsSlice
    revenueChangePct: number | null
    grossProfitChangePct: number | null
    comparable: boolean
    message: string | null
  }
  pnl: {
    coverage: StoreAnalyticsCoverage
    periods: StorePnlPeriod[]
    hasNegativeEbitda: boolean
    message: string | null
  }
  freshness: {
    sales: StoreDomainFreshness
    inventory: StoreDomainFreshness
    prices: StoreDomainFreshness
    catalog: StoreDomainFreshness
  }
  limitations: string[]
}

export interface StoreChannelSummary extends StoreSalesMetrics {
  channel: string
}

export interface StoreWarehouseSummary {
  warehouse: string
  available: number
  reserved: number
  inventoryCost: number | null
  inventoryRetail: number | null
  snapshotDate: string | null
}

export type StoreAlertLevel = 'critical' | 'warning' | 'info'

export interface StoreAlert {
  id: string
  level: StoreAlertLevel
  title: string
  description: string
  actionHref?: string
  actionLabel?: string
}

export interface StoreOverview {
  source: StoreDataSource
  confidence: StoreConfidence
  companyName: string | null
  period: { from: string; to: string } | null
  asOf: string | null
  versionLabel: string | null
  availability: {
    sales: boolean
    inventory: boolean
    prices: boolean
  }
  metrics: StoreSalesMetrics
  catalog: {
    products: number
    activeProducts: number
    latest: StoreCatalogFact[]
  }
  inventory: {
    availableUnits: number | null
    reservedUnits: number | null
    inventoryCost: number | null
    inventoryRetail: number | null
    warehouses: StoreWarehouseSummary[]
  }
  channels: StoreChannelSummary[]
  alerts: StoreAlert[]
  limitations: string[]
  /** Added in schema v2; optional so existing Journey projections stay valid. */
  analytics?: StoreAnalytics
}
