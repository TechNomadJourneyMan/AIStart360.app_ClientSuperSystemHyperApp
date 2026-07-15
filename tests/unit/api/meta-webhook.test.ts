import { createHmac } from 'crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NextRequest } from 'next/server'

const repository = vi.hoisted(() => ({
  applyWhatsAppDeliveryStatus: vi.fn(),
  ingestNormalizedMessage: vi.fn(),
  recordWebhookEvent: vi.fn(),
  transitionWebhookEvent: vi.fn(),
}))

const queue = vi.hoisted(() => ({
  send: vi.fn(),
}))

vi.mock('@/lib/omnichannel/repository', () => repository)
vi.mock('@/lib/inngest', () => ({ inngest: queue }))

import { GET, POST } from '@/app/api/webhooks/meta/route'

const originalAppSecret = process.env.META_APP_SECRET
const originalVerifyToken = process.env.META_WEBHOOK_VERIFY_TOKEN

function restoreEnv(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name]
  else process.env[name] = value
}

function getRequest(query: string): NextRequest {
  return new Request(`http://localhost/api/webhooks/meta?${query}`) as unknown as NextRequest
}

function postRequest(rawBody: string, secret: string, overrideSignature?: string): NextRequest {
  const signature = overrideSignature
    ?? `sha256=${createHmac('sha256', secret).update(Buffer.from(rawBody)).digest('hex')}`

  return new Request('http://localhost/api/webhooks/meta', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-hub-signature-256': signature,
    },
    body: rawBody,
  }) as unknown as NextRequest
}

function instagramInboundPayload() {
  return {
    object: 'instagram',
    entry: [
      {
        id: 'ig-business-1',
        messaging: [
          {
            sender: { id: 'ig-customer-1' },
            recipient: { id: 'ig-business-1' },
            timestamp: 1_720_000_000_000,
            message: { mid: 'ig-message-1', text: 'Привет! Хочу узнать цену.' },
          },
        ],
      },
    ],
  }
}

