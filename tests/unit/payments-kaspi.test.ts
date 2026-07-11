import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createCheckoutSession, isKaspiConfigured } from '@/lib/payments/providers/kaspi'
import type { CheckoutParams } from '@/lib/payments/types'

const PARAMS: CheckoutParams = {
  orgId: 'org-1',
  planKey: 'pro_monthly',
  amount: 30000, // $300.00 in minor units
  currency: 'USD',
  successUrl: '/checkout/success?plan=pro_monthly',
  cancelUrl: '/checkout/cancel',
  customerEmail: 'client@example.com',
}

const KASPI_ENV = [
  'KASPI_API_BASE',
  'KASPI_MERCHANT_ID',
  'KASPI_API_KEY',
  'KASPI_USD_KZT_RATE',
] as const

describe('kaspi acquiring provider', () => {
  const saved: Record<string, string | undefined> = {}

  beforeEach(() => {
    for (const k of KASPI_ENV) {
      saved[k] = process.env[k]
      delete process.env[k]
    }
  })

  afterEach(() => {
    for (const k of KASPI_ENV) {
      if (saved[k] === undefined) delete process.env[k]
      else process.env[k] = saved[k]
    }
    vi.restoreAllMocks()
  })

  it('degrades to the demo stub when env is not configured', async () => {
    expect(isKaspiConfigured()).toBe(false)
    const session = await createCheckoutSession(PARAMS)
    expect(session.status).toBe('stub')
    expect(session.checkoutUrl).toContain('/checkout/stub')
    expect(session.provider).toBe('kaspi')
  })

  it('rejects non-KZT plans when no conversion rate is set (no invented prices)', async () => {
    process.env.KASPI_API_BASE = 'https://kaspi.example'
    process.env.KASPI_MERCHANT_ID = 'm-1'
    process.env.KASPI_API_KEY = 'k-1'
    await expect(createCheckoutSession(PARAMS)).rejects.toThrow(/kaspi_kzt_only/)
  })

  it('creates a real pending session, converting USD → whole KZT (rounded up)', async () => {
    process.env.KASPI_API_BASE = 'https://kaspi.example'
    process.env.KASPI_MERCHANT_ID = 'm-1'
    process.env.KASPI_API_KEY = 'k-1'
    process.env.KASPI_USD_KZT_RATE = '525.5'

    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({ paymentId: 'pay_123', paymentUrl: 'https://kaspi.example/pay/123' }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    )

    const session = await createCheckoutSession(PARAMS)
    expect(session.status).toBe('pending')
    expect(session.sessionId).toBe('pay_123')
    expect(session.checkoutUrl).toBe('https://kaspi.example/pay/123')
    // $300.00 × 525.5 = 157650 KZT
    expect(session.amountKzt).toBe(157650)
    expect(session.orderId).toBeTruthy()

    const [url, init] = fetchMock.mock.calls[0]!
    expect(String(url)).toBe('https://kaspi.example/api/v1/payments')
    const body = JSON.parse((init as RequestInit).body as string) as Record<string, unknown>
    expect(body.amount).toBe(157650)
    expect(body.currency).toBe('KZT')
    expect(body.merchantId).toBe('m-1')
  })

  it('surfaces provider HTTP errors as kaspi_api_error', async () => {
    process.env.KASPI_API_BASE = 'https://kaspi.example'
    process.env.KASPI_MERCHANT_ID = 'm-1'
    process.env.KASPI_API_KEY = 'k-1'
    process.env.KASPI_USD_KZT_RATE = '500'
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('boom', { status: 502 }))
    await expect(createCheckoutSession(PARAMS)).rejects.toThrow(/kaspi_api_error/)
  })
})
