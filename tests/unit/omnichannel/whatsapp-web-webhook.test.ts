import { describe, expect, it } from 'vitest'
import { parseWhatsAppWebBridgeEvent } from '@/lib/omnichannel/whatsapp-web-webhook'

const now = 1_750_000_000_000

function event(overrides: Record<string, unknown> = {}) {
  return {
    version: 1,
    event_id: 'event-12345678',
    event_type: 'message',
    session_id: 'primary',
    message: {
      id: 'MESSAGE123',
      remote_jid: 'opaque-lid-123@lid',
      push_name: 'Клиент',
      timestamp_ms: now - 1_000,
      text: 'Здравствуйте',
      message_type: 'text',
      live: true,
      from_me: false,
      ...overrides,
    },
  }
}

describe('WhatsApp Web bridge webhook parser', () => {
  it('keeps an opaque LID canonical without inventing a phone number', () => {
    const parsed = parseWhatsAppWebBridgeEvent(event(), now)
    expect(parsed?.message).toMatchObject({
      accountExternalId: 'waweb:primary',
      conversationExternalId: 'opaque-lid-123@lid',
      contactExternalId: 'waweb:primary:opaque-lid-123@lid',
      contactPhone: null,
      externalMessageId: 'waweb:primary:MESSAGE123',
      direction: 'in',
      status: 'received',
      metadata: { transport: 'whatsapp_web' },
    })
  })

  it('keeps the canonical LID but extracts a verified alternate phone', () => {
    const parsed = parseWhatsAppWebBridgeEvent(event({
      remote_jid_alt: '77011234567@s.whatsapp.net',
    }), now)
    expect(parsed?.message.conversationExternalId).toBe('opaque-lid-123@lid')
    expect(parsed?.message.contactPhone).toBe('77011234567')
  })

  it('accepts offline catch-up and preserves its safety metadata', () => {
    const parsed = parseWhatsAppWebBridgeEvent(event({ live: false }), now)

    expect(parsed?.live).toBe(false)
    expect(parsed?.message.metadata).toMatchObject({
      live: false,
      catchUp: true,
      offline: true,
      bridgeUpsertType: 'append',
    })
  })

  it('marks a notify event as live rather than catch-up', () => {
    const parsed = parseWhatsAppWebBridgeEvent(event(), now)

    expect(parsed?.live).toBe(true)
    expect(parsed?.message.metadata).toMatchObject({
      live: true,
      catchUp: false,
      offline: false,
      bridgeUpsertType: 'notify',
    })
  })

  it('fails closed for groups, self messages and future timestamps', () => {
    expect(parseWhatsAppWebBridgeEvent(event({ remote_jid: '123@g.us' }), now)).toBeNull()
    expect(parseWhatsAppWebBridgeEvent(event({ from_me: true }), now)).toBeNull()
    expect(parseWhatsAppWebBridgeEvent(event({ timestamp_ms: now + 5 * 60_000 + 1 }), now)).toBeNull()
  })
})
