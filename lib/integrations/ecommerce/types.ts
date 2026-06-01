// Common shape e-commerce integrations must return.
// Each adapter (Shopify, Bitrix, WB, Ozon, Kaspi, Uzum, GA4, Meta, Yandex)
// implements `fetchEcommerceData(creds)` returning a slice of EcommerceData.
// The dashboard merges slices from all adapters at /api/v1/ecommerce/snapshot.

export interface EcommerceCompany {
  name: string
  industry: string
  platform: string
}

export interface EcommerceKpi {
  current: number
  target: number
  trend: number   // % change vs previous period
}

export interface FunnelStage {
  stage: 'Visit' | 'Cart' | 'Checkout' | 'Paid' | string
  n: number
  conv: number    // 0..1 — conversion FROM previous stage
}

export interface ChannelRow {
  name: string
  revenue: number      // ₸
  cac: number          // ₸ per new customer (0 = free traffic)
  roas: number         // revenue / spend; Infinity for $0 spend
  share: number        // 0..100 — display only
}

export interface MarketplaceRow {
  name: string
  share: number        // % of total revenue
  rating: number       // 0..5
  buybox: number       // % of time in BuyBox
  payout: number       // % выкупа (orders not returned)
  badge: 'ok' | 'warn' | 'critical'
}

export interface SkuRow {
  name: string
  sales: number        // units / month
  margin: number       // %
  returns: number      // %
  status: 'live' | 'risk' | 'dead'
}

/** 5×5 RFM grid; rfm[recency_bucket][frequency_bucket] = customers count */
export type RfmGrid = readonly (readonly number[])[]

export interface CohortRow {
  month: string
  months: readonly number[]  // % retained at month-N from first purchase
}

export interface CartRecovery {
  abandoned: number
  recovered: number
  recoveredRev: number  // ₸
  rate: number          // %
  flows: Array<{
    name: string
    triggered: number
    opened: number
    recovered: number
  }>
}

export interface SeasonalityPoint {
  m: string             // month label "Янв"…"Дек"
  v: number             // 0..1 — normalised demand level
  label?: string        // optional event tag (BF, НГ, Ramadan)
}

export interface EcommerceData {
  company:      EcommerceCompany
  revenue:      EcommerceKpi
  aov:          EcommerceKpi
  ordersMo:     EcommerceKpi
  ltvCac:       EcommerceKpi
  funnel:       FunnelStage[]
  channels:     ChannelRow[]
  marketplaces: MarketplaceRow[]
  sku:          SkuRow[]
  rfm:          RfmGrid
  cohort:       CohortRow[]
  cartRecovery: CartRecovery
  seasonality:  SeasonalityPoint[]
  /** ISO timestamp — when this snapshot was assembled */
  generatedAt:  string
}

export type EcommercePartialData = Partial<Omit<EcommerceData, 'generatedAt'>>

/**
 * Adapter contract: every e-commerce integration exports `fetch` with this
 * signature. Adapters are free to throw on auth/transport errors — the
 * orchestrator catches and substitutes mock data so the dashboard always
 * renders.
 */
export interface EcommerceAdapter<Creds = unknown> {
  id: string
  label: string
  fetch: (creds: Creds, opts?: { since?: string }) => Promise<EcommercePartialData>
}
