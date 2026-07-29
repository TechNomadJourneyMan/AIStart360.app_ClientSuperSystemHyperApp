import { createHmac } from 'crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NextRequest } from 'next/server'

const repository = vi.hoisted(() => ({
  applyWhatsAppDeliveryStatus: vi.fn(),
  claimWebhookEventForProcessing: vi.fn(),
  ingestNormalizedMessage: vi.fn(),
  recordWebhookEvent: vi.fn(),
  transitionWebhookEvent: vi.fn(),
}))

const queue = vi.hoisted(() => ({
  send: vi.fn(),
}))

const processingJobs = vi.hoisted(() => ({
  enqueue: vi.fn(),
}))

const jobDrain = vi.hoisted(() => ({
  drain: vi.fn(),
}))

const vercel = vi.hoisted(() => ({
  waitUntil: vi.fn(),
}))

const workflow = vi.hoisted(() => ({
  processor: vi.fn(),
  start: vi.fn(),
}))

// A WhatsApp `statuses` delivery is first offered to the transactional MyHonor
// notification ledger and only falls through to the omnichannel repository when
// it matches nothing. Without this mock the unit test opens a real Supabase
// service client and the route answers 500 on the network error.
const myhonor = vi.hoisted(() => ({
  applyDeliveryStatus: vi.fn(),
}))

vi.mock('@/lib/omnichannel/repository', () => repository)
vi.mock('@/lib/inngest', () => ({ inngest: queue }))
vi.mock('@/lib/omnichannel/processing-jobs', () => ({
  enqueueOmnichannelProcessingJob: processingJobs.enqueue,
}))
vi.mock('@/lib/omnichannel/process-job-queue', () => ({
  drainOmnichannelProcessingJobs: jobDrain.drain,
}))
vi.mock('@vercel/functions', () => vercel)
vi.mock('workflow/api', () => ({ start: workflow.start }))
vi.mock('@/workflows/process-omnichannel-message', () => ({
  processOmnichannelMessageWorkflow: workflow.processor,
}))
vi.mock('@/lib/integrations/myhonor/order-notification-repository', () => ({
  applyMyHonorOrderNotificationDeliveryStatus: myhonor.applyDeliveryStatus,
}))

import { GET, POST } from '@/app/api/webhooks/meta/route'

const originalAppSecret = process.env.META_APP_SECRET
const originalInstagramAppSecret = process.env.INSTAGRAM_APP_SECRET
const originalInstagramAccountId = process.env.INSTAGRAM_ACCOUNT_ID
const originalWhatsAppPhoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID
const originalVerifyToken = process.env.META_WEBHOOK_VERIFY_TOKEN
const originalProcessingBackend = process.env.OMNICHANNEL_PROCESSING_BACKEND
const originalVercel = process.env.VERCEL

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

