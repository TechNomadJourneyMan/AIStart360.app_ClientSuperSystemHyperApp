import { describe, expect, it, vi } from 'vitest'
import {
  createWhatsAppWebClient,
  getWhatsAppWebBridgeConfigurationHealth,
  type WhatsAppWebBridgeEnvironment,
  type WhatsAppWebBridgeFetch,
} from '@/lib/omnichannel/whatsapp-web-client'
import {
  verifySignedBridgeRequest,
  WHATSAPP_WEB_BRIDGE_AUDIENCE,
} from '@/lib/omnichannel/whatsapp-web-signature'

const env: WhatsAppWebBridgeEnvironment = {
  NODE_ENV: 'test',
  WHATSAPP_WEB_BRIDGE_ENABLED: 'true',
  WHATSAPP_WEB_BRIDGE_URL: 'https://bridge.example.test/internal',
  WHATSAPP_WEB_BRIDGE_SESSION_ID: 'primary',
  WHATSAPP_WEB_BRIDGE_API_SECRET: 'bridge-outbound-secret-0123456789abcdef',
  WHATSAPP_WEB_BRIDGE_WEBHOOK_SECRET: 'portal-inbound-secret-0123456789abcdef',
  WHATSAPP_WEB_BRIDGE_API_KEY_ID: 'outbound-v1',
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('WhatsAppWebClient', () => {
  it('stays fail-closed when the experimental feature flag is disabled', async () => {
    const fetchMock = vi.fn<WhatsAppWebBridgeFetch>()
    const disabledEnv = {
      ...env,
      WHATSAPP_WEB_BRIDGE_ENABLED: 'false',
    }
    const client = createWhatsAppWebClient({ env: disabledEnv, fetchImpl: fetchMock })

    expect(client.getConfigurationHealth()).toMatchObject({
      enabled: false,
      configured: false,
      missing: expect.arrayContaining(['WHATSAPP_WEB_BRIDGE_ENABLED']),
    })
    await expect(client.sendText({
      recipientId: '77001234567@s.whatsapp.net',
      text: 'hello',
      accountExternalId: 'waweb:primary',
      idempotencyKey: 'omnichannel:auto:message-1',
    })).resolves.toMatchObject({
      ok: false,
      code: 'configuration_error',
      retryable: false,
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('reports configuration presence without exposing a URL or secret', () => {
    const health = getWhatsAppWebBridgeConfigurationHealth(env)

    expect(health).toEqual({
      enabled: true,
      configured: true,
      missing: [],
      sessionIdConfigured: true,
      accountExternalId: 'waweb:primary',
    })
    expect(JSON.stringify(health)).not.toContain('bridge-outbound-secret')
    expect(JSON.stringify(health)).not.toContain('bridge.example.test')
  })

  it('requires two different secrets of at least 32 bytes', () => {
    const shared = 'same-secret-0123456789abcdef012345'
    expect(getWhatsAppWebBridgeConfigurationHealth({
      ...env,
      WHATSAPP_WEB_BRIDGE_API_SECRET: shared,
      WHATSAPP_WEB_BRIDGE_WEBHOOK_SECRET: shared,
    })).toMatchObject({
      configured: false,
      missing: expect.arrayContaining(['WHATSAPP_WEB_BRIDGE_SECRETS_MUST_DIFFER']),
    })
    expect(getWhatsAppWebBridgeConfigurationHealth({
      ...env,
      WHATSAPP_WEB_BRIDGE_API_SECRET: 'short',
    })).toMatchObject({
      configured: false,
      missing: expect.arrayContaining(['WHATSAPP_WEB_BRIDGE_API_SECRET']),
    })
  })

  it('sends signed JSON with a mandatory idempotency key and namespaces the result id', async () => {
    const fetchMock = vi.fn<WhatsAppWebBridgeFetch>(async (_url, init) => {
      const rawBody = String(init?.body)
      const verification = verifySignedBridgeRequest({
        method: 'POST',
        path: '/internal/v1/sessions/primary/messages',
        body: rawBody,
        headers: new Headers(init?.headers),
        expectedAudience: WHATSAPP_WEB_BRIDGE_AUDIENCE,
        secrets: { 'outbound-v1': 'bridge-outbound-secret-0123456789abcdef' },
      })
      expect(verification.ok).toBe(true)
      return jsonResponse({ message_id: '3EB0ABC' })
    })
    const client = createWhatsAppWebClient({ env, fetchImpl: fetchMock })

    const result = await client.sendText({
      recipientId: '77001234567@s.whatsapp.net',
      text: 'Добрый день!',
      accountExternalId: 'waweb:primary',
      replyToExternalId: 'inbound-raw-1',
      idempotencyKey: 'omnichannel:auto:message-1',
    })

    expect(result).toEqual({
      ok: true,
      externalMessageId: 'waweb:primary:3EB0ABC',
      rawStatus: 200,
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toBe('https://bridge.example.test/internal/v1/sessions/primary/messages')
    expect(new Headers(init?.headers).get('Idempotency-Key')).toBe(
      'omnichannel:auto:message-1',
    )
    expect(JSON.parse(String(init?.body))).toEqual({
      to: '77001234567@s.whatsapp.net',
      type: 'text',
      text: 'Добрый день!',
      idempotency_key: 'omnichannel:auto:message-1',
      reply_to_message_id: 'inbound-raw-1',
    })
  })

  it.each(['composing', 'paused'] as const)(
    'sends signed %s presence without a message idempotency key',
    async (presence) => {
      const fetchMock = vi.fn<WhatsAppWebBridgeFetch>(async (_url, init) => {
        const rawBody = String(init?.body)
        const verification = verifySignedBridgeRequest({
          method: 'POST',
          path: '/internal/v1/sessions/primary/presence',
          body: rawBody,
          headers: new Headers(init?.headers),
          expectedAudience: WHATSAPP_WEB_BRIDGE_AUDIENCE,
          secrets: { 'outbound-v1': 'bridge-outbound-secret-0123456789abcdef' },
        })
        expect(verification.ok).toBe(true)
        return jsonResponse({ ok: true, presence })
      })
      const client = createWhatsAppWebClient({ env, fetchImpl: fetchMock })

      const result = await client.sendPresence({
        recipientId: '77001234567@s.whatsapp.net',
        accountExternalId: 'waweb:primary',
        presence,
      })

      expect(result).toEqual({ ok: true, rawStatus: 200 })
      expect(fetchMock).toHaveBeenCalledTimes(1)
      const [url, init] = fetchMock.mock.calls[0]
      expect(String(url)).toBe(
        'https://bridge.example.test/internal/v1/sessions/primary/presence',
      )
      expect(new Headers(init?.headers).get('Idempotency-Key')).toBeNull()
      expect(JSON.parse(String(init?.body))).toEqual({
        to: '77001234567@s.whatsapp.net',
        presence,
      })
    },
  )

  it('rejects invalid presence routing input before fetch', async () => {
    const fetchMock = vi.fn<WhatsAppWebBridgeFetch>()
    const client = createWhatsAppWebClient({ env, fetchImpl: fetchMock })

    await expect(client.sendPresence({
      recipientId: '77001234567@s.whatsapp.net',
      accountExternalId: 'waweb:other',
      presence: 'composing',
    })).resolves.toMatchObject({
      ok: false,
      code: 'account_configuration_mismatch',
      retryable: false,
    })
    await expect(client.sendPresence({
      recipientId: '12345-678@g.us',
      accountExternalId: 'waweb:primary',
      presence: 'paused',
    })).resolves.toMatchObject({
      ok: false,
      code: 'invalid_input',
      retryable: false,
    })
    await expect(client.sendPresence({
      recipientId: '77001234567@s.whatsapp.net',
      accountExternalId: 'waweb:primary',
      presence: 'recording' as 'composing',
    })).resolves.toMatchObject({
      ok: false,
      code: 'invalid_input',
      retryable: false,
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('fails before fetch for another session or a non-1:1 JID', async () => {
    const fetchMock = vi.fn<WhatsAppWebBridgeFetch>()
    const client = createWhatsAppWebClient({ env, fetchImpl: fetchMock })

    await expect(client.sendText({
      recipientId: '77001234567@s.whatsapp.net',
      text: 'hello',
      accountExternalId: 'waweb:other',
      idempotencyKey: 'omnichannel:auto:message-1',
    })).resolves.toMatchObject({ ok: false, code: 'account_configuration_mismatch' })
    await expect(client.sendText({
      recipientId: '12345-678@g.us',
      text: 'hello',
      accountExternalId: 'waweb:primary',
      idempotencyKey: 'omnichannel:auto:message-1',
    })).resolves.toMatchObject({ ok: false, code: 'invalid_input' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('requires a stable idempotency key before making a network request', async () => {
    const fetchMock = vi.fn<WhatsAppWebBridgeFetch>()
    const client = createWhatsAppWebClient({ env, fetchImpl: fetchMock })

    await expect(client.sendText({
      recipientId: '77001234567@s.whatsapp.net',
      text: 'hello',
      accountExternalId: 'waweb:primary',
      idempotencyKey: '',
    })).resolves.toMatchObject({
      ok: false,
      code: 'invalid_input',
      retryable: false,
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('returns an ambiguous timeout result without retrying the bridge request', async () => {
    const fetchMock = vi.fn<WhatsAppWebBridgeFetch>(async (_url, init) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          const error = new Error('aborted')
          error.name = 'AbortError'
          reject(error)
        })
      }))
    const client = createWhatsAppWebClient({ env, fetchImpl: fetchMock, timeoutMs: 5 })

    await expect(client.sendText({
      recipientId: '77001234567@s.whatsapp.net',
      text: 'hello',
      accountExternalId: 'waweb:primary',
      idempotencyKey: 'omnichannel:auto:message-1',
    })).resolves.toMatchObject({
      ok: false,
      status: null,
      code: 'timeout',
      retryable: true,
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(new Headers(fetchMock.mock.calls[0][1]?.headers).get('Idempotency-Key')).toBe(
      'omnichannel:auto:message-1',
    )
  })

  it('does not reflect a bridge error body or secret to the caller', async () => {
    const fetchMock: WhatsAppWebBridgeFetch = async () => jsonResponse({
      error: {
        code: 'session_disconnected',
        message: 'bridge-outbound-secret leaked by provider',
      },
    }, 409)
    const client = createWhatsAppWebClient({ env, fetchImpl: fetchMock })

    const result = await client.sendText({
      recipientId: '77001234567@s.whatsapp.net',
      text: 'hello',
      accountExternalId: 'waweb:primary',
      idempotencyKey: 'omnichannel:auto:message-1',
    })

    expect(result).toMatchObject({
      ok: false,
      status: 409,
      code: 'session_disconnected',
      retryable: false,
    })
    expect(JSON.stringify(result)).not.toContain('bridge-outbound-secret')
  })
})
