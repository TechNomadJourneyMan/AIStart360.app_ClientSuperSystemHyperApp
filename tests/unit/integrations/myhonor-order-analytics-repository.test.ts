import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  myHonorOrderAnalyticsSchema,
  normalizeMyHonorOrderAnalytics,
} from '@/lib/integrations/myhonor/order-analytics'
import { ingestMyHonorOrderAnalytics } from '@/lib/integrations/myhonor/order-analytics-repository'

function analytics() {
  return normalizeMyHonorOrderAnalytics(myHonorOrderAnalyticsSchema.parse({
    schema_version: 1,
    event_id: 'myhonor/order/84/version/1',
    occurred_at: '2026-07-29T08:05:00Z',
    status_version: 1,
    order: {
      external_id: '84',
      order_number: 'MH-0084',
      status: 'paid',
      placed_at: '2026-07-29T08:00:00Z',
      paid_at: '2026-07-29T08:04:00Z',
      cancelled_at: null,
      updated_at: '2026-07-29T08:04:00Z',
      currency: 'KZT',
      gross_amount: 10_000,
      discount_amount: 0,
      shipping_amount: 0,
      refund_amount: 0,
      net_paid_amount: 10_000,
      customer_key: 'b'.repeat(64),
      items: [{
        external_line_id: 'line-1',
        product_external_id: `myhonor:${'a'.repeat(64)}`,
        sku: 'HONOR-X8',
        name: 'HONOR X8',
        quantity: 1,
        unit_price: 10_000,
        line_total: 10_000,
      }],
    },
  }))
}

describe('MyHonor analytics repository', () => {
  it('passes only the configured binding and normalized facts to the atomic RPC', async () => {
    const maybeSingle = vi.fn().mockResolvedValue({
      data: {
        order_id: '00000000-0000-4000-8000-000000000084',
        event_result: 'applied',
        original_result: 'applied',
        stored_status_version: 1,
        created: true,
        applied: true,
        conflict: false,
      },
      error: null,
    })
    const rpc = vi.fn().mockReturnValue({ maybeSingle })
    const client = { rpc } as unknown as SupabaseClient

    await expect(ingestMyHonorOrderAnalytics({
      analytics: analytics(),
      binding: {
        userId: '00000000-0000-4000-8000-000000000001',
        companyId: 'myhonor-company',
      },
    }, client)).resolves.toEqual({
      orderId: '00000000-0000-4000-8000-000000000084',
      result: 'applied',
      originalResult: 'applied',
      storedStatusVersion: 1,
      created: true,
      applied: true,
      conflict: false,
    })

    expect(rpc).toHaveBeenCalledOnce()
    expect(rpc).toHaveBeenCalledWith(
      'ingest_myhonor_ecommerce_order',
      expect.objectContaining({
        p_user_id: '00000000-0000-4000-8000-000000000001',
        p_company_id: 'myhonor-company',
        p_event_id: 'myhonor/order/84/version/1',
        p_status_version: 1,
        p_event_hash: expect.stringMatching(/^[a-f0-9]{64}$/),
        p_order_hash: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    )
    const parameters = rpc.mock.calls[0][1] as Record<string, unknown>
    expect(parameters.p_order).not.toHaveProperty('items')
    expect(parameters.p_items).toHaveLength(1)
  })

  it('fails closed on malformed database responses', async () => {
    const client = {
      rpc: vi.fn().mockReturnValue({
        maybeSingle: vi.fn().mockResolvedValue({
          data: {
            order_id: 'not-a-uuid',
            event_result: 'applied',
            original_result: 'applied',
            stored_status_version: 1,
            created: true,
            applied: true,
            conflict: false,
          },
          error: null,
        }),
      }),
    } as unknown as SupabaseClient

    await expect(ingestMyHonorOrderAnalytics({
      analytics: analytics(),
      binding: {
        userId: '00000000-0000-4000-8000-000000000001',
        companyId: 'myhonor-company',
      },
    }, client)).rejects.toThrow('invalid order_id')
  })
})
