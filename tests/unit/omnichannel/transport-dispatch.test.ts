import { beforeEach, describe, expect, it, vi } from 'vitest'

const meta = vi.hoisted(() => ({
  createClient: vi.fn(),
  configured: vi.fn(),
  sendInstagramText: vi.fn(),
  sendInstagramQuickReplies: vi.fn(),
  sendWhatsAppText: vi.fn(),
  sendWhatsAppList: vi.fn(),
}))
const web = vi.hoisted(() => ({
  createClient: vi.fn(),
  configured: vi.fn(),
  sendPresence: vi.fn(),
  sendText: vi.fn(),
}))

vi.mock('@/lib/omnichannel/meta-client', () => ({
  createMetaClient: meta.createClient,
  isConfiguredMetaAccount: meta.configured,
}))
vi.mock('@/lib/omnichannel/whatsapp-web-client', () => ({
  createWhatsAppWebClient: web.createClient,
  isConfiguredWhatsAppWebAccount: web.configured,
}))

import {
  dispatchOmnichannelPresence,
  dispatchOmnichannelReply,
  isConfiguredOmnichannelSender,
  resolveOmnichannelTransport,
} from '@/lib/omnichannel/transport-dispatch'

describe('omnichannel transport dispatch', () => {
  beforeEach(() => {
    vi.unstubAllEnvs()
    vi.resetAllMocks()
    meta.configured.mockReturnValue(true)
    web.configured.mockReturnValue(true)
    meta.createClient.mockReturnValue({
      sendInstagramText: meta.sendInstagramText,
      sendInstagramQuickReplies: meta.sendInstagramQuickReplies,
      sendWhatsAppText: meta.sendWhatsAppText,
      sendWhatsAppList: meta.sendWhatsAppList,
    })
    web.createClient.mockReturnValue({
      sendPresence: web.sendPresence,
      sendText: web.sendText,
    })
    meta.sendWhatsAppList.mockResolvedValue({ ok: true, externalMessageId: 'wamid.list' })
    web.sendText.mockResolvedValue({ ok: true, externalMessageId: 'waweb:primary:out-1' })
    web.sendPresence.mockResolvedValue({ ok: true, rawStatus: 200 })
  })

  it('keeps legacy rows on their original Meta transports and rejects cross-channel declarations', () => {
    expect(resolveOmnichannelTransport('instagram', {})).toBe('instagram_graph')
    expect(resolveOmnichannelTransport('whatsapp', {})).toBe('whatsapp_cloud')
    expect(resolveOmnichannelTransport('instagram', { transport: 'whatsapp_web' })).toBeNull()
    expect(resolveOmnichannelTransport('whatsapp', { transport: 'instagram_graph' })).toBeNull()
  })

  it('checks a Web session with Web configuration rather than Meta account configuration', () => {
    expect(isConfiguredOmnichannelSender({
      channel: 'whatsapp',
      metadata: { transport: 'whatsapp_web' },
      accountExternalId: 'waweb:primary',
    })).toBe(true)
    expect(web.configured).toHaveBeenCalledWith('waweb:primary')
    expect(meta.configured).not.toHaveBeenCalled()
  })

  it('falls back to Meta Cloud for legacy rows and preserves the interactive list', async () => {
    await expect(dispatchOmnichannelReply({
      channel: 'whatsapp',
      metadata: {},
      accountExternalId: 'cloud-phone-id',
      conversationExternalId: '77001234567',
      contactExternalId: '77001234567',
      text: 'Выберите вариант',
      actor: 'automated',
      replyToExternalId: 'wamid.in',
      idempotencyKey: 'omnichannel:auto:message-1',
      choices: {
        buttonText: 'Выбрать',
        sectionTitle: 'Экипировка',
        options: [{ id: 'summer', title: 'Да, на лето' }],
      },
    })).resolves.toMatchObject({ ok: true, externalMessageId: 'wamid.list' })

    expect(meta.sendWhatsAppList).toHaveBeenCalledWith(expect.objectContaining({
      recipientId: '77001234567',
      options: [{ id: 'summer', title: 'Да, на лето' }],
    }))
    expect(meta.createClient).toHaveBeenCalledTimes(1)
    expect(web.sendText).not.toHaveBeenCalled()
  })

  it('degrades Web choices to the already-rendered plain text and uses the conversation JID', async () => {
    await expect(dispatchOmnichannelReply({
      channel: 'whatsapp',
      metadata: {
        transport: 'whatsapp_web',
        bridgeSessionId: 'primary',
        bridgeMessageId: 'raw-in-1',
      },
      accountExternalId: 'waweb:primary',
      conversationExternalId: '77001234567@s.whatsapp.net',
      contactExternalId: '77001234567',
      text: 'Выберите:\n1. Да, на лето\n2. Да, осень-зима',
      actor: 'automated',
      replyToExternalId: 'waweb:primary:raw-in-1',
      idempotencyKey: 'omnichannel:auto:message-1',
      choices: {
        options: [{ id: 'summer', title: 'Да, на лето' }],
      },
    })).resolves.toMatchObject({ ok: true, externalMessageId: 'waweb:primary:out-1' })

    expect(web.sendText).toHaveBeenCalledWith({
      recipientId: '77001234567@s.whatsapp.net',
      text: 'Выберите:\n1. Да, на лето\n2. Да, осень-зима',
      accountExternalId: 'waweb:primary',
      replyToExternalId: 'raw-in-1',
      idempotencyKey: 'omnichannel:auto:message-1',
    })
    expect(meta.createClient).not.toHaveBeenCalled()
  })

  it('rejects a missing idempotency key before selecting either provider client', async () => {
    await expect(dispatchOmnichannelReply({
      channel: 'whatsapp',
      metadata: { transport: 'whatsapp_web' },
      accountExternalId: 'waweb:primary',
      conversationExternalId: '77001234567@s.whatsapp.net',
      contactExternalId: '77001234567',
      text: 'Добрый день',
      actor: 'automated',
      idempotencyKey: '   ',
    })).resolves.toMatchObject({
      ok: false,
      code: 'invalid_input',
      retryable: false,
    })

    expect(web.createClient).not.toHaveBeenCalled()
    expect(meta.createClient).not.toHaveBeenCalled()
  })

  it('fails closed instead of falling back to direct delivery for an invalid mode', async () => {
    vi.stubEnv('WHATSAPP_WEB_DELIVERY_MODE', 'pul')

    expect(isConfiguredOmnichannelSender({
      channel: 'whatsapp',
      metadata: { transport: 'whatsapp_web' },
      accountExternalId: 'waweb:primary',
    })).toBe(false)
    await expect(dispatchOmnichannelReply({
      channel: 'whatsapp',
      metadata: { transport: 'whatsapp_web' },
      accountExternalId: 'waweb:primary',
      conversationExternalId: '77001234567@s.whatsapp.net',
      contactExternalId: '77001234567',
      text: 'Добрый день',
      actor: 'automated',
      idempotencyKey: 'omnichannel:auto:message-1',
    })).resolves.toMatchObject({
      ok: false,
      code: 'invalid_delivery_mode',
      retryable: false,
    })
    expect(web.createClient).not.toHaveBeenCalled()
  })

  it('does not accept pull jobs when the matching Postgres runtime is unavailable', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('WHATSAPP_WEB_DELIVERY_MODE', 'pull')
    vi.stubEnv('WHATSAPP_WEB_BRIDGE_ENABLED', 'true')
    vi.stubEnv('WHATSAPP_WEB_BRIDGE_SESSION_ID', 'primary')
    vi.stubEnv('OMNICHANNEL_PERSISTENCE', 'postgres')
    vi.stubEnv('OMNICHANNEL_DATABASE_URL', '')

    expect(isConfiguredOmnichannelSender({
      channel: 'whatsapp',
      metadata: { transport: 'whatsapp_web' },
      accountExternalId: 'waweb:primary',
    })).toBe(false)
    await expect(dispatchOmnichannelReply({
      channel: 'whatsapp',
      metadata: { transport: 'whatsapp_web' },
      accountExternalId: 'waweb:primary',
      conversationExternalId: '77001234567@s.whatsapp.net',
      contactExternalId: '77001234567',
      text: 'Добрый день',
      actor: 'automated',
      idempotencyKey: 'omnichannel:auto:message-1',
    })).resolves.toMatchObject({
      ok: false,
      code: 'outbound_pull_unavailable',
      retryable: false,
    })
    expect(web.createClient).not.toHaveBeenCalled()
  })

  it('forwards transient presence only to the WhatsApp Web conversation JID', async () => {
    await expect(dispatchOmnichannelPresence({
      channel: 'whatsapp',
      metadata: { transport: 'whatsapp_web' },
      accountExternalId: 'waweb:primary',
      conversationExternalId: '77001234567@s.whatsapp.net',
      presence: 'composing',
    })).resolves.toEqual({ ok: true, rawStatus: 200 })

    expect(web.sendPresence).toHaveBeenCalledWith({
      recipientId: '77001234567@s.whatsapp.net',
      accountExternalId: 'waweb:primary',
      presence: 'composing',
    })
  })

  it('does not create a Web client for Cloud or Instagram presence', async () => {
    await expect(dispatchOmnichannelPresence({
      channel: 'whatsapp',
      metadata: { transport: 'whatsapp_cloud' },
      accountExternalId: 'cloud-id',
      conversationExternalId: '77001234567',
      presence: 'composing',
    })).resolves.toBeNull()

    await expect(dispatchOmnichannelPresence({
      channel: 'instagram',
      metadata: { transport: 'instagram_graph' },
      accountExternalId: 'ig-id',
      conversationExternalId: 'ig-user',
      presence: 'paused',
    })).resolves.toBeNull()

    expect(web.createClient).not.toHaveBeenCalled()
  })
})
