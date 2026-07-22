import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const dependencies = vi.hoisted(() => ({
  enqueue: vi.fn(),
  start: vi.fn(),
}))

vi.mock('@/lib/integrations/myhonor/order-notification-repository', async (original) => {
  const actual = await original<typeof import('@/lib/integrations/myhonor/order-notification-repository')>()
  return { ...actual, enqueueMyHonorOrderNotification: dependencies.enqueue }
})
vi.mock('workflow/api', () => ({ start: dependencies.start }))

import { POST } from '@/app/api/v1/integrations/myhonor/order-notifications/route'

const endpoint = 'https://portal.example.kz/api/v1/integrations/myhonor/order-notifications'
const apiKey = 'myhonor-integration-secret-at-least-32-bytes'
const eventId = 'myhonor:order:84:status:3'

function body(overrides: Record<string, unknown> = {}) {
  return {
    event_id: eventId,
    occurred_at: '2026-07-22T06:30:00Z',
    order_id: '84',
    order_number: 'MH-0084',
    status: 'confirmed',
    status_version: 3,
    recipient: {
      phone_e164: '+77051234567',
      name: 'Марина',
      whatsapp_opt_in: true,
    },
    locale: 'ru',
    details: {},
    ...overrides,
  }
}

function request(input: {
  payload?: unknown
  authorization?: string | null
  idempotencyKey?: string | null
  contentType?: string | null
} = {}): NextRequest {
  const payload = JSON.stringify(input.payload ?? body())
  return new NextRequest(endpoint, {
    method: 'POST',
    headers: {
      ...(input.authorization === null
        ? {}
        : { authorization: input.authorization ?? `Bearer ${apiKey}` }),
      ...(input.idempotencyKey === null
        ? {}
        : { 'idempotency-key': input.idempotencyKey ?? eventId }),
      ...(input.contentType === null
        ? {}
        : { 'content-type': input.contentType ?? 'application/json' }),
    },
    body: payload,
  })
}

function configureEnvironment(): void {
  vi.stubEnv('MYHONOR_ORDER_NOTIFICATIONS_API_KEY', apiKey)
  vi.stubEnv('WHATSAPP_TOKEN', 'meta-token')
  vi.stubEnv('WHATSAPP_PHONE_NUMBER_ID', 'phone-id')
  vi.stubEnv('WHATSAPP_TEMPLATE_LANGUAGE', 'ru')
  vi.stubEnv('WHATSAPP_TEMPLATE_ORDER_CONFIRMED', 'myhonor_order_confirmed_v1')
  vi.stubEnv('WHATSAPP_TEMPLATE_ORDER_SHIPPED', 'myhonor_order_shipped_v1')
  vi.stubEnv('WHATSAPP_TEMPLATE_ORDER_DELIVERED', 'myhonor_order_delivered_v1')
  vi.stubEnv('WHATSAPP_TEMPLATE_ORDER_CANCELLED', 'myhonor_order_cancelled_v1')
}

describe('POST /api/v1/integrations/myhonor/order-notifications', () => {
  beforeEach(() => {
    vi.unstubAllEnvs()
    vi.resetAllMocks()
    configureEnvironment()
    dependencies.start.mockResolvedValue({ runId: 'wrun-myhonor-1' })
    dependencies.enqueue.mockResolvedValue({
      id: '00000000-0000-4000-8000-000000000001',
      state: 'queued',
      providerMessageId: null,
      runAt: '2026-07-22T06:30:00.000Z',
      created: true,
      conflict: false,
    })
  })

  it('fails closed when the integration secret is absent', async () => {
    vi.stubEnv('MYHONOR_ORDER_NOTIFICATIONS_API_KEY', '')
    const response = await POST(request())
    expect(response.status).toBe(503)
    expect((await response.json()).error.code).toBe('integration_not_configured')
    expect(dependencies.enqueue).not.toHaveBeenCalled()
  })

  it('rejects invalid bearer auth before reading or persisting the request', async () => {
    const response = await POST(request({ authorization: 'Bearer wrong-secret' }))
    expect(response.status).toBe(401)
    expect((await response.json()).error.code).toBe('unauthorized')
    expect(dependencies.enqueue).not.toHaveBeenCalled()
  })

  it('requires JSON, a valid idempotency key, and the strict contract', async () => {
    expect((await POST(request({ contentType: 'text/plain' }))).status).toBe(415)
    expect((await POST(request({ idempotencyKey: 'short' }))).status).toBe(400)
    const invalid = await POST(request({ payload: body({ unexpected: true }) }))
    expect(invalid.status).toBe(422)
    expect(dependencies.enqueue).not.toHaveBeenCalled()
  })

  it('requires Idempotency-Key to equal event_id', async () => {
    const response = await POST(request({
      idempotencyKey: 'myhonor:order:84:status:4',
    }))
    expect(response.status).toBe(409)
    expect((await response.json()).error.code).toBe('idempotency_event_mismatch')
  })

  it('persists first, starts a durable workflow, and returns 202', async () => {
    const response = await POST(request())
    expect(response.status).toBe(202)
    expect(await response.json()).toEqual({
      ok: true,
      notification_id: '00000000-0000-4000-8000-000000000001',
      event_id: eventId,
      state: 'queued',
      duplicate: false,
    })
    expect(dependencies.enqueue).toHaveBeenCalledOnce()
    expect(dependencies.start).toHaveBeenCalledWith(
      expect.any(Function),
      [{ notification_id: '00000000-0000-4000-8000-000000000001' }],
    )
    expect(dependencies.enqueue.mock.invocationCallOrder[0]).toBeLessThan(
      dependencies.start.mock.invocationCallOrder[0],
    )
  })

  it('returns a retryable error after persistence when Workflow cannot start', async () => {
    dependencies.start.mockRejectedValue(new Error('workflow unavailable'))
    const response = await POST(request())
    expect(response.status).toBe(503)
    const responseBody = await response.json()
    expect(responseBody.error).toMatchObject({
      code: 'notification_dispatch_unavailable',
      retryable: true,
      details: { notification_id: '00000000-0000-4000-8000-000000000001' },
    })
  })

  it('rejects idempotency-key reuse with a different normalized request', async () => {
    dependencies.enqueue.mockResolvedValue({
      id: '00000000-0000-4000-8000-000000000001',
      state: 'queued',
      providerMessageId: null,
      runAt: '2026-07-22T06:30:00.000Z',
      created: false,
      conflict: true,
    })
    const response = await POST(request())
    expect(response.status).toBe(409)
    expect((await response.json()).error.code).toBe('idempotency_conflict')
    expect(dependencies.start).not.toHaveBeenCalled()
  })

  it('returns an existing terminal result without starting another workflow', async () => {
    dependencies.enqueue.mockResolvedValue({
      id: '00000000-0000-4000-8000-000000000001',
      state: 'delivered',
      providerMessageId: 'wamid.accepted-1',
      runAt: '2026-07-22T06:30:00.000Z',
      created: false,
      conflict: false,
    })
    const response = await POST(request())
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      duplicate: true,
      state: 'delivered',
      provider_message_id: 'wamid.accepted-1',
    })
    expect(dependencies.start).not.toHaveBeenCalled()
  })
})
