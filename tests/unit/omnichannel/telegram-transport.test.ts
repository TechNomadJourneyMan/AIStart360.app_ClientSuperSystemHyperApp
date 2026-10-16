/**
 * Outbound Telegram replies (manual «Отправить», approved drafts and auto)
 * go through dispatchOmnichannelReply → Bot API sendMessage; typing via
 * sendChatAction. Telegram has no 24-hour window; opt-out still wins.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const conn = vi.hoisted(() => ({ token: null as string | null }))
vi.mock('@/lib/omnichannel/telegram-connections', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/omnichannel/telegram-connections')>()
  return { ...actual, getActiveTelegramBotToken: vi.fn(async () => conn.token) }
})

import {
  dispatchOmnichannelPresence,
  dispatchOmnichannelReply,
  isConfiguredOmnichannelSender,
  isDraftOnlyOmnichannelTransport,
  resolveOmnichannelTransport,
} from '@/lib/omnichannel/transport-dispatch'
import {
  decideReplyPolicy,
  detectDeterministicRisk,
  getSendWindow,
} from '@/lib/omnichannel/guardrails'
import { getOmnichannelAutoReplyReadiness } from '@/lib/omnichannel/auto-reply-readiness'

const BUSINESS_TOKEN = '7000000001:AAHk3Q0123456789abcdefghijABCDEFGHIJ_-x'
const CLIENT_TOKEN = '6000000002:AAHk3Q0123456789abcdefghijABCDEFGHIJ_-y'
const BUSINESS_META = { transport: 'telegram_bot', telegramSource: 'business_bot', providerTimestampTrusted: true }
const CLIENT_META = { transport: 'telegram_client_bot', telegramSource: 'client_bot', providerTimestampTrusted: true }

const env = { ...process.env }
let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  conn.token = BUSINESS_TOKEN
  process.env.SECRETS_ENCRYPTION_KEY = 'a'.repeat(64)
  process.env.TELEGRAM_BOT_TOKEN = CLIENT_TOKEN
  fetchMock = vi.fn(async (url: string) => {
    const method = String(url).split('/').pop()
    const result = method === 'sendMessage' ? { message_id: 9001 } : true
    return new Response(JSON.stringify({ ok: true, result }), { status: 200 })
  })
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => {
  vi.unstubAllGlobals()
  process.env = { ...env }
})

function input(overrides: Record<string, unknown> = {}) {
  return {
    channel: 'telegram' as const,
    metadata: BUSINESS_META,
    accountExternalId: 'tgbot:7000000001',
    conversationExternalId: '4242',
    contactExternalId: 'tgbot:7000000001:4242',
    text: 'Здравствуйте! Из какого вы города?',
    actor: 'manual' as const,
    idempotencyKey: 'omnichannel:manual:c1:m1:abc',
    ...overrides,
  }
}

describe('telegram transport', () => {
  it('resolves only explicit Telegram transports', () => {
    expect(resolveOmnichannelTransport('telegram', BUSINESS_META)).toBe('telegram_bot')
    expect(resolveOmnichannelTransport('telegram', CLIENT_META)).toBe('telegram_client_bot')
    expect(resolveOmnichannelTransport('telegram', {})).toBeNull()
    expect(resolveOmnichannelTransport('telegram', { transport: 'whatsapp_web' })).toBeNull()
  })

  it('sends via Bot API sendMessage with the active bot token and namespaces the id', async () => {
    const result = await dispatchOmnichannelReply(input())
    expect(result).toEqual({ ok: true, externalMessageId: 'tgbot:7000000001:4242:9001', rawStatus: 200 })
    expect(fetchMock).toHaveBeenCalledOnce()
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(`https://api.telegram.org/bot${BUSINESS_TOKEN}/sendMessage`)
    expect(JSON.parse(String(init.body))).toEqual({ chat_id: '4242', text: 'Здравствуйте! Из какого вы города?' })
  })

  it('a disconnected business bot fails closed without a network call', async () => {
    conn.token = null
    const result = await dispatchOmnichannelReply(input())
    expect(result).toMatchObject({ ok: false, code: 'telegram_bot_not_connected', requestSent: false })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('client-bot conversations reply through TELEGRAM_BOT_TOKEN, only for the same bot', async () => {
    const ok = await dispatchOmnichannelReply(input({
      metadata: CLIENT_META, accountExternalId: 'tgclient:6000000002', contactExternalId: 'tgclient:6000000002:4242',
    }))
    expect(ok).toMatchObject({ ok: true, externalMessageId: 'tgclient:6000000002:4242:9001' })
    expect(String(fetchMock.mock.calls[0][0])).toContain(`/bot${CLIENT_TOKEN}/sendMessage`)

    fetchMock.mockClear()
    const rotated = await dispatchOmnichannelReply(input({ metadata: CLIENT_META, accountExternalId: 'tgclient:1111111' }))
    expect(rotated).toMatchObject({ ok: false, code: 'telegram_bot_not_connected' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('a Telegram timeout is reported as delivery-unknown (no automatic resend)', async () => {
    fetchMock.mockRejectedValueOnce(Object.assign(new Error('timeout'), { name: 'TimeoutError' }))
    const result = await dispatchOmnichannelReply(input())
    expect(result).toMatchObject({ ok: false, status: null, code: 'timeout' })
  })

  it('typing: composing → sendChatAction typing; paused is a no-op', async () => {
    const composing = await dispatchOmnichannelPresence({
      channel: 'telegram', metadata: BUSINESS_META, accountExternalId: 'tgbot:7000000001',
      conversationExternalId: '4242', presence: 'composing',
    })
    expect(composing).toMatchObject({ ok: true })
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('/sendChatAction')
    expect(JSON.parse(String(init.body))).toEqual({ chat_id: '4242', action: 'typing' })
    fetchMock.mockClear()
    await dispatchOmnichannelPresence({
      channel: 'telegram', metadata: BUSINESS_META, accountExternalId: 'tgbot:7000000001',
      conversationExternalId: '4242', presence: 'paused',
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('sender configuration: business bot by account shape, client bot by token id; client bot is draft-only', () => {
    expect(isConfiguredOmnichannelSender({ channel: 'telegram', metadata: BUSINESS_META, accountExternalId: 'tgbot:7000000001' })).toBe(true)
    expect(isConfiguredOmnichannelSender({ channel: 'telegram', metadata: CLIENT_META, accountExternalId: 'tgclient:6000000002' })).toBe(true)
    expect(isConfiguredOmnichannelSender({ channel: 'telegram', metadata: CLIENT_META, accountExternalId: 'tgclient:1' })).toBe(false)
    delete process.env.SECRETS_ENCRYPTION_KEY
    expect(isConfiguredOmnichannelSender({ channel: 'telegram', metadata: BUSINESS_META, accountExternalId: 'tgbot:7000000001' })).toBe(false)
    expect(isDraftOnlyOmnichannelTransport('telegram', CLIENT_META)).toBe(true)
    expect(isDraftOnlyOmnichannelTransport('telegram', BUSINESS_META)).toBe(false)
  })
})

describe('telegram guardrails (no 24-hour window)', () => {
  const now = '2026-10-16T12:00:00.000Z'
  const threeDaysAgo = '2026-10-13T12:00:00.000Z'

  it('allows automated and manual sends long after the last inbound', () => {
    expect(getSendWindow({ channel: 'telegram', lastInboundAt: threeDaysAgo, now, actor: 'automated' }))
      .toMatchObject({ allowed: true, reason: 'telegram_no_reply_window' })
    expect(getSendWindow({ channel: 'telegram', lastInboundAt: threeDaysAgo, now, actor: 'manual' }).allowed).toBe(true)
    // WhatsApp keeps its template rule for the same age.
    expect(getSendWindow({ channel: 'whatsapp', lastInboundAt: threeDaysAgo, now, actor: 'manual' }).mode).toBe('template_required')
  })

  it('still refuses future timestamps, and automated sends without a trusted inbound time', () => {
    expect(getSendWindow({ channel: 'telegram', lastInboundAt: '2026-10-16T13:00:00.000Z', now, actor: 'manual' }).allowed).toBe(false)
    expect(getSendWindow({ channel: 'telegram', lastInboundAt: null, now, actor: 'automated' }).allowed).toBe(false)
    expect(getSendWindow({ channel: 'telegram', lastInboundAt: null, now, actor: 'manual' }).allowed).toBe(true)
  })

  it('auto / draft / off and opt-out decisions apply to telegram as to any channel', () => {
    const base = {
      conversationStatus: 'open' as const,
      answer: 'Отлично! Что вас интересует?',
      confidence: 0.92,
      threshold: 0.75,
      risk: 'low' as const,
      needsHuman: false,
      isNewestInbound: true,
      sendWindow: getSendWindow({ channel: 'telegram', lastInboundAt: threeDaysAgo, now, actor: 'automated' }),
      deterministicRisk: detectDeterministicRisk('Астана'),
    }
    expect(decideReplyPolicy({ ...base, mode: 'auto' }).action).toBe('send')
    expect(decideReplyPolicy({ ...base, mode: 'draft' }).action).toBe('draft')
    expect(decideReplyPolicy({ ...base, mode: 'off' }).action).toBe('ignore')
    expect(decideReplyPolicy({ ...base, mode: 'auto', confidence: 0.5 }).action).toBe('draft')
    for (const text of ['/stop', 'стоп', 'Стоп, не пишите']) {
      expect(detectDeterministicRisk(text).optOut).toBe(true)
      expect(decideReplyPolicy({ ...base, mode: 'auto', deterministicRisk: detectDeterministicRisk(text) }))
        .toEqual({ action: 'ignore', reason: 'customer_opted_out' })
    }
  })
})

describe('telegram auto readiness (UI-independent)', () => {
  const base = { channel: 'telegram' as const, enabled: true, mode: 'auto' as const, metaConfigured: true }
  it('needs the business bot connected AND a business context', () => {
    expect(getOmnichannelAutoReplyReadiness({ ...base, businessContext: 'Honor Group', telegramBotConnected: true }))
      .toEqual({ ready: true, missing: [] })
    // Meta credentials never make Telegram ready.
    expect(getOmnichannelAutoReplyReadiness({ ...base, businessContext: 'Honor Group', telegramBotConnected: false }).missing)
      .toEqual(['provider_configuration'])
    expect(getOmnichannelAutoReplyReadiness({ ...base, businessContext: '  ', telegramBotConnected: true }).missing)
      .toEqual(['business_context'])
  })
})
