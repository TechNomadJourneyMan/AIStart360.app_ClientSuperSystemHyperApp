/**
 * Platform client bot → unified inbox for chats NOT linked to a profile
 * (lib/omnichannel/telegram-client-bot.ts), and the webhook wiring:
 * linked chats still go to lib/comm only.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NextRequest } from 'next/server'
import type { TelegramIngestPersistence } from '@/lib/omnichannel/telegram-ingest'

const CLIENT_TOKEN = '6000000002:AAHk3Q0123456789abcdefghijABCDEFGHIJ_-y'

function fakeStore() {
  return {
    recordWebhookEvent: vi.fn(async () => ({ id: 'audit-1', duplicate: false, status: 'received' as const })),
    claimWebhookEventForProcessing: vi.fn(async () => true),
    transitionWebhookEvent: vi.fn(async () => undefined),
    ingestNormalizedMessage: vi.fn(async () => ({ duplicate: false, messageId: 'msg-1', conversationId: 'conv-1', shouldQueue: true })),
  } satisfies TelegramIngestPersistence
}

function linkedClient(linked: boolean) {
  return {
    from: () => ({ select: () => ({ eq: () => ({ limit: async () => ({ data: linked ? [{ id: 'user-1' }] : [], error: null }) }) }) }),
  } as never
}

function update(text: string, chatType = 'private') {
  return {
    update_id: 77,
    message: {
      message_id: 3,
      date: Math.floor(Date.now() / 1000) - 1,
      chat: { id: 555, type: chatType },
      from: { id: 555, is_bot: false, first_name: 'Гость' },
      text,
    },
  }
}

describe('forwardUnlinkedClientBotUpdate', () => {
  const env = { ...process.env }
  beforeEach(() => {
    process.env.TELEGRAM_BOT_TOKEN = CLIENT_TOKEN
    process.env.TELEGRAM_BOT_USERNAME = 'aistart360_bot'
    delete process.env.OMNICHANNEL_TELEGRAM_CLIENT_BOT_INBOX
  })
  afterEach(() => { process.env = { ...env } })

  it('an unlinked chat lands in the inbox as a client-bot Telegram conversation', async () => {
    const { forwardUnlinkedClientBotUpdate } = await import('@/lib/omnichannel/telegram-client-bot')
    const store = fakeStore()
    const queue = { enqueue: vi.fn(async () => undefined) }
    const outcome = await forwardUnlinkedClientBotUpdate(update('Сколько стоит подписка?'), { linkChecked: true }, {
      persistence: store, queue, rateLimited: async () => false, sb: linkedClient(false),
    })
    expect(outcome).toBe('forwarded')
    expect(store.ingestNormalizedMessage).toHaveBeenCalledWith(expect.objectContaining({
      channel: 'telegram',
      accountExternalId: 'tgclient:6000000002',
      contactExternalId: 'tgclient:6000000002:555',
      metadata: expect.objectContaining({ transport: 'telegram_client_bot', telegramSource: 'client_bot', telegramBotUsername: 'aistart360_bot' }),
    }))
    expect(queue.enqueue).toHaveBeenCalledOnce()
  })

  it('/stop from an unlinked chat is forwarded (opt-out); from a linked chat it is not', async () => {
    const { forwardUnlinkedClientBotUpdate } = await import('@/lib/omnichannel/telegram-client-bot')
    const unlinked = await forwardUnlinkedClientBotUpdate(update('/stop'), { linkChecked: false }, {
      persistence: fakeStore(), queue: { enqueue: vi.fn(async () => undefined) }, rateLimited: async () => false, sb: linkedClient(false),
    })
    expect(unlinked).toBe('forwarded')
    const store = fakeStore()
    const linked = await forwardUnlinkedClientBotUpdate(update('/stop'), { linkChecked: false }, {
      persistence: store, rateLimited: async () => false, sb: linkedClient(true),
    })
    expect(linked).toBe('linked')
    expect(store.recordWebhookEvent).not.toHaveBeenCalled()
  })

  it('other commands, groups and the kill switch are skipped without writes', async () => {
    const { forwardUnlinkedClientBotUpdate } = await import('@/lib/omnichannel/telegram-client-bot')
    const store = fakeStore()
    const deps = { persistence: store, rateLimited: async () => false, sb: linkedClient(false) }
    expect(await forwardUnlinkedClientBotUpdate(update('/help'), { linkChecked: false }, deps)).toBe('skipped')
    expect(await forwardUnlinkedClientBotUpdate(update('привет', 'group'), { linkChecked: true }, deps)).toBe('skipped')
    process.env.OMNICHANNEL_TELEGRAM_CLIENT_BOT_INBOX = 'off'
    expect(await forwardUnlinkedClientBotUpdate(update('привет'), { linkChecked: true }, deps)).toBe('disabled')
    expect(store.recordWebhookEvent).not.toHaveBeenCalled()
  })

  it('an inbox failure is swallowed (never breaks the shared client webhook)', async () => {
    const { forwardUnlinkedClientBotUpdate } = await import('@/lib/omnichannel/telegram-client-bot')
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const store = fakeStore()
    store.recordWebhookEvent.mockRejectedValueOnce(new Error('violates check constraint'))
    const outcome = await forwardUnlinkedClientBotUpdate(update('привет'), { linkChecked: true }, {
      persistence: store, rateLimited: async () => false, sb: linkedClient(false),
    })
    expect(outcome).toBe('failed')
  })
})

// ─── Webhook wiring ─────────────────────────────────────────────────────────
const w = vi.hoisted(() => ({
  handleTelegramInbound: vi.fn(async (..._a: unknown[]) => true),
  forward: vi.fn(async (..._a: unknown[]) => 'forwarded'),
}))
vi.mock('@/lib/comm/inbound', () => ({ handleTelegramInbound: w.handleTelegramInbound }))
vi.mock('@/lib/telegram', () => ({ sendTelegramMessage: vi.fn(async () => true) }))
vi.mock('@/lib/telegram/staff-updates', () => ({
  firstSeenUpdate: vi.fn(async () => true), forgetUpdate: vi.fn(async () => {}),
  handleApprovalCallback: vi.fn(), handleStaffStart: vi.fn(async () => false),
}))
vi.mock('@/lib/rate-limit', () => ({ isRateLimitedKey: vi.fn(async () => false) }))
vi.mock('@/lib/supabase-service', () => ({
  createServiceClient: () => ({ from: () => ({ select: () => ({ eq: () => ({ limit: async () => ({ data: [] }) }) }) }) }),
}))

describe('/api/telegram/webhook → inbox wiring', () => {
  const SECRET = 'tg-secret'
  function tgReq(body: unknown, secret: string | null = SECRET): NextRequest {
    return new Request('http://localhost/api/telegram/webhook', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(secret ? { 'x-telegram-bot-api-secret-token': secret } : {}) },
      body: JSON.stringify(body),
    }) as unknown as NextRequest
  }

  beforeEach(() => {
    vi.resetModules()
    vi.doMock('@/lib/omnichannel/telegram-client-bot', () => ({ forwardUnlinkedClientBotUpdate: w.forward }))
    w.handleTelegramInbound.mockReset()
    w.forward.mockReset()
    process.env.TELEGRAM_WEBHOOK_SECRET = SECRET
  })
  afterEach(() => {
    vi.doUnmock('@/lib/omnichannel/telegram-client-bot')
    delete process.env.TELEGRAM_WEBHOOK_SECRET
  })

  it('a linked chat goes to lib/comm only', async () => {
    w.handleTelegramInbound.mockResolvedValueOnce(true)
    const { POST } = await import('@/app/api/telegram/webhook/route')
    const res = await POST(tgReq(update('Когда отчёт?')))
    expect(res.status).toBe(200)
    expect(w.handleTelegramInbound).toHaveBeenCalledOnce()
    expect(w.forward).not.toHaveBeenCalled()
  })

  it('an unlinked chat is handed to the inbox after lib/comm declined it', async () => {
    w.handleTelegramInbound.mockResolvedValueOnce(false)
    const { POST } = await import('@/app/api/telegram/webhook/route')
    const res = await POST(tgReq(update('Здравствуйте')))
    expect(res.status).toBe(200)
    expect(w.forward).toHaveBeenCalledWith(expect.objectContaining({ update_id: 77 }), { linkChecked: true })
  })

  it('without the webhook secret nothing reaches the inbox', async () => {
    delete process.env.TELEGRAM_WEBHOOK_SECRET
    const { POST } = await import('@/app/api/telegram/webhook/route')
    await POST(tgReq(update('Здравствуйте'), null))
    expect(w.handleTelegramInbound).not.toHaveBeenCalled()
    expect(w.forward).not.toHaveBeenCalled()
  })

  it('/start linking never reaches the inbox', async () => {
    const { POST } = await import('@/app/api/telegram/webhook/route')
    await POST(tgReq(update('/start abc123')))
    expect(w.forward).not.toHaveBeenCalled()
  })
})
