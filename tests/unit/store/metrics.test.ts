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
  it('reconciles the July golden totals including signed returns', () => {
    const rows: StoreSalesFact[] = [
      {
        ...baseFact,
        id: 'gross-sales',
        quantity: 1_333,
        listAmount: 42_200_000,
        netRevenue: 28_130_000,
        costAmount: 17_190_000,
        discountAmount: 14_070_000,
      },
      {
        ...baseFact,
        id: 'returns',
        quantity: -9,
        listAmount: -117_380,
        netRevenue: -76_747,
        costAmount: -50_025.54,
        discountAmount: -40_633,
      },
    ]

    expect(calculateSalesMetrics(rows)).toEqual({
      revenue: 28_053_253,
      cost: 17_139_974.46,
      grossProfit: 10_913_278.54,
      grossMarginPct: 38.9,
      listRevenue: 42_082_620,
      discount: 14_029_367,
      discountRatePct: 33.34,
      units: 1_324,
      returns: 9,
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
