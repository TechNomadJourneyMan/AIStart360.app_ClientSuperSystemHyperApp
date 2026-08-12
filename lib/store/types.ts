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
}
