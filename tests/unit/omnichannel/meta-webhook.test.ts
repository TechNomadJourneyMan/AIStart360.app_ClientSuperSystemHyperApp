import { createHmac } from 'crypto'
import { describe, expect, it } from 'vitest'
import {
  parseMetaWebhook,
  verifyMetaWebhookSignature,
} from '@/lib/omnichannel/meta-webhook'

describe('verifyMetaWebhookSignature', () => {
  it('accepts a valid HMAC-SHA256 signature for the exact raw body', () => {
    const secret = 'test-app-secret'
    const rawBody = Buffer.from('{"message":"Привет\nMeta"}', 'utf8')
    const signature = `sha256=${createHmac('sha256', secret).update(rawBody).digest('hex')}`

    expect(verifyMetaWebhookSignature(rawBody, signature, secret)).toBe(true)
  })

  it('fails closed for altered, malformed, missing, or wrongly signed requests', () => {
    const secret = 'test-app-secret'
    const rawBody = '{"message":"hello"}'
    const validSignature = `sha256=${createHmac('sha256', secret).update(rawBody).digest('hex')}`

    expect(verifyMetaWebhookSignature(`${rawBody} `, validSignature, secret)).toBe(false)
    expect(verifyMetaWebhookSignature(rawBody, validSignature, 'wrong-secret')).toBe(false)
    expect(verifyMetaWebhookSignature(rawBody, 'sha256=abcd', secret)).toBe(false)
    expect(verifyMetaWebhookSignature(rawBody, 'sha1=abcd', secret)).toBe(false)
    expect(verifyMetaWebhookSignature(rawBody, null, secret)).toBe(false)
    expect(verifyMetaWebhookSignature(rawBody, validSignature, '')).toBe(false)
  })
})

describe('parseMetaWebhook — Instagram', () => {
  it('does not misclassify signed Page/Messenger payloads as Instagram', () => {
    expect(parseMetaWebhook({
      object: 'page',
      entry: [{
        id: 'page-1',
        messaging: [{
          sender: { id: 'user-1' },
          recipient: { id: 'page-1' },
          timestamp: 1_700_000_000_000,
          message: { mid: 'page-message-1', text: 'hello' },
        }],
      }],
    })).toEqual([])
  })

  it('normalizes text, attachment, postback, and an outbound echo', () => {
    const events = parseMetaWebhook({
      object: 'instagram',
      entry: [{
        id: 'ig-business-1',
        messaging: [
          {
            sender: { id: 'ig-user-1' },
            recipient: { id: 'ig-business-1' },
            timestamp: 1_700_000_000_000,
            message: {
              mid: 'ig-mid-text',
              text: 'Здравствуйте',
              reply_to: { mid: 'ig-mid-previous' },
            },
          },
          {
            // No is_echo flag: direction must still be derived from entry.id.
            sender: { id: 'ig-business-1' },
            recipient: { id: 'ig-user-1' },
            timestamp: 1_700_000_001_000,
            message: {
              mid: 'ig-mid-attachment',
              attachments: [{
                type: 'image',
                payload: { url: 'https://example.test/media?access_token=must-not-be-stored' },
              }],
            },
          },
          {
            sender: { id: 'ig-user-1' },
            recipient: { id: 'ig-business-1' },
            timestamp: 1_700_000_002_000,
            postback: {
              mid: 'ig-mid-postback',
              title: 'Узнать цену',
              payload: 'PRICE_REQUEST',
            },
          },
        ],
      }],
    })

    expect(events).toHaveLength(3)
    expect(events[0]).toMatchObject({
      eventType: 'message',
      channel: 'instagram',
      accountExternalId: 'ig-business-1',
      conversationExternalId: 'ig-user-1',
      contactExternalId: 'ig-user-1',
      externalMessageId: 'ig-mid-text',
      direction: 'in',
      messageType: 'text',
      text: 'Здравствуйте',
      status: 'received',
      replyToExternalId: 'ig-mid-previous',
      occurredAt: '2023-11-14T22:13:20.000Z',
    })
    expect(events[1]).toMatchObject({
      externalMessageId: 'ig-mid-attachment',
      direction: 'out',
      messageType: 'attachment',
      text: '[Instagram attachment: image]',
      status: 'sent',
      metadata: {
        attachmentCount: 1,
        attachmentTypes: ['image'],
        isEcho: true,
      },
    })
    expect(JSON.stringify(events[1])).not.toContain('must-not-be-stored')
    expect(events[2]).toMatchObject({
      externalMessageId: 'ig-mid-postback',
      direction: 'in',
      messageType: 'postback',
      text: 'Узнать цену',
      metadata: { postbackPayload: 'PRICE_REQUEST', isEcho: false },
    })
  })

  it('keeps the canonical payload selected from an Instagram quick reply', () => {
    const events = parseMetaWebhook({
      object: 'instagram',
      entry: [{
        id: 'ig-business-1',
        messaging: [{
          sender: { id: 'ig-user-1' },
          recipient: { id: 'ig-business-1' },
          timestamp: 1_700_000_003_000,
          message: {
            mid: 'ig-mid-quick-reply',
            text: 'Открыть каталог',
            quick_reply: { payload: 'equipment_v1:interest:catalog' },
          },
        }],
      }],
    })

    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      externalMessageId: 'ig-mid-quick-reply',
      messageType: 'button',
      text: 'Открыть каталог',
      metadata: {
        quickReplyPayload: 'equipment_v1:interest:catalog',
        isEcho: false,
      },
    })
  })
})

