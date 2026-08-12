import { describe, expect, it } from 'vitest'
import { buildMyHonorSalesFacts } from '@/lib/store/loader'
import { calculateSalesMetrics } from '@/lib/store/metrics'

const order = {
  id: 'order-1',
  order_number: 'MH-1',
  status: 'partially_refunded',
  placed_at: '2026-07-10T10:00:00.000Z',
  paid_at: '2026-07-10T10:01:00.000Z',
  currency: 'KZT',
  gross_amount: 1_000,
  discount_amount: 100,
  refund_amount: 100,
  net_paid_amount: 800,
  synced_at: '2026-07-10T10:02:00.000Z',
}

describe('MyHonor Store fallback', () => {
  it('allocates order discounts and refunds without inventing cost', () => {
    const facts = buildMyHonorSalesFacts(
      [order],
      [
        { id: 'line-1', order_id: 'order-1', sku: 'A', name: 'A', quantity: 1, line_total: 600 },
        { id: 'line-2', order_id: 'order-1', sku: 'B', name: 'B', quantity: 2, line_total: 400 },
      ],
    )
    expect(facts.map((fact) => fact.netRevenue)).toEqual([480, 320])
    expect(facts.map((fact) => fact.discountAmount)).toEqual([120, 80])
    expect(facts.every((fact) => fact.costAmount === null)).toBe(true)
    expect(calculateSalesMetrics(facts)).toMatchObject({
      revenue: 800,
      listRevenue: 1_000,
      discount: 200,
      cost: null,
      grossProfit: null,
      grossMarginPct: null,
    })
  })

  it('does not treat cancelled or fully refunded orders as revenue', () => {
    const facts = buildMyHonorSalesFacts(
      [
        { ...order, id: 'cancelled', status: 'cancelled' },
        { ...order, id: 'refunded', status: 'refunded' },
        { ...order, id: 'unpaid', status: 'confirmed', paid_at: null, net_paid_amount: 0 },
      ],
      [],
    )
    expect(facts).toEqual([])
  })
})
