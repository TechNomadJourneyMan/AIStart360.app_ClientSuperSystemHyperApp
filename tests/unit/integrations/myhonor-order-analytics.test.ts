import { describe, expect, it } from 'vitest'
import {
  createMyHonorAnalyticsSignature,
  getMyHonorAnalyticsConfiguration,
  myHonorAnalyticsOrderHash,
  myHonorAnalyticsRequestHash,
  myHonorOrderAnalyticsSchema,
  normalizeMyHonorOrderAnalytics,
  verifyMyHonorAnalyticsSignature,
} from '@/lib/integrations/myhonor/order-analytics'

function payload(overrides: Record<string, unknown> = {}) {
  return {
    schema_version: 1,
    event_id: 'myhonor/order/MH-0084/version/6',
    occurred_at: '2026-07-29T08:05:00Z',
    status_version: 6,
    order: {
      external_id: '84',
      order_number: 'MH-0084',
      status: 'delivered',
      placed_at: '2026-07-28T08:00:00Z',
      paid_at: '2026-07-28T08:05:00Z',
      cancelled_at: null,
      updated_at: '2026-07-29T08:00:00Z',
      currency: 'KZT',
      gross_amount: 20_000,
      discount_amount: 1_000,
      shipping_amount: 500,
      refund_amount: 0,
      net_paid_amount: 19_500,
      customer_key: 'a'.repeat(64),
      items: [
        {
          external_line_id: 'line-1',
          product_external_id: `myhonor:${'a'.repeat(64)}`,
          sku: 'HONOR-X8-BLK',
          name: 'HONOR X8',
          quantity: 2,
          unit_price: 10_000,
          line_total: 20_000,
          product: {
            url: 'https://myhonor.shop/products/honor-x8',
            brand: 'HONOR',
            availability: 'in_stock',
          },
        },
      ],
    },
    ...overrides,
  }
}

describe('MyHonor order analytics contract', () => {
  it('accepts KZT order facts and creates stable canonical hashes', () => {
    const parsed = myHonorOrderAnalyticsSchema.parse(payload())
    const first = normalizeMyHonorOrderAnalytics(parsed)
    const second = normalizeMyHonorOrderAnalytics(
      myHonorOrderAnalyticsSchema.parse(JSON.parse(JSON.stringify(payload()))),
    )

    expect(first.order.customer_key).toBe('a'.repeat(64))
    expect(first.order.items[0].product).toMatchObject({
      brand: 'HONOR',
      availability: 'in_stock',
      image_url: null,
    })
    expect(first.order.items[0].product_source_hash).toMatch(/^[a-f0-9]{64}$/)
    expect(myHonorAnalyticsRequestHash(first)).toBe(
      myHonorAnalyticsRequestHash(second),
    )
    expect(myHonorAnalyticsOrderHash(first)).toBe(
      myHonorAnalyticsOrderHash(second),
    )
  })

  it('rejects raw PII and requires a stable salted customer pseudonym', () => {
    const withEmail = payload()
    ;(withEmail.order as Record<string, unknown>).customer_email =
      'buyer@example.com'
    expect(() => myHonorOrderAnalyticsSchema.parse(withEmail)).toThrow()

    const weakKey = payload()
    ;(weakKey.order as Record<string, unknown>).customer_key = '+77051234567'
    expect(() => myHonorOrderAnalyticsSchema.parse(weakKey)).toThrow()
  })

  it('checks item totals and cancellation/refund semantics', () => {
    const wrongLineTotal = payload()
    const order = wrongLineTotal.order as {
      items: Array<Record<string, unknown>>
    }
    order.items[0].line_total = 19_999
    expect(() => myHonorOrderAnalyticsSchema.parse(wrongLineTotal)).toThrow()

    const cancelledWithoutRefund = payload()
    Object.assign(cancelledWithoutRefund.order as Record<string, unknown>, {
      status: 'cancelled',
      cancelled_at: '2026-07-29T07:00:00Z',
      refund_amount: 0,
      net_paid_amount: 0,
    })
    expect(() =>
      myHonorOrderAnalyticsSchema.parse(cancelledWithoutRefund),
    ).toThrow()

    const fullyCancelled = payload()
    Object.assign(fullyCancelled.order as Record<string, unknown>, {
      status: 'cancelled',
      cancelled_at: '2026-07-29T07:00:00Z',
      refund_amount: 19_500,
      net_paid_amount: 0,
    })
    expect(() => myHonorOrderAnalyticsSchema.parse(fullyCancelled)).not.toThrow()
  })
})

describe('MyHonor analytics webhook authentication', () => {
  const secret = 'myhonor-analytics-secret-with-at-least-32-bytes'
  const timestampSeconds = 1_785_312_000
  const rawBody = Buffer.from('{"event_id":"exact-raw-body"}', 'utf8')

  it('authenticates the exact timestamp and raw bytes', () => {
    const signature = createMyHonorAnalyticsSignature(
      rawBody,
      timestampSeconds,
      secret,
    )
    expect(verifyMyHonorAnalyticsSignature({
      rawBody,
      timestampHeader: String(timestampSeconds),
      signatureHeader: signature,
      secret,
      nowMs: timestampSeconds * 1_000,
    })).toEqual({ ok: true, timestampSeconds })

    expect(verifyMyHonorAnalyticsSignature({
      rawBody: Buffer.from(`${rawBody.toString('utf8')} `),
      timestampHeader: String(timestampSeconds),
      signatureHeader: signature,
      secret,
      nowMs: timestampSeconds * 1_000,
    })).toEqual({ ok: false, reason: 'invalid_signature' })
  })

  it('rejects stale timestamps and malformed signatures', () => {
    expect(verifyMyHonorAnalyticsSignature({
      rawBody,
      timestampHeader: String(timestampSeconds),
      signatureHeader: 'sha256=not-hex',
      secret,
      nowMs: timestampSeconds * 1_000,
    })).toEqual({ ok: false, reason: 'invalid_signature' })

    expect(verifyMyHonorAnalyticsSignature({
      rawBody,
      timestampHeader: String(timestampSeconds),
      signatureHeader: createMyHonorAnalyticsSignature(
        rawBody,
        timestampSeconds,
        secret,
      ),
      secret,
      nowMs: (timestampSeconds + 301) * 1_000,
    })).toEqual({ ok: false, reason: 'stale_timestamp' })
  })

  it('requires an independent secret and a server-side owner binding', () => {
    const configuration = getMyHonorAnalyticsConfiguration({
      MYHONOR_ANALYTICS_WEBHOOK_SECRET: secret,
      MYHONOR_ANALYTICS_USER_ID: '00000000-0000-4000-8000-000000000084',
      MYHONOR_ANALYTICS_COMPANY_ID: 'myhonor-company',
    })
    expect(configuration.ready).toBe(true)
    expect(configuration.userId).toBe(
      '00000000-0000-4000-8000-000000000084',
    )
    expect(JSON.stringify(configuration)).not.toContain(secret)

    const unbound = getMyHonorAnalyticsConfiguration({
      MYHONOR_ANALYTICS_WEBHOOK_SECRET: secret,
    })
    expect(unbound.ready).toBe(false)
    expect(unbound.missing).toEqual(expect.arrayContaining([
      'MYHONOR_ANALYTICS_USER_ID',
      'MYHONOR_ANALYTICS_COMPANY_ID',
    ]))
  })
})
