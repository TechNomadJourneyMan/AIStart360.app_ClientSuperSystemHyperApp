/**
 * Inbound wiring of the webhooks:
 *   /api/telegram/webhook   free text → lib/comm (only with the webhook secret);
 *                           /start linking unchanged.
 *   /api/webhooks/whatsapp-web  the omnichannel inbox path runs exactly as
 *                           before AND the message is mirrored into lib/comm
 *                           (phone known); a LID-only sender is not mirrored;
 *                           a mirror failure never fails the webhook.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NextRequest } from 'next/server'
import { createSignedBridgeHeaders, WHATSAPP_WEB_PORTAL_AUDIENCE } from '@/lib/omnichannel/whatsapp-web-signature'

const m = vi.hoisted(() => ({
  handleTelegramInbound: vi.fn(async (..._a: unknown[]) => true),
  mirrorWhatsAppInbound: vi.fn(async (..._a: unknown[]) => 'recorded'),
  send: vi.fn(async (..._a: unknown[]) => true),
  updates: [] as Array<Record<string, unknown>>,
  repository: {
    claimWebhookEventForProcessing: vi.fn(),
    ingestNormalizedMessage: vi.fn(),
    recordWebhookEvent: vi.fn(),
    transitionWebhookEvent: vi.fn(),
  },
  queue: { send: vi.fn() },
}))

vi.mock('@/lib/comm/inbound', () => ({ handleTelegramInbound: m.handleTelegramInbound, mirrorWhatsAppInbound: m.mirrorWhatsAppInbound }))
vi.mock('@/lib/telegram', () => ({ sendTelegramMessage: m.send }))
vi.mock('@/lib/telegram/staff-updates', () => ({
  firstSeenUpdate: vi.fn(async () => true), forgetUpdate: vi.fn(async () => {}),
  handleApprovalCallback: vi.fn(), handleStaffStart: vi.fn(async () => false),
}))
vi.mock('@/lib/rate-limit', () => ({ isRateLimitedKey: vi.fn(async () => false) }))
vi.mock('@/lib/supabase-service', () => ({
  createServiceClient: () => ({
    from: () => ({
      select: () => ({ eq: () => ({ limit: async () => ({ data: [{ id: 'user-1' }] }) }) }),
      update: (patch: Record<string, unknown>) => ({ eq: async () => { m.updates.push(patch); return { error: null } } }),
    }),
  }),
}))
vi.mock('@/lib/omnichannel/repository', () => m.repository)
vi.mock('@/lib/omnichannel/postgres-ingest', () => m.repository)
vi.mock('@/lib/inngest', () => ({ inngest: m.queue }))
vi.mock('@/lib/functions/process-omnichannel-message', () => ({ processOmnichannelMessageDirect: vi.fn() }))
vi.mock('@/lib/omnichannel/processing-jobs', () => ({ enqueueOmnichannelProcessingJob: vi.fn() }))
vi.mock('@/lib/omnichannel/process-job-queue', () => ({ drainOmnichannelProcessingJobs: vi.fn() }))

import { POST as telegramPOST } from '@/app/api/telegram/webhook/route'
import { POST as whatsappPOST } from '@/app/api/webhooks/whatsapp-web/route'

const SECRET = 'tg-secret'
function tgReq(body: unknown, secret: string | null = SECRET): NextRequest {
  return new Request('http://localhost/api/telegram/webhook', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(secret ? { 'x-telegram-bot-api-secret-token': secret } : {}) },
    body: JSON.stringify(body),
  }) as unknown as NextRequest
}

beforeEach(() => {
  vi.clearAllMocks()
  m.updates = []
  process.env.TELEGRAM_WEBHOOK_SECRET = SECRET
})

describe('/api/telegram/webhook → lib/comm', () => {
  it('free text from a chat goes to handleTelegramInbound with chat, message id and date', async () => {
    const res = await telegramPOST(tgReq({ update_id: 1, message: { message_id: 42, date: 1_792_000_000, chat: { id: 555 }, text: 'Когда отчёт?' } }))
    expect(res.status).toBe(200)
    expect(m.handleTelegramInbound).toHaveBeenCalledWith({ chatId: '555', text: 'Когда отчёт?', messageId: 42, date: 1_792_000_000 })
  })

  it('a photo caption counts as text', async () => {
    await telegramPOST(tgReq({ update_id: 2, message: { message_id: 43, chat: { id: 555 }, caption: 'Вот счёт' } }))
    expect(m.handleTelegramInbound).toHaveBeenCalledWith(expect.objectContaining({ text: 'Вот счёт' }))
  })

  it('without the webhook secret free text is ignored (an update could be forged)', async () => {
    delete process.env.TELEGRAM_WEBHOOK_SECRET
    const res = await telegramPOST(tgReq({ message: { chat: { id: 555 }, text: 'Привет' } }, null))
    expect(res.status).toBe(200)
    expect(m.handleTelegramInbound).not.toHaveBeenCalled()
  })

  it('/start <code> still links the chat and never reaches lib/comm', async () => {
    const res = await telegramPOST(tgReq({ update_id: 3, message: { chat: { id: 555 }, text: '/start abc123' } }))
    expect(res.status).toBe(200)
    expect(m.updates[0]).toMatchObject({ telegram_chat_id: '555', telegram_link_code: null })
    expect(m.handleTelegramInbound).not.toHaveBeenCalled()
  })

  it('a failing inbound answers 500 so Telegram retries (the message id dedupes the retry)', async () => {
    m.handleTelegramInbound.mockRejectedValueOnce(new Error('db down'))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await telegramPOST(tgReq({ update_id: 4, message: { message_id: 1, chat: { id: 555 }, text: 'x' } }))
    expect(res.status).toBe(500)
  })
})

const BRIDGE_SECRET = 'portal-webhook-secret-0123456789abcdef'
function waReq(message: Record<string, unknown>): NextRequest {
  const body = JSON.stringify({
    version: 1, event_id: 'event-12345678', event_type: 'message', session_id: 'primary',
    message: { id: 'MESSAGE123', remote_jid: '77011234567@s.whatsapp.net', timestamp_ms: Date.now() - 1000, text: 'Здравствуйте', message_type: 'text', live: true, from_me: false, ...message },
  })
  return new Request('http://localhost/api/webhooks/whatsapp-web', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...createSignedBridgeHeaders({ method: 'POST', path: '/api/webhooks/whatsapp-web', body, secret: BRIDGE_SECRET, audience: WHATSAPP_WEB_PORTAL_AUDIENCE }),
    },
    body,
  }) as unknown as NextRequest
}

describe('/api/webhooks/whatsapp-web → mirror', () => {
  beforeEach(() => {
    vi.stubEnv('NODE_ENV', 'development')
    process.env.WHATSAPP_WEB_BRIDGE_ENABLED = 'true'
    process.env.WHATSAPP_WEB_BRIDGE_WEBHOOK_SECRET = BRIDGE_SECRET
    process.env.WHATSAPP_WEB_BRIDGE_SESSION_ID = 'primary'
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key'
    delete process.env.OMNICHANNEL_PROCESSING_BACKEND
    delete process.env.OMNICHANNEL_PERSISTENCE
    delete process.env.OMNICHANNEL_DATABASE_URL
    delete process.env.DATABASE_URL
    m.repository.recordWebhookEvent.mockResolvedValue({ id: 'audit-1', duplicate: false, status: 'received' })
    m.repository.claimWebhookEventForProcessing.mockResolvedValue(true)
    m.repository.ingestNormalizedMessage.mockResolvedValue({ duplicate: false, messageId: 'om-1', conversationId: 'conv-1', shouldQueue: true })
    m.repository.transitionWebhookEvent.mockResolvedValue(undefined)
    m.queue.send.mockResolvedValue({ ids: ['e'] })
  })

  it('the inbox gets the message as before AND the platform conversation gets a copy', async () => {
    const res = await whatsappPOST(waReq({}))
    expect(res.status).toBe(200)
    expect(m.repository.ingestNormalizedMessage).toHaveBeenCalledTimes(1)
    expect(m.queue.send).toHaveBeenCalledTimes(1)
    expect(m.repository.transitionWebhookEvent).toHaveBeenCalledWith('audit-1', 'processed')
    await vi.waitFor(() => expect(m.mirrorWhatsAppInbound).toHaveBeenCalledTimes(1))
    expect(m.mirrorWhatsAppInbound).toHaveBeenCalledWith(expect.objectContaining({
      phone: '77011234567', text: 'Здравствуйте', messageType: 'text', externalMessageId: 'waweb:primary:MESSAGE123',
      bridgeSessionId: 'primary', jid: '77011234567@s.whatsapp.net', omnichannelConversationId: 'conv-1', omnichannelMessageId: 'om-1',
    }))
  })

  it('a LID-only sender (no verified phone) is not mirrored; the inbox still processes it', async () => {
    const res = await whatsappPOST(waReq({ remote_jid: 'opaque-lid-1@lid' }))
    expect(res.status).toBe(200)
    expect(m.queue.send).toHaveBeenCalledTimes(1)
    expect(m.mirrorWhatsAppInbound).not.toHaveBeenCalled()
  })

  it('a mirror failure never changes the webhook answer', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    m.mirrorWhatsAppInbound.mockRejectedValueOnce(new Error('db down'))
    const res = await whatsappPOST(waReq({}))
    expect(res.status).toBe(200)
    await vi.waitFor(() => expect(m.mirrorWhatsAppInbound).toHaveBeenCalled())
  })

  it('a duplicate bridge event is acknowledged without a second mirror', async () => {
    m.repository.recordWebhookEvent.mockResolvedValue({ id: 'audit-1', duplicate: true, status: 'processed' })
    const res = await whatsappPOST(waReq({}))
    expect(res.status).toBe(200)
    expect(m.mirrorWhatsAppInbound).not.toHaveBeenCalled()
  })
})
