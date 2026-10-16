/**
 * POST /api/webhooks/telegram-inbox/<connectionId> — the inbox business bot.
 * Secret check before any write (403), unknown connection 404, private text
 * → shared ingest, groups ignored, in-flight lease → 503.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NextRequest } from 'next/server'
import { hashTelegramWebhookSecret } from '@/lib/omnichannel/telegram-connections'

const CONNECTION_ID = '11111111-1111-4111-8111-111111111111'
const SECRET = 'per-connection-secret-0123456789abcdefgh'

const m = vi.hoisted(() => ({
  target: null as Record<string, unknown> | null,
  ingest: vi.fn(),
  touch: vi.fn(async () => undefined),
  limited: vi.fn(async () => false),
}))

vi.mock('@/lib/omnichannel/telegram-connections', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/omnichannel/telegram-connections')>()
  return {
    ...actual,
    getTelegramBotWebhookTarget: vi.fn(async () => m.target),
    touchTelegramBotLastUpdate: m.touch,
  }
})
vi.mock('@/lib/omnichannel/telegram-ingest', () => ({ ingestTelegramInboxUpdate: m.ingest }))
vi.mock('@/lib/rate-limit', () => ({ isRateLimitedKey: m.limited }))

import { POST } from '@/app/api/webhooks/telegram-inbox/[connectionId]/route'

function req(body: unknown, secret: string | null = SECRET): NextRequest {
  return new Request(`https://portal.example.com/api/webhooks/telegram-inbox/${CONNECTION_ID}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(secret ? { 'x-telegram-bot-api-secret-token': secret } : {}),
    },
    body: JSON.stringify(body),
  }) as unknown as NextRequest
}

const textUpdate = {
  update_id: 10,
  message: {
    message_id: 5,
    date: Math.floor(Date.now() / 1000) - 2,
    chat: { id: 4242, type: 'private' },
    from: { id: 4242, is_bot: false, first_name: 'Ерлан' },
    text: 'Добрый день',
  },
}

beforeEach(() => {
  vi.clearAllMocks()
  m.target = {
    id: CONNECTION_ID,
    botId: '7000000001',
    botUsername: 'honor_shop_bot',
    botName: null,
    status: 'active',
    webhookOk: true,
    webhookSetAt: null,
    lastUpdateAt: null,
    lastError: null,
    connectedAt: '',
    webhookSecretHash: hashTelegramWebhookSecret(SECRET),
  }
  m.ingest.mockResolvedValue({ outcome: 'processed', messageId: 'msg-1', conversationId: 'conv-1', queued: true })
  m.limited.mockResolvedValue(false)
})

const params = { params: { connectionId: CONNECTION_ID } }

describe('telegram inbox webhook', () => {
  it('403 on a wrong secret, before any write', async () => {
    const res = await POST(req(textUpdate, 'wrong-secret'), params)
    expect(res.status).toBe(403)
    expect(m.ingest).not.toHaveBeenCalled()
  })

  it('403 without the secret header', async () => {
    const res = await POST(req(textUpdate, null), params)
    expect(res.status).toBe(403)
    expect(m.ingest).not.toHaveBeenCalled()
  })

  it('404 for an unknown or malformed connection id', async () => {
    m.target = null
    expect((await POST(req(textUpdate), params)).status).toBe(404)
    expect((await POST(req(textUpdate), { params: { connectionId: 'nope' } })).status).toBe(404)
    expect(m.ingest).not.toHaveBeenCalled()
  })

  it('a private text message goes to the shared ingest as channel telegram', async () => {
    const res = await POST(req(textUpdate), params)
    expect(res.status).toBe(200)
    expect(m.ingest).toHaveBeenCalledTimes(1)
    const parsed = m.ingest.mock.calls[0][0]
    expect(parsed.message).toMatchObject({
      channel: 'telegram',
      accountExternalId: 'tgbot:7000000001',
      externalMessageId: 'tgbot:7000000001:4242:5',
      text: 'Добрый день',
    })
    expect(parsed.message.metadata.transport).toBe('telegram_bot')
  })

  it('group messages are acknowledged and ignored', async () => {
    const res = await POST(req({ ...textUpdate, message: { ...textUpdate.message, chat: { id: -1001, type: 'group' } } }), params)
    expect(res.status).toBe(200)
    expect(m.ingest).not.toHaveBeenCalled()
  })

  it('a flooding chat is acknowledged without ingest', async () => {
    m.limited.mockResolvedValueOnce(true)
    const res = await POST(req(textUpdate), params)
    expect(res.status).toBe(200)
    expect(m.ingest).not.toHaveBeenCalled()
  })

  it('in-flight lease → 503 (Telegram retries), ingest failure → 500', async () => {
    m.ingest.mockResolvedValueOnce({ outcome: 'in_flight' })
    expect((await POST(req(textUpdate), params)).status).toBe(503)
    m.ingest.mockRejectedValueOnce(new Error('db down'))
    expect((await POST(req(textUpdate), params)).status).toBe(500)
  })
})