function whatsAppInboundPayload() {
  return {
    object: 'whatsapp_business_account',
    entry: [
      {
        id: 'waba-1',
        changes: [
          {
            field: 'messages',
            value: {
              messaging_product: 'whatsapp',
              metadata: {
                display_phone_number: '77000000000',
                phone_number_id: 'phone-number-1',
              },
              contacts: [{ profile: { name: 'Алия' }, wa_id: '77770000000' }],
              messages: [
                {
                  from: '77770000000',
                  id: 'wamid.inbound-1',
                  timestamp: '1700000000',
                  type: 'text',
                  text: { body: 'Хочу в Клуб' },
                },
              ],
            },
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
    delete process.env.INSTAGRAM_APP_SECRET
    delete process.env.META_WEBHOOK_VERIFY_TOKEN
    delete process.env.OMNICHANNEL_PROCESSING_BACKEND
    delete process.env.VERCEL
    process.env.INSTAGRAM_ACCOUNT_ID = 'ig-business-1'
    process.env.WHATSAPP_PHONE_NUMBER_ID = 'phone-number-1'

    repository.recordWebhookEvent.mockResolvedValue({
      id: 'audit-1',
      duplicate: false,
      status: 'received',
    })
    repository.claimWebhookEventForProcessing.mockResolvedValue(true)
    repository.transitionWebhookEvent.mockResolvedValue(undefined)
    repository.applyWhatsAppDeliveryStatus.mockResolvedValue(true)
    myhonor.applyDeliveryStatus.mockResolvedValue({
      matched: false,
      notificationId: null,
      state: null,
    })
    repository.ingestNormalizedMessage.mockResolvedValue({
      duplicate: false,
      messageId: 'message-1',
      conversationId: 'conversation-1',
      shouldQueue: true,
    })
    queue.send.mockResolvedValue({ ids: ['inngest-event-1'] })
    processingJobs.enqueue.mockResolvedValue({
      id: 'job-1',
      runAt: new Date().toISOString(),
    })
    jobDrain.drain.mockResolvedValue({ completed: 1 })
    workflow.start.mockResolvedValue({ runId: 'run-1' })
  })

  afterEach(() => {
    restoreEnv('META_APP_SECRET', originalAppSecret)
    restoreEnv('INSTAGRAM_APP_SECRET', originalInstagramAppSecret)
    restoreEnv('INSTAGRAM_ACCOUNT_ID', originalInstagramAccountId)
    restoreEnv('WHATSAPP_PHONE_NUMBER_ID', originalWhatsAppPhoneNumberId)
    restoreEnv('META_WEBHOOK_VERIFY_TOKEN', originalVerifyToken)
    restoreEnv('OMNICHANNEL_PROCESSING_BACKEND', originalProcessingBackend)
    restoreEnv('VERCEL', originalVercel)
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

  it('uses a dedicated Instagram app secret instead of the WhatsApp app secret', async () => {
    process.env.META_APP_SECRET = 'whatsapp-app-secret'
    process.env.INSTAGRAM_APP_SECRET = 'instagram-app-secret'
    const rawBody = JSON.stringify(instagramInboundPayload())

    const accepted = await POST(postRequest(rawBody, 'instagram-app-secret'))
    expect(accepted.status).toBe(200)
    expect(repository.ingestNormalizedMessage).toHaveBeenCalledOnce()

    vi.clearAllMocks()
    const rejected = await POST(postRequest(rawBody, 'whatsapp-app-secret'))
    expect(rejected.status).toBe(401)
    expect(repository.recordWebhookEvent).not.toHaveBeenCalled()
  })

  it('never authenticates a WhatsApp payload with only the Instagram secret', async () => {
    process.env.META_APP_SECRET = 'whatsapp-app-secret'
    process.env.INSTAGRAM_APP_SECRET = 'instagram-app-secret'
    const rawBody = JSON.stringify(whatsAppInboundPayload())

    const response = await POST(postRequest(rawBody, 'instagram-app-secret'))

    expect(response.status).toBe(401)
    expect(repository.recordWebhookEvent).not.toHaveBeenCalled()
    expect(repository.ingestNormalizedMessage).not.toHaveBeenCalled()
  })

  it('ACKs a signed event for an unconfigured Meta account without persisting customer data', async () => {
    process.env.META_APP_SECRET = 'app-secret'
    process.env.INSTAGRAM_ACCOUNT_ID = 'different-instagram-account'
    const rawBody = JSON.stringify(instagramInboundPayload())

    const response = await POST(postRequest(rawBody, 'app-secret'))

    expect(response.status).toBe(200)
    expect(repository.recordWebhookEvent).not.toHaveBeenCalled()
    expect(repository.ingestNormalizedMessage).not.toHaveBeenCalled()
    expect(workflow.start).not.toHaveBeenCalled()
  })

  it('fails closed before persistence when the channel account id is missing', async () => {
    process.env.META_APP_SECRET = 'app-secret'
    delete process.env.INSTAGRAM_ACCOUNT_ID
    const rawBody = JSON.stringify(instagramInboundPayload())

    const response = await POST(postRequest(rawBody, 'app-secret'))

    expect(response.status).toBe(503)
    expect(repository.recordWebhookEvent).not.toHaveBeenCalled()
    expect(repository.ingestNormalizedMessage).not.toHaveBeenCalled()
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

  it('durably queues a signed WhatsApp Cloud API message without Inngest', async () => {
    process.env.META_APP_SECRET = 'app-secret'
    process.env.OMNICHANNEL_PROCESSING_BACKEND = 'database'

    const response = await POST(postRequest(
      JSON.stringify(whatsAppInboundPayload()),
      'app-secret',
    ))

    expect(response.status).toBe(200)
    expect(repository.ingestNormalizedMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: 'whatsapp',
        accountExternalId: 'phone-number-1',
        externalMessageId: 'wamid.inbound-1',
        direction: 'in',
        text: 'Хочу в Клуб',
      }),
    )
    expect(processingJobs.enqueue).toHaveBeenCalledWith({
      messageId: 'message-1',
      forceDraft: false,
    })
    expect(queue.send).not.toHaveBeenCalled()
    expect(repository.transitionWebhookEvent).toHaveBeenCalledWith(
      'audit-1',
      'processed',
    )
  })

  it('starts a durable workflow for Meta messages without Inngest or database jobs', async () => {
    process.env.META_APP_SECRET = 'app-secret'
    process.env.OMNICHANNEL_PROCESSING_BACKEND = 'workflow'

    const response = await POST(postRequest(
      JSON.stringify(whatsAppInboundPayload()),
      'app-secret',
    ))

    expect(response.status).toBe(200)
    expect(workflow.start).toHaveBeenCalledWith(workflow.processor, [{
      message_id: 'message-1',
      conversation_id: 'conversation-1',
      force_draft: false,
    }])
    expect(queue.send).not.toHaveBeenCalled()
    expect(processingJobs.enqueue).not.toHaveBeenCalled()
    expect(repository.transitionWebhookEvent).toHaveBeenCalledWith(
      'audit-1',
      'processed',
    )
  })

  it('starts the due database job with Vercel waitUntil after durable enqueue', async () => {
    process.env.META_APP_SECRET = 'app-secret'
    process.env.OMNICHANNEL_PROCESSING_BACKEND = 'database'
    process.env.VERCEL = '1'
    processingJobs.enqueue.mockResolvedValue({
      id: 'job-1',
      runAt: new Date(Date.now() - 1_000).toISOString(),
    })

    const response = await POST(postRequest(
      JSON.stringify(instagramInboundPayload()),
      'app-secret',
    ))

    expect(response.status).toBe(200)
    expect(jobDrain.drain).toHaveBeenCalledWith({ limit: 1 })
    expect(vercel.waitUntil).toHaveBeenCalledOnce()
    expect(queue.send).not.toHaveBeenCalled()
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

  it('ACKs an already-owned duplicate audit without starting another workflow', async () => {
    process.env.META_APP_SECRET = 'app-secret'
    process.env.OMNICHANNEL_PROCESSING_BACKEND = 'workflow'
    repository.recordWebhookEvent.mockResolvedValue({
      id: 'audit-1',
      duplicate: true,
      status: 'processed',
    })

    const response = await POST(postRequest(
      JSON.stringify(whatsAppInboundPayload()),
      'app-secret',
    ))

    expect(response.status).toBe(200)
    expect(repository.ingestNormalizedMessage).not.toHaveBeenCalled()
    expect(repository.claimWebhookEventForProcessing).not.toHaveBeenCalled()
    expect(workflow.start).not.toHaveBeenCalled()
  })

  it('asks Meta to retry when another request owns the audit lease', async () => {
    process.env.META_APP_SECRET = 'app-secret'
    process.env.OMNICHANNEL_PROCESSING_BACKEND = 'workflow'
    repository.claimWebhookEventForProcessing.mockResolvedValue(false)

    const response = await POST(postRequest(
      JSON.stringify(whatsAppInboundPayload()),
      'app-secret',
    ))

    expect(response.status).toBe(503)
    expect(workflow.start).not.toHaveBeenCalled()
    expect(repository.transitionWebhookEvent).not.toHaveBeenCalled()
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

  it('keeps a matched MyHonor delivery status out of the omnichannel ledger', async () => {
    process.env.META_APP_SECRET = 'app-secret'
    myhonor.applyDeliveryStatus.mockResolvedValue({
      matched: true,
      notificationId: '00000000-0000-4000-8000-000000000001',
      state: 'delivered',
    })
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
                    id: 'wamid.myhonor-1',
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
    expect(myhonor.applyDeliveryStatus).toHaveBeenCalledWith(expect.objectContaining({
      providerMessageId: 'wamid.myhonor-1',
      status: 'delivered',
    }))
    expect(repository.applyWhatsAppDeliveryStatus).not.toHaveBeenCalled()
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

  it('keeps database queue failures retryable without leaking provider details', async () => {
    process.env.META_APP_SECRET = 'app-secret'
    process.env.OMNICHANNEL_PROCESSING_BACKEND = 'database'
    processingJobs.enqueue.mockRejectedValue(new Error('database provider details'))

    const response = await POST(postRequest(
      JSON.stringify(instagramInboundPayload()),
      'app-secret',
    ))

    expect(response.status).toBe(500)
    expect(repository.transitionWebhookEvent).toHaveBeenCalledWith(
      'audit-1',
      'failed',
      'database_queue_enqueue_failed',
    )
    expect(queue.send).not.toHaveBeenCalled()
    expect(await response.text()).not.toContain('database provider details')
  })

  it('keeps workflow start failures retryable without leaking provider details', async () => {
    process.env.META_APP_SECRET = 'app-secret'
    process.env.OMNICHANNEL_PROCESSING_BACKEND = 'workflow'
    workflow.start.mockRejectedValue(new Error('workflow provider details'))

    const response = await POST(postRequest(
      JSON.stringify(whatsAppInboundPayload()),
      'app-secret',
    ))

    expect(response.status).toBe(500)
    expect(repository.transitionWebhookEvent).toHaveBeenCalledWith(
      'audit-1',
      'failed',
      'workflow_start_failed',
    )
    expect(queue.send).not.toHaveBeenCalled()
    expect(await response.text()).not.toContain('workflow provider details')
  })
})
