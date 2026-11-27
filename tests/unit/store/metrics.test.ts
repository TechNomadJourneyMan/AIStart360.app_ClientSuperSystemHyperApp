import { describe, expect, it } from 'vitest'
import {
  calculateSalesMetrics,
  summarizeChannels,
  summarizeWarehouses,
} from '@/lib/store/metrics'
import type { StoreInventoryFact, StoreSalesFact } from '@/lib/store/types'

const baseFact: StoreSalesFact = {
  id: 'sale-1',
  occurredOn: '2026-07-10',
  channel: 'Астана · магазин',
  warehouseName: 'Астана',
  productName: 'Костюм HONOR IV',
  sku: 'HONOR-IV-L',
  quantity: 1,
  listAmount: 100_000,
  netRevenue: 60_000,
  costAmount: 40_000,
  discountAmount: 40_000,
}

describe('store sales metrics', () => {
  it('reconciles the synthetic July totals including signed returns', () => {
    const rows: StoreSalesFact[] = [
      {
        ...baseFact,
        id: 'gross-sales',
        quantity: 30,
        listAmount: 210000,
        netRevenue: 150000,
        costAmount: 95000,
        discountAmount: 60000,
      },
      {
        ...baseFact,
        id: 'returns',
        quantity: -2,
        listAmount: -10000,
        netRevenue: -10000,
        costAmount: -4999.54,
        discountAmount: -0,
      },
    ]

    expect(calculateSalesMetrics(rows)).toEqual({
      revenue: 140000,
      cost: 90000.46,
      grossProfit: 49999.54,
      grossMarginPct: 35.71,
      listRevenue: 200000,
      discount: 60000,
      discountRatePct: 30,
      units: 28,
      returns: 2,
    })
  })

  it('returns honest nulls when no sales facts exist', () => {
    expect(calculateSalesMetrics([])).toEqual({
      revenue: null,
      cost: null,
      grossProfit: null,
      grossMarginPct: null,
      listRevenue: null,
      discount: null,
      discountRatePct: null,
      units: null,
      returns: null,
    })
  })

  it('does not invent profit when one source row has no cost', () => {
    const result = calculateSalesMetrics([{ ...baseFact, costAmount: null }])
    expect(result.revenue).toBe(60_000)
    expect(result.cost).toBeNull()
    expect(result.grossProfit).toBeNull()
    expect(result.grossMarginPct).toBeNull()
  })

  it('keeps channel sums reconciled with the grand total', () => {
    const rows = [
      baseFact,
      { ...baseFact, id: 'sale-2', channel: 'Kaspi', netRevenue: 30_000, listAmount: 50_000, costAmount: 20_000, discountAmount: 20_000 },
    ]
    const channels = summarizeChannels(rows)
    expect(channels.map((row) => row.channel)).toEqual(['Астана · магазин', 'Kaspi'])
    expect(channels.reduce((sum, row) => sum + (row.revenue ?? 0), 0)).toBe(
      calculateSalesMetrics(rows).revenue,
    )
  })
})

describe('store inventory metrics', () => {
  it('values each warehouse from its matching price and reports freshness', () => {
    const facts: StoreInventoryFact[] = [
      {
        variantId: 'v1',
        productName: 'Костюм',
        sku: 'V1',
        warehouseName: 'Астана',
        snapshotDate: '2026-08-08',
        quantityAvailable: 3,
        quantityReserved: 1,
        purchasePrice: 10_000,
        retailPrice: 20_000,
      },
      {
        variantId: 'v2',
        productName: 'Куртка',
        sku: 'V2',
        warehouseName: 'Астана',
        snapshotDate: '2026-08-09',
        quantityAvailable: 2,
        quantityReserved: 0,
        purchasePrice: 5_000,
        retailPrice: 12_000,
      },
    ]
    expect(summarizeWarehouses(facts)).toEqual([{
      warehouse: 'Астана',
      available: 5,
      reserved: 1,
      inventoryCost: 40_000,
      inventoryRetail: 84_000,
      snapshotDate: '2026-08-09',
    }])
  })

  it('does not present a partial valuation as complete', () => {
    const facts: StoreInventoryFact[] = [
      {
        variantId: 'v1',
        productName: 'Костюм',
        sku: 'V1',
        warehouseName: 'Склад',
        snapshotDate: '2026-08-08',
        quantityAvailable: 3,
        quantityReserved: 0,
        purchasePrice: null,
        retailPrice: 20_000,
      },
    ]
    expect(summarizeWarehouses(facts)[0]).toMatchObject({
      inventoryCost: null,
      inventoryRetail: 60_000,
    })
  })
})