describe('parseMetaWebhook — WhatsApp', () => {
  it('normalizes text, button, interactive, and unsupported media placeholders', () => {
    const events = parseMetaWebhook({
      object: 'whatsapp_business_account',
      entry: [{
        id: 'waba-1',
        changes: [{
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
                id: 'wa-text-1',
                timestamp: '1700000000',
                type: 'text',
                text: { body: 'Есть доставка?' },
              },
              {
                from: '77770000000',
                id: 'wa-button-1',
                timestamp: '1700000001',
                type: 'button',
                button: { text: 'Да', payload: 'YES' },
              },
              {
                from: '77770000000',
                id: 'wa-interactive-1',
                timestamp: '1700000002',
                type: 'interactive',
                interactive: {
                  type: 'list_reply',
                  list_reply: { id: 'delivery', title: 'Доставка', description: 'Условия доставки' },
                },
                context: { id: 'wa-question-1' },
              },
              {
                from: '77770000000',
                id: 'wa-image-1',
                timestamp: '1700000003',
                type: 'image',
                image: {
                  id: 'media-1',
                  mime_type: 'image/jpeg',
                  caption: 'Фото товара',
                  sha256: 'provider-hash-not-needed',
                },
              },
            ],
          },
        }],
      }],
    })

    expect(events).toHaveLength(4)
    expect(events[0]).toMatchObject({
      eventType: 'message',
      channel: 'whatsapp',
      accountExternalId: 'phone-number-1',
      conversationExternalId: '77770000000',
      contactExternalId: '77770000000',
      contactName: 'Алия',
      externalMessageId: 'wa-text-1',
      direction: 'in',
      messageType: 'text',
      text: 'Есть доставка?',
      status: 'received',
      occurredAt: '2023-11-14T22:13:20.000Z',
    })
    expect(events[1]).toMatchObject({
      externalMessageId: 'wa-button-1',
      messageType: 'button',
      text: 'Да',
      metadata: { buttonPayload: 'YES' },
    })
    expect(events[2]).toMatchObject({
      externalMessageId: 'wa-interactive-1',
      messageType: 'interactive',
      text: 'Доставка',
      replyToExternalId: 'wa-question-1',
      metadata: { interactiveType: 'list_reply', interactiveId: 'delivery' },
    })
    expect(events[3]).toMatchObject({
      externalMessageId: 'wa-image-1',
      messageType: 'image',
      text: '[WhatsApp image] Фото товара',
      metadata: { mediaId: 'media-1', mimeType: 'image/jpeg' },
    })
    expect(JSON.stringify(events[3])).not.toContain('provider-hash-not-needed')
  })

  it('fails closed for unsupported or malformed WhatsApp interactive replies', () => {
    const events = parseMetaWebhook({
      object: 'whatsapp_business_account',
      entry: [{
        id: 'waba-1',
        changes: [{
          field: 'messages',
          value: {
            metadata: { phone_number_id: 'phone-number-1' },
            messages: [
              {
                from: '77770000000',
                id: 'wa-interactive-button-valid',
                timestamp: '1700000000',
                type: 'interactive',
                interactive: {
                  type: 'button_reply',
                  button_reply: {
                    id: 'equipment_v1:interest:summer',
                    title: 'Да, на лето',
                  },
                },
              },
              {
                from: '77770000000',
                id: 'wa-interactive-flow',
                timestamp: '1700000001',
                type: 'interactive',
                interactive: {
                  type: 'nfm_reply',
                  nfm_reply: {
                    response_json: '{"city":"Астана","secret":"must-not-be-stored"}',
                  },
                },
              },
              {
                from: '77770000000',
                id: 'wa-interactive-missing-id',
                timestamp: '1700000002',
                type: 'interactive',
                interactive: {
                  type: 'list_reply',
                  list_reply: { title: 'Да, на лето' },
                },
              },
              {
                from: '77770000000',
                id: 'wa-interactive-whitespace-id',
                timestamp: '1700000003',
                type: 'interactive',
                interactive: {
                  type: 'button_reply',
                  button_reply: { id: '   ', title: 'Да, на лето' },
                },
              },
            ],
          },
        }],
      }],
    })

    expect(events).toHaveLength(4)
    expect(events[0]).toMatchObject({
      externalMessageId: 'wa-interactive-button-valid',
      messageType: 'interactive',
      text: 'Да, на лето',
      metadata: {
        interactiveType: 'button_reply',
        interactiveId: 'equipment_v1:interest:summer',
      },
    })
    expect(events.slice(1)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        externalMessageId: 'wa-interactive-flow',
        messageType: 'unknown',
        metadata: expect.objectContaining({ interactiveType: 'nfm_reply' }),
      }),
      expect.objectContaining({
        externalMessageId: 'wa-interactive-missing-id',
        messageType: 'unknown',
        metadata: expect.objectContaining({ interactiveType: 'list_reply' }),
      }),
      expect.objectContaining({
        externalMessageId: 'wa-interactive-whitespace-id',
        messageType: 'unknown',
        metadata: expect.objectContaining({ interactiveType: 'button_reply' }),
      }),
    ]))
    expect(JSON.stringify(events)).not.toContain('must-not-be-stored')
  })

  it('extracts delivery and failure status updates without retaining the raw payload', () => {
    const events = parseMetaWebhook({
      object: 'whatsapp_business_account',
      entry: [{
        id: 'waba-1',
        changes: [{
          field: 'messages',
          value: {
            metadata: { phone_number_id: 'phone-number-1' },
            statuses: [
              {
                id: 'wa-out-1',
                status: 'delivered',
                timestamp: '1700000100',
                recipient_id: '77770000000',
                conversation: { id: 'provider-conversation-1', origin: { type: 'service' } },
                pricing: { category: 'service', billable: false },
              },
              {
                id: 'wa-out-2',
                status: 'failed',
                timestamp: '1700000101',
                recipient_id: '77770000001',
                errors: [{ code: 131026, title: 'Undeliverable', message: 'Message undeliverable' }],
              },
            ],
          },
        }],
      }],
    })

    expect(events).toHaveLength(2)
    expect(events[0]).toMatchObject({
      eventType: 'status',
      channel: 'whatsapp',
      accountExternalId: 'phone-number-1',
      conversationExternalId: '77770000000',
      externalMessageId: 'wa-out-1',
      status: 'delivered',
      metadata: {
        providerConversationId: 'provider-conversation-1',
        conversationOrigin: 'service',
        pricingCategory: 'service',
      },
    })
    expect(events[1]).toMatchObject({
      eventType: 'status',
      externalMessageId: 'wa-out-2',
      status: 'failed',
      errorReason: 'Message undeliverable',
      metadata: { errorCodes: [131026] },
    })
  })

  it('ignores malformed and unknown status entries without throwing', () => {
    expect(parseMetaWebhook(null)).toEqual([])
    expect(parseMetaWebhook({ object: 'whatsapp_business_account', entry: [{ changes: [{}] }] })).toEqual([])
    expect(parseMetaWebhook({
      object: 'whatsapp_business_account',
      entry: [{
        id: 'waba-1',
        changes: [{
          value: {
            metadata: { phone_number_id: 'phone-number-1' },
            statuses: [{ id: 'wa-1', status: 'unknown', recipient_id: '7' }],
          },
        }],
      }],
    })).toEqual([])
  })
})
