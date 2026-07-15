import { describe, expect, it, vi } from 'vitest'
import {
  createMetaClient,
  getMetaConfigurationHealth,
  type MetaEnvironment,
  type MetaFetch,
} from '@/lib/omnichannel/meta-client'

const env: MetaEnvironment = {
  INSTAGRAM_ACCESS_TOKEN: 'ig-super-secret',
  INSTAGRAM_ACCOUNT_ID: 'ig-account-123',
  WHATSAPP_TOKEN: 'wa-super-secret',
  WHATSAPP_PHONE_NUMBER_ID: 'wa-phone-456',
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('MetaClient configuration', () => {
  it('defaults to Graph API v25.0 and never exposes token values in health output', () => {
    const health = getMetaConfigurationHealth({ env })

    expect(health).toMatchObject({
      graphApiVersion: 'v25.0',
      instagram: { configured: true, missing: [] },
      whatsapp: { configured: true, missing: [] },
    })
    const serialized = JSON.stringify(health)
    expect(serialized).not.toContain(env.INSTAGRAM_ACCESS_TOKEN)
    expect(serialized).not.toContain(env.WHATSAPP_TOKEN)
  })

  it('reports missing variable names without any secret-shaped fields', () => {
    expect(getMetaConfigurationHealth({ env: {} })).toMatchObject({
      instagram: {
        configured: false,
        missing: ['INSTAGRAM_ACCESS_TOKEN', 'INSTAGRAM_ACCOUNT_ID'],
      },
      whatsapp: {
        configured: false,
        missing: ['WHATSAPP_TOKEN', 'WHATSAPP_PHONE_NUMBER_ID'],
      },
    })
  })
})

describe('MetaClient Instagram text sends', () => {
  it('uses graph.instagram.com, Bearer auth, and omits HUMAN_AGENT for automation', async () => {
    const fetchMock = vi.fn<MetaFetch>(async () =>
      jsonResponse({ recipient_id: 'contact-1', message_id: 'ig-message-1' }),
    )
    const client = createMetaClient({ env, fetch: fetchMock })

    const result = await client.sendInstagramText({
      recipientId: 'contact-1',
      text: 'Здравствуйте!',
      actor: 'automated',
      useHumanAgent: true,
    })

    expect(result).toEqual({ ok: true, externalMessageId: 'ig-message-1', rawStatus: 200 })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toBe(
      'https://graph.instagram.com/v25.0/ig-account-123/messages',
    )
    expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer ig-super-secret')
    expect(JSON.parse(String(init?.body))).toEqual({
      recipient: { id: 'contact-1' },
      message: { text: 'Здравствуйте!' },
    })
  })

  it('adds HUMAN_AGENT only for an explicitly manual send', async () => {
    const fetchMock = vi.fn<MetaFetch>(async () => jsonResponse({ message_id: 'ig-manual-1' }))
    const client = createMetaClient({ env, fetch: fetchMock })

    await client.sendInstagramText({
      recipientId: 'contact-2',
      text: 'Отвечает оператор',
      actor: 'manual',
      useHumanAgent: true,
    })

    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toMatchObject({
      tag: 'HUMAN_AGENT',
    })
  })

  it('sends five deterministic Instagram quick replies with canonical payloads', async () => {
    const fetchMock = vi.fn<MetaFetch>(async () => jsonResponse({ message_id: 'ig-quick-1' }))
    const client = createMetaClient({ env, fetch: fetchMock })

    const result = await client.sendInstagramQuickReplies({
      recipientId: 'contact-3',
      text: 'Выберите вариант:\n1. Да, на лето',
      actor: 'automated',
      options: [
        { id: 'equipment_v1:interest:summer', title: 'Да, на лето' },
        { id: 'equipment_v1:interest:autumn_winter', title: 'Да, осень-зима' },
        { id: 'equipment_v1:interest:catalog', title: 'Открыть каталог' },
        { id: 'equipment_v1:interest:beginner', title: 'Я-новичок' },
        { id: 'equipment_v1:interest:manager', title: 'Позовите менеджера' },
      ],
    })

    expect(result).toEqual({ ok: true, externalMessageId: 'ig-quick-1', rawStatus: 200 })
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({
      recipient: { id: 'contact-3' },
      message: {
        text: 'Выберите вариант:\n1. Да, на лето',
        quick_replies: [
          { content_type: 'text', title: 'Да, на лето', payload: 'equipment_v1:interest:summer' },
          { content_type: 'text', title: 'Да, осень-зима', payload: 'equipment_v1:interest:autumn_winter' },
          { content_type: 'text', title: 'Открыть каталог', payload: 'equipment_v1:interest:catalog' },
          { content_type: 'text', title: 'Я-новичок', payload: 'equipment_v1:interest:beginner' },
          { content_type: 'text', title: 'Позовите менеджера', payload: 'equipment_v1:interest:manager' },
        ],
      },
    })
  })
})

describe('MetaClient WhatsApp text sends', () => {
  it('fails closed before fetch when the conversation belongs to another phone id', async () => {
    const fetchMock = vi.fn<MetaFetch>()
    const client = createMetaClient({ env, fetchImpl: fetchMock })

    await expect(client.sendWhatsAppText({
      recipientId: '77001234567',
      text: 'Добрый день!',
      accountExternalId: 'another-phone-id',
    })).resolves.toMatchObject({
      ok: false,
      code: 'account_configuration_mismatch',
      retryable: false,
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('uses graph.facebook.com and includes reply context when supplied', async () => {
    const fetchMock = vi.fn<MetaFetch>(async () =>
      jsonResponse({ messages: [{ id: 'wamid.abc' }] }),
    )
    const client = createMetaClient({ env, fetchImpl: fetchMock })

    const result = await client.sendWhatsAppText({
      recipientId: '77001234567',
      text: 'Добрый день!',
      replyToExternalId: 'wamid.inbound',
    })

    expect(result).toEqual({ ok: true, externalMessageId: 'wamid.abc', rawStatus: 200 })
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toBe(
      'https://graph.facebook.com/v25.0/wa-phone-456/messages',
    )
    expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer wa-super-secret')
    expect(JSON.parse(String(init?.body))).toEqual({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: '77001234567',
      type: 'text',
      text: { body: 'Добрый день!', preview_url: false },
      context: { message_id: 'wamid.inbound' },
    })
  })

  it('uses a WhatsApp interactive list for five equipment choices', async () => {
    const fetchMock = vi.fn<MetaFetch>(async () =>
      jsonResponse({ messages: [{ id: 'wamid.list-1' }] }),
    )
    const client = createMetaClient({ env, fetchImpl: fetchMock })

    const result = await client.sendWhatsAppList({
      recipientId: '77001234567',
      text: 'Выберите вариант',
      replyToExternalId: 'wamid.inbound',
      buttonText: 'Выбрать',
      sectionTitle: 'Экипировка',
      options: [
        { id: 'equipment_v1:interest:summer', title: 'Да, на лето' },
        { id: 'equipment_v1:interest:autumn_winter', title: 'Да, осень-зима' },
        { id: 'equipment_v1:interest:catalog', title: 'Открыть каталог', description: 'Хочу ознакомиться с каталогом' },
        { id: 'equipment_v1:interest:beginner', title: 'Я-новичок' },
        { id: 'equipment_v1:interest:manager', title: 'Позовите менеджера' },
      ],
    })

    expect(result).toEqual({ ok: true, externalMessageId: 'wamid.list-1', rawStatus: 200 })
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: '77001234567',
      type: 'interactive',
      interactive: {
        type: 'list',
        body: { text: 'Выберите вариант' },
        action: {
          button: 'Выбрать',
          sections: [{
            title: 'Экипировка',
            rows: [
              { id: 'equipment_v1:interest:summer', title: 'Да, на лето' },
              { id: 'equipment_v1:interest:autumn_winter', title: 'Да, осень-зима' },
              { id: 'equipment_v1:interest:catalog', title: 'Открыть каталог', description: 'Хочу ознакомиться с каталогом' },
              { id: 'equipment_v1:interest:beginner', title: 'Я-новичок' },
              { id: 'equipment_v1:interest:manager', title: 'Позовите менеджера' },
            ],
          }],
        },
      },
      context: { message_id: 'wamid.inbound' },
    })
  })
})

describe('MetaClient failure handling', () => {
  it('parses Graph errors and redacts configured tokens from returned text', async () => {
    const fetchMock = vi.fn<MetaFetch>(async () =>
      jsonResponse(
        {
          error: {
            message: 'Invalid OAuth access token: ig-super-secret',
            type: 'OAuthException',
            code: 190,
          },
        },
        401,
      ),
    )
    const client = createMetaClient({ env, fetch: fetchMock })

    const result = await client.sendInstagramText({
      recipientId: 'contact-1',
      text: 'hello',
      actor: 'automated',
    })

    expect(result).toEqual({
      ok: false,
      status: 401,
      code: '190',
      message: 'Invalid OAuth access token: [REDACTED]',
      retryable: false,
    })
    expect(JSON.stringify(result)).not.toContain('ig-super-secret')
  })

  it('turns an aborted request into a retryable timeout without throwing', async () => {
    const fetchMock: MetaFetch = async (_url, init) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          const error = new Error('aborted with wa-super-secret')
          error.name = 'AbortError'
          reject(error)
        })
      })
    const client = createMetaClient({ env, fetch: fetchMock, timeoutMs: 5 })

    await expect(
      client.sendWhatsAppText({ recipientId: '77001234567', text: 'hello' }),
    ).resolves.toEqual({
      ok: false,
      status: null,
      code: 'timeout',
      message: 'Meta API request timed out after 5ms',
      retryable: true,
    })
  })
})