describe('/api/webhooks/meta', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    delete process.env.META_APP_SECRET
    delete process.env.META_WEBHOOK_VERIFY_TOKEN

    repository.recordWebhookEvent.mockResolvedValue({ id: 'audit-1', duplicate: false })
    repository.transitionWebhookEvent.mockResolvedValue(undefined)
    repository.applyWhatsAppDeliveryStatus.mockResolvedValue(true)
    repository.ingestNormalizedMessage.mockResolvedValue({
      duplicate: false,
      messageId: 'message-1',
      conversationId: 'conversation-1',
      shouldQueue: true,
    })
    queue.send.mockResolvedValue({ ids: ['inngest-event-1'] })
  })

  afterEach(() => {
    restoreEnv('META_APP_SECRET', originalAppSecret)
    restoreEnv('META_WEBHOOK_VERIFY_TOKEN', originalVerifyToken)
  })

  it('fails closed when GET verification is not configured', async () => {
    const response = await GET(getRequest(
      'hub.mode=subscribe&hub.verify_token=verify-me&hub.challenge=challenge-123',
    ))

    expect(response.status).toBe(503)
  })

  it('returns the plain-text challenge only for a matching verification token', async () => {
    process.env.META_WEBHOOK_VERIFY_TOKEN = 'verify-me'

    const valid = await GET(getRequest(
      'hub.mode=subscribe&hub.verify_token=verify-me&hub.challenge=challenge-123',
    ))
    expect(valid.status).toBe(200)
    expect(valid.headers.get('content-type')).toContain('text/plain')
    expect(await valid.text()).toBe('challenge-123')

    const invalid = await GET(getRequest(
      'hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=challenge-123',
    ))
    expect(invalid.status).toBe(403)
  })

  it('rejects an invalid HMAC before parsing, persistence, or queueing', async () => {
    process.env.META_APP_SECRET = 'app-secret'
    const rawBody = JSON.stringify(instagramInboundPayload())

    const response = await POST(postRequest(rawBody, 'wrong-secret'))

    expect(response.status).toBe(401)
    expect(repository.recordWebhookEvent).not.toHaveBeenCalled()
    expect(repository.ingestNormalizedMessage).not.toHaveBeenCalled()
    expect(repository.applyWhatsAppDeliveryStatus).not.toHaveBeenCalled()
    expect(queue.send).not.toHaveBeenCalled()
  })

  it('fails closed when POST signature verification is not configured', async () => {
    const rawBody = JSON.stringify(instagramInboundPayload())

    const response = await POST(postRequest(rawBody, 'some-secret'))

    expect(response.status).toBe(503)
    expect(repository.recordWebhookEvent).not.toHaveBeenCalled()
    expect(repository.ingestNormalizedMessage).not.toHaveBeenCalled()
    expect(queue.send).not.toHaveBeenCalled()
  })

  it('ACKs a valid but unsupported payload without touching persistence', async () => {
    process.env.META_APP_SECRET = 'app-secret'
    const rawBody = JSON.stringify({ object: 'unsupported', entry: [] })

    const response = await POST(postRequest(rawBody, 'app-secret'))

    expect(response.status).toBe(200)
    expect(repository.recordWebhookEvent).not.toHaveBeenCalled()
    expect(repository.ingestNormalizedMessage).not.toHaveBeenCalled()
    expect(queue.send).not.toHaveBeenCalled()
  })

  it('persists and queues a signed inbound Instagram message', async () => {
    process.env.META_APP_SECRET = 'app-secret'
    const rawBody = JSON.stringify(instagramInboundPayload())

    const response = await POST(postRequest(rawBody, 'app-secret'))

    expect(response.status).toBe(200)
    expect(repository.recordWebhookEvent).toHaveBeenCalledWith(expect.objectContaining({
      channel: 'instagram',
      eventType: 'message',
      accountExternalId: 'ig-business-1',
      eventHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      metadata: { eventCount: 1 },
    }))
    expect(repository.ingestNormalizedMessage).toHaveBeenCalledWith(expect.objectContaining({
      eventType: 'message',
      channel: 'instagram',
      externalMessageId: 'ig-message-1',
      direction: 'in',
      text: 'Привет! Хочу узнать цену.',
    }))
    expect(queue.send).toHaveBeenCalledWith({
      id: 'omnichannel-message-message-1',
      name: 'omnichannel/message.received',
      data: {
        message_id: 'message-1',
        conversation_id: 'conversation-1',
        force_draft: false,
      },
    })
    expect(repository.transitionWebhookEvent).toHaveBeenCalled()
  })

  it('does not enqueue a duplicate message whose repository status is terminal', async () => {
    process.env.META_APP_SECRET = 'app-secret'
    repository.ingestNormalizedMessage.mockResolvedValue({
      duplicate: true,
      messageId: 'message-1',
      conversationId: 'conversation-1',
      shouldQueue: false,
    })

    const response = await POST(postRequest(
      JSON.stringify(instagramInboundPayload()),
      'app-secret',
    ))

    expect(response.status).toBe(200)
    expect(repository.ingestNormalizedMessage).toHaveBeenCalledTimes(1)
    expect(queue.send).not.toHaveBeenCalled()
    expect(repository.transitionWebhookEvent).toHaveBeenCalled()
  })

  it('persists an Instagram outbound echo without queueing an AI reply', async () => {
    process.env.META_APP_SECRET = 'app-secret'
    const payload = instagramInboundPayload()
    payload.entry[0].messaging[0].sender.id = 'ig-business-1'
    payload.entry[0].messaging[0].recipient.id = 'ig-customer-1'

    // The route must also enforce direction, even if a repository adapter is
    // accidentally over-eager about queue recovery.
    repository.ingestNormalizedMessage.mockResolvedValue({
      duplicate: false,
      messageId: 'message-out-1',
      conversationId: 'conversation-1',
      shouldQueue: true,
    })

    const response = await POST(postRequest(JSON.stringify(payload), 'app-secret'))

    expect(response.status).toBe(200)
    expect(repository.ingestNormalizedMessage).toHaveBeenCalledWith(expect.objectContaining({
      direction: 'out',
      externalMessageId: 'ig-message-1',
    }))
    expect(queue.send).not.toHaveBeenCalled()
  })

  it('applies a signed WhatsApp delivery status without queueing', async () => {
    process.env.META_APP_SECRET = 'app-secret'
    const payload = {
      object: 'whatsapp_business_account',
      entry: [
        {
          id: 'waba-1',
          changes: [
            {
              field: 'messages',
              value: {
                metadata: { phone_number_id: 'phone-number-1' },
                statuses: [
                  {
                    id: 'wamid.outbound-1',
                    recipient_id: '77001234567',
                    status: 'delivered',
                    timestamp: '1720000000',
                  },
                ],
              },
            },
          ],
        },
      ],
    }

    const response = await POST(postRequest(JSON.stringify(payload), 'app-secret'))

    expect(response.status).toBe(200)
    expect(repository.applyWhatsAppDeliveryStatus).toHaveBeenCalledWith(expect.objectContaining({
      eventType: 'status',
      channel: 'whatsapp',
      externalMessageId: 'wamid.outbound-1',
      status: 'delivered',
    }))
    expect(repository.ingestNormalizedMessage).not.toHaveBeenCalled()
    expect(queue.send).not.toHaveBeenCalled()
  })

  it('marks the audit failed and asks Meta to retry when enqueueing fails', async () => {
    process.env.META_APP_SECRET = 'app-secret'
    queue.send.mockRejectedValue(new Error('provider details must not leak'))

    const response = await POST(postRequest(
      JSON.stringify(instagramInboundPayload()),
      'app-secret',
    ))

    expect(response.status).toBe(500)
    expect(repository.transitionWebhookEvent).toHaveBeenCalled()
    expect(await response.text()).not.toContain('provider details')
  })
})
