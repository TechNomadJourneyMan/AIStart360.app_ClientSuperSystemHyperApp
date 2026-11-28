import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { createMyHonorAnalyticsSignature } from '@/lib/integrations/myhonor/order-analytics'

const dependencies = vi.hoisted(() => ({
  ingest: vi.fn(),
}))

vi.mock(
  '@/lib/integrations/myhonor/order-analytics-repository',
  async (original) => {
    const actual = await original<
      typeof import('@/lib/integrations/myhonor/order-analytics-repository')
    >()
    return { ...actual, ingestMyHonorOrderAnalytics: dependencies.ingest }
  },
)

import { POST } from '@/app/api/v1/integrations/myhonor/orders/route'

const endpoint =
  'https://portal.example.kz/api/v1/integrations/myhonor/orders'
const secret = 'myhonor-analytics-secret-with-at-least-32-bytes'
const userId = '00000000-0000-4000-8000-000000000084'
const companyId = 'myhonor-company'

function payload(overrides: Record<string, unknown> = {}) {
  return {
    schema_version: 1,
    event_id: 'myhonor/order/84/version/2',
    occurred_at: '2026-07-29T08:05:00Z',
    status_version: 2,
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
      customer_key: 'c'.repeat(64),
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
    ...overrides,
  }
}

function request(input: {
  payload?: unknown
  signature?: string
  timestampSeconds?: number
  contentType?: string
  contentLength?: string
} = {}): NextRequest {
  const rawBody = Buffer.from(
    JSON.stringify(input.payload ?? payload()),
    'utf8',
  )
  const timestampSeconds =
    input.timestampSeconds ?? Math.floor(Date.now() / 1_000)
  const signature =
    input.signature
    ?? createMyHonorAnalyticsSignature(rawBody, timestampSeconds, secret)
  return new NextRequest(endpoint, {
    method: 'POST',
    headers: {
      'content-type': input.contentType ?? 'application/json',
      'x-aistart-timestamp': String(timestampSeconds),
      'x-aistart-signature': signature,
      ...(input.contentLength
        ? { 'content-length': input.contentLength }
        : {}),
    },
    body: rawBody,
  })
}

describe('POST /api/v1/integrations/myhonor/orders', () => {
  beforeEach(() => {
    vi.unstubAllEnvs()
    vi.resetAllMocks()
    vi.stubEnv('MYHONOR_ANALYTICS_WEBHOOK_SECRET', secret)
    vi.stubEnv('MYHONOR_ANALYTICS_USER_ID', userId)
    vi.stubEnv('MYHONOR_ANALYTICS_COMPANY_ID', companyId)
    dependencies.ingest.mockResolvedValue({
      orderId: '00000000-0000-4000-8000-000000000001',
      result: 'applied',
      originalResult: 'applied',
      storedStatusVersion: 2,
      created: true,
      applied: true,
      conflict: false,
    })
  })

  it('fails closed when the independent webhook secret is absent', async () => {
    vi.stubEnv('MYHONOR_ANALYTICS_WEBHOOK_SECRET', '')
    const response = await POST(request())
    expect(response.status).toBe(503)
    expect((await response.json()).error.code).toBe(
      'integration_not_configured',
    )
    expect(dependencies.ingest).not.toHaveBeenCalled()
  })

  it('verifies the raw body HMAC and timestamp replay window before parsing', async () => {
    const invalid = await POST(request({ signature: `sha256=${'0'.repeat(64)}` }))
    expect(invalid.status).toBe(401)
    expect((await invalid.json()).error.code).toBe('invalid_webhook_signature')

    const stale = await POST(request({
      timestampSeconds: Math.floor(Date.now() / 1_000) - 301,
    }))
    expect(stale.status).toBe(401)
    expect((await stale.json()).error.code).toBe('stale_webhook_timestamp')
    expect(dependencies.ingest).not.toHaveBeenCalled()
  })

  it('enforces bounded JSON and the strict no-identity contract', async () => {
    const tooLarge = await POST(request({ contentLength: '160001' }))
    expect(tooLarge.status).toBe(413)

    const withClientIdentity = payload({ user_id: userId })
    const invalid = await POST(request({ payload: withClientIdentity }))
    expect(invalid.status).toBe(422)
    expect((await invalid.json()).error.code).toBe('invalid_request')
    expect(dependencies.ingest).not.toHaveBeenCalled()
  })

  it('uses only the server binding and returns the atomic apply result', async () => {
    const response = await POST(request())
    expect(response.status).toBe(201)
    expect(await response.json()).toMatchObject({
      ok: true,
      event_id: 'myhonor/order/84/version/2',
      result: 'applied',
      applied: true,
      duplicate: false,
      ignored: false,
    })
    expect(dependencies.ingest).toHaveBeenCalledOnce()
    expect(dependencies.ingest).toHaveBeenCalledWith({
      analytics: expect.objectContaining({
        event_id: 'myhonor/order/84/version/2',
        status_version: 2,
      }),
      binding: { userId, companyId },
    })
  })

  it('returns 409 for a same-version or forbidden-transition conflict', async () => {
    dependencies.ingest.mockResolvedValue({
      orderId: '00000000-0000-4000-8000-000000000001',
      result: 'conflict',
      originalResult: 'conflict',
      storedStatusVersion: 2,
      created: false,
      applied: false,
      conflict: true,
    })
    const response = await POST(request())
    expect(response.status).toBe(409)
    expect((await response.json()).error).toMatchObject({
      code: 'order_version_conflict',
      retryable: false,
      details: { stored_status_version: 2 },
    })
  })

  it('acknowledges exact replays and stale versions without applying them', async () => {
    dependencies.ingest.mockResolvedValue({
      orderId: '00000000-0000-4000-8000-000000000001',
      result: 'duplicate',
      originalResult: 'out_of_order',
      storedStatusVersion: 4,
      created: false,
      applied: false,
      conflict: false,
    })
    const response = await POST(request())
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      result: 'duplicate',
      original_result: 'out_of_order',
      applied: false,
      duplicate: true,
      ignored: true,
    })
  })
})
