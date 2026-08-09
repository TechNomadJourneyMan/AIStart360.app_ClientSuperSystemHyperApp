import { describe, expect, it } from 'vitest'
import {
  buildEcommerceAnalytics,
  buildOrderMetricSummaries,
} from '@/lib/point-a/v3/ecommerce-orders-loader'

const baseOrder = {
  id: 'order-db-1',
  external_id: 'order-1',
  status: 'paid',
  placed_at: '2026-07-10T10:00:00.000Z',
  paid_at: '2026-07-10T10:01:00.000Z',
  currency: 'KZT',
  net_paid_amount: 900,
  customer_hash: 'customer-a',
  synced_at: '2026-07-10T10:02:00.000Z',
}

describe('buildEcommerceAnalytics', () => {
  it('uses one order row and allocates product revenue proportionally', () => {
    const result = buildEcommerceAnalytics(
      [baseOrder],
      [
        {
          order_id: 'order-db-1',
          product_external_id: 'p1',
          sku: 'SKU-1',
          name: 'Куртка',
          quantity: 1,
          line_total: 600,
        },
        {
          order_id: 'order-db-1',
          product_external_id: 'p2',
          sku: 'SKU-2',
          name: 'Брюки',
          quantity: 1,
          line_total: 400,
        },
      ],
      { productId: 'p1' },
    )

    expect(result.allSalesRows).toHaveLength(1)
    expect(result.allSalesRows[0]).toMatchObject({
      sale_id: 'ecommerce:myhonor.shop:order-1',
      amount: 900,
      client_id: 'customer-a',
    })
    expect(result.selectedSalesRows).toHaveLength(1)
    expect(result.selectedSalesRows[0]).toMatchObject({
      product_id: 'p1',
      amount: 540,
    })
  })

  it('excludes unpaid, cancelled, foreign-currency and zero-net orders', () => {
    const result = buildEcommerceAnalytics(
      [
        { ...baseOrder, id: 'ok', external_id: 'ok' },
        { ...baseOrder, id: 'pending', external_id: 'pending', status: 'pending' },
        { ...baseOrder, id: 'cancelled', external_id: 'cancelled', status: 'cancelled' },
        { ...baseOrder, id: 'usd', external_id: 'usd', currency: 'USD' },
        { ...baseOrder, id: 'refunded', external_id: 'refunded', net_paid_amount: 0 },
      ],
      [],
    )

    expect(result.allSalesRows.map((row) => row.sale_id)).toEqual([
      'ecommerce:myhonor.shop:ok',
    ])
  })

  it('builds a pseudonymous client base from durable order history', () => {
    const result = buildEcommerceAnalytics(
      [
        baseOrder,
        {
          ...baseOrder,
          id: 'order-db-2',
          external_id: 'order-2',
          paid_at: '2026-07-20T10:01:00.000Z',
          net_paid_amount: '1100',
          synced_at: '2026-07-20T10:02:00.000Z',
        },
      ],
      [],
    )

    expect(result.clientBase).toMatchObject({
      has_client_base: true,
      source_document_ids: ['external:myhonor:orders'],
    })
    expect(result.clientBase.rows).toEqual([
      expect.objectContaining({
        client_id: 'customer-a',
        total_spent_kzt: 2000,
        purchase_count: 2,
        first_purchase_date: '2026-07-10T10:01:00.000Z',
        last_purchase_date: '2026-07-20T10:01:00.000Z',
      }),
    ])
  })

  it('surfaces product ids with readable names for dashboard filters', () => {
    const result = buildEcommerceAnalytics(
      [baseOrder],
      [
        {
          order_id: 'order-db-1',
          product_external_id: '2036',
          sku: '2036-BLUE-M',
          name: 'Костюм Barracuda',
          quantity: 1,
          line_total: 900,
        },
      ],
    )

    expect(result.products).toEqual([
      { id: '2036', name: 'Костюм Barracuda' },
    ])
  })
})

describe('buildOrderMetricSummaries', () => {
  it('derives real current-period revenue, customers and AOV with trends', () => {
    const metrics = buildOrderMetricSummaries(
      [
        {
          sale_id: 'previous',
          client_id: 'c0',
          amount: 5_000,
          occurred_at: '2026-06-20T00:00:00.000Z',
        },
        {
          sale_id: 'current-1',
          client_id: 'c1',
          amount: 10_000,
          occurred_at: '2026-07-10T00:00:00.000Z',
        },
        {
          sale_id: 'current-2',
          client_id: 'c2',
          amount: 5_000,
          occurred_at: '2026-07-20T00:00:00.000Z',
        },
      ],
      'month',
      new Date('2026-07-29T00:00:00.000Z'),
    )

    expect(metrics.map((metric) => metric.id)).toEqual([
      'revenue',
      'clients',
      'avg_check',
    ])
    expect(metrics[0]).toMatchObject({
      rawValue: 15_000,
      displayValue: '₸15К',
      trend: 200,
      trendDirection: 'up',
    })
    expect(metrics[1].rawValue).toBe(2)
    expect(metrics[2].rawValue).toBe(7_500)
  })

  it('returns an honest empty list when the selected period has no orders', () => {
    const metrics = buildOrderMetricSummaries(
      [
        {
          sale_id: 'old',
          client_id: 'c1',
          amount: 1_000,
          occurred_at: '2025-01-01T00:00:00.000Z',
        },
      ],
      'month',
      new Date('2026-07-29T00:00:00.000Z'),
    )
    expect(metrics).toEqual([])
  })

  it('uses a complete rolling seven-day window for week metrics', () => {
    const metrics = buildOrderMetricSummaries(
      [{
        sale_id: 'six-and-a-half-days-old',
        client_id: 'c1',
        amount: 1_000,
        occurred_at: '2026-07-22T12:00:00.000Z',
      }],
      'week',
      new Date('2026-07-29T00:00:00.000Z'),
    )

    expect(metrics[0]).toMatchObject({ id: 'revenue', rawValue: 1_000 })
  })
})
