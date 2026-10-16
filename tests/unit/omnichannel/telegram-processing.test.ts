/**
 * The shared processor with Telegram conversations: business-bot auto reply
 * shows "typing…" during the human-like delay and sends via Bot API; the
 * platform client bot is draft-only even in «Авто»; old messages are not
 * blocked by a 24-hour window.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const repository = vi.hoisted(() => ({
  claimEquipmentFlowForAutoSend: vi.fn(),
  claimMessageForAutoSend: vi.fn(),
  finalizeEquipmentFlowReply: vi.fn(),
  getMessageContext: vi.fn(),
  logOutboundMessage: vi.fn(),
  markMessageDrafted: vi.fn(),
  markMessageFailed: vi.fn(),
  markMessageIgnored: vi.fn(),
  markMessageNeedsHuman: vi.fn(),
  markMessageProcessing: vi.fn(),
  markMessageReplied: vi.fn(),
  markMessageSuperseded: vi.fn(),
  persistAiAnalysis: vi.fn(),
}))
const ai = vi.hoisted(() => ({ generateOmnichannelReply: vi.fn() }))
const conn = vi.hoisted(() => ({ token: '7000000001:AAHk3Q0123456789abcdefghijABCDEFGHIJ_-x' as string | null }))

vi.mock('@/lib/omnichannel/repository', () => repository)
vi.mock('@/lib/omnichannel/ai', () => ai)
vi.mock('@/lib/omnichannel/telegram-connections', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/omnichannel/telegram-connections')>()
  return { ...actual, getActiveTelegramBotToken: vi.fn(async () => conn.token) }
})

import { processOmnichannelMessage } from '@/lib/functions/process-omnichannel-message'

const CLIENT_TOKEN = '6000000002:AAHk3Q0123456789abcdefghijABCDEFGHIJ_-y'
const recent = new Date(Date.now() - 60_000).toISOString()
const threeDaysAgo = new Date(Date.now() - 3 * 86_400_000).toISOString()

function context(source: 'business' | 'client', overrides: { mode?: string; occurredAt?: string } = {}) {
  const account = source === 'business' ? 'tgbot:7000000001' : 'tgclient:6000000002'
  const message = {
    id: 'message-1',
    conversationId: 'conversation-1',
    channel: 'telegram',
    externalMessageId: `${account}:4242:5`,
    direction: 'in',
    messageType: 'text',
    text: 'Подскажите, есть зимние куртки?',
    status: 'received',
    replyToExternalId: null,
    aiDraft: null,
    aiConfidence: null,
    aiReason: null,
    aiGenerated: false,
    metadata: {
      providerTimestampTrusted: true,
      transport: source === 'business' ? 'telegram_bot' : 'telegram_client_bot',
      telegramSource: source === 'business' ? 'business_bot' : 'client_bot',
    },
    occurredAt: overrides.occurredAt ?? recent,
    processedAt: null,
  }
  return {
    message,
    conversation: {
      id: 'conversation-1', channel: 'telegram', accountExternalId: account, externalId: '4242',
      contactId: 'contact-1', status: 'open', autoReplyOverride: null, sendSuppressed: false,
      suppressionReason: null, suppressedAt: null, intent: null, sentiment: null, leadScore: null,
      summary: null, lastMessageAt: recent, lastInboundAt: recent, lastOutboundAt: null, metadata: {},
    },
    contact: {
      id: 'contact-1', channel: 'telegram', externalId: `${account}:4242`, displayName: 'Ерлан',
      username: null, phone: null, metadata: {}, firstSeenAt: recent, lastSeenAt: recent,
    },
    settings: {
      channel: 'telegram', mode: overrides.mode ?? 'auto', enabled: true,
      businessContext: 'Honor Group: экипировка для охоты и рыбалки.', automationConfig: {},
      confidenceThreshold: 0.75, replyDelaySeconds: 0, updatedAt: recent,
    },
    history: [message],
    newestInboundMessageId: message.id,
  }
}

function fakeStep() {
  return {
    run: vi.fn(async (_name: string, callback: () => unknown) => callback()),
    sleep: vi.fn(async () => undefined),
    sleepUntil: vi.fn(async () => undefined),
    sendEvent: vi.fn(async () => undefined),
  }
}

async function invoke(step = fakeStep()) {
  const handler = (processOmnichannelMessage as unknown as { fn: (input: unknown) => Promise<unknown> }).fn
  return handler({ event: { data: { message_id: 'message-1', conversation_id: 'conversation-1' } }, step })
}

const env = { ...process.env }
let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  vi.resetAllMocks()
  conn.token = '7000000001:AAHk3Q0123456789abcdefghijABCDEFGHIJ_-x'
  process.env.SECRETS_ENCRYPTION_KEY = 'b'.repeat(64)
  process.env.TELEGRAM_BOT_TOKEN = CLIENT_TOKEN
  repository.markMessageProcessing.mockResolvedValue(true)
  repository.claimMessageForAutoSend.mockResolvedValue({ claimed: true, reason: 'claimed' })
  repository.logOutboundMessage.mockResolvedValue('out-1')
  ai.generateOmnichannelReply.mockResolvedValue({
    answer: 'Да, есть. Из какого вы города?',
    intent: 'lead', sentiment: 'neutral', language: 'ru', confidence: 0.93, risk: 'low',
    needs_human: false, reason: 'safe_product_question', lead_score: 70,
    conversation_summary: 'Клиент ищет зимнюю куртку.', grounding: 'business_context', business_facts_used: [],
  })
  fetchMock = vi.fn(async (url: string) => {
    const method = String(url).split('/').pop()
    return new Response(JSON.stringify({ ok: true, result: method === 'sendMessage' ? { message_id: 9001 } : true }), { status: 200 })
  })
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => {
  vi.unstubAllGlobals()
  process.env = { ...env }
})

describe('telegram through the shared processor', () => {
  it('business bot «Авто»: typing during the human-like delay, then sendMessage', async () => {
    repository.getMessageContext.mockResolvedValue(context('business'))
    const step = fakeStep()
    await expect(invoke(step)).resolves.toMatchObject({
      action: 'send', channel: 'telegram', external_message_id: 'tgbot:7000000001:4242:9001',
    })
    const methods = fetchMock.mock.calls.map(([url]) => String(url).split('/').pop())
    expect(methods).toEqual(['sendChatAction', 'sendMessage'])
    expect(step.sleep).toHaveBeenCalledWith('human-whatsapp-typing-delay', expect.stringMatching(/^[2-6]s$/))
    expect(repository.logOutboundMessage).toHaveBeenCalledWith(expect.objectContaining({
      channel: 'telegram',
      externalMessageId: 'tgbot:7000000001:4242:9001',
      aiGenerated: true,
      metadata: expect.objectContaining({ transport: 'telegram_bot' }),
    }))
    expect(repository.markMessageReplied).toHaveBeenCalled()
  })

  it('a message older than 24 hours is still answered (no Meta window for Telegram)', async () => {
    repository.getMessageContext.mockResolvedValue(context('business', { occurredAt: threeDaysAgo }))
    await expect(invoke()).resolves.toMatchObject({ action: 'send' })
  })

  it('«Черновик» only drafts', async () => {
    repository.getMessageContext.mockResolvedValue(context('business', { mode: 'draft' }))
    await expect(invoke()).resolves.toMatchObject({ action: 'draft' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('the platform client bot is draft-only even in «Авто»', async () => {
    repository.getMessageContext.mockResolvedValue(context('client'))
    await expect(invoke()).resolves.toMatchObject({ action: 'draft' })
    expect(repository.markMessageDrafted).toHaveBeenCalledWith('message-1', expect.objectContaining({
      draft: 'Да, есть. Из какого вы города?',
    }))
    expect(fetchMock).not.toHaveBeenCalled()
    expect(repository.claimMessageForAutoSend).not.toHaveBeenCalled()
  })

  it('a disconnected business bot escalates to a person instead of losing the answer', async () => {
    conn.token = null
    repository.getMessageContext.mockResolvedValue(context('business'))
    await expect(invoke()).resolves.toMatchObject({ action: 'escalate' })
    expect(repository.markMessageNeedsHuman).toHaveBeenCalledWith('message-1', 'conversation-1', expect.objectContaining({
      reason: expect.stringContaining('telegram_bot_not_connected'),
    }))
  })
})
