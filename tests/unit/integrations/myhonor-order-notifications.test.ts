import { describe, expect, it } from 'vitest'
import {
  buildMyHonorTemplateRequest,
  getMyHonorOrderNotificationConfiguration,
  isAuthorizedMyHonorBearer,
  myHonorOrderNotificationRequestHash,
  myHonorOrderNotificationSchema,
  normalizeMyHonorOrderNotification,
} from '@/lib/integrations/myhonor/order-notifications'

function environment(): Record<string, string | undefined> {
  return {
    MYHONOR_ORDER_NOTIFICATIONS_API_KEY: 'current-secret-at-least-32-characters',
    MYHONOR_ORDER_NOTIFICATIONS_API_KEY_PREVIOUS: 'previous-secret-at-least-32-chars',
    WHATSAPP_TOKEN: 'meta-token',
    WHATSAPP_PHONE_NUMBER_ID: 'phone-id',
    WHATSAPP_TEMPLATE_LANGUAGE: 'ru',
    WHATSAPP_TEMPLATE_ORDER_CONFIRMED: 'myhonor_order_confirmed_v1',
    WHATSAPP_TEMPLATE_ORDER_SHIPPED: 'myhonor_order_shipped_v1',
    WHATSAPP_TEMPLATE_ORDER_DELIVERED: 'myhonor_order_delivered_v1',
    WHATSAPP_TEMPLATE_ORDER_CANCELLED: 'myhonor_order_cancelled_v1',
  }
}

function payload(overrides: Record<string, unknown> = {}) {
  return {
    event_id: 'myhonor:order:84:status:3',
    occurred_at: '2026-07-22T06:30:00Z',
    order_id: '84',
    order_number: 'MH-0084',
    status: 'confirmed',
    status_version: 3,
    recipient: {
      phone_e164: '+77051234567',
      name: 'Марина',
      whatsapp_opt_in: true,
    },
    locale: 'ru',
    details: {},
    ...overrides,
  }
}

describe('myhonor order notification contract', () => {
  it('accepts the strict v1 request and normalizes optional details', () => {
    const parsed = myHonorOrderNotificationSchema.parse(payload())
    expect(normalizeMyHonorOrderNotification(parsed).details).toEqual({
      tracking_number: null,
      tracking_url: null,
      cancellation_reason: null,
    })
  })

  it('requires explicit WhatsApp opt-in and rejects unknown fields', () => {
    expect(() => myHonorOrderNotificationSchema.parse(payload({
      recipient: {
        phone_e164: '+77051234567',
        name: 'Марина',
        whatsapp_opt_in: false,
      },
    }))).toThrow()
    expect(() => myHonorOrderNotificationSchema.parse({
      ...payload(),
      arbitrary_message: 'send anything',
    })).toThrow()
  })

  it('allows tracking only for shipped and cancellation reason only for cancelled', () => {
    expect(() => myHonorOrderNotificationSchema.parse(payload({
      details: { tracking_number: 'TRACK-1' },
    }))).toThrow()
    expect(() => myHonorOrderNotificationSchema.parse(payload({
      status: 'cancelled',
      details: { cancellation_reason: 'Нет товара' },
    }))).not.toThrow()
  })

  it('produces the same hash for omitted and explicitly null details', () => {
    const omitted = normalizeMyHonorOrderNotification(
      myHonorOrderNotificationSchema.parse(payload()),
    )
    const explicit = normalizeMyHonorOrderNotification(
      myHonorOrderNotificationSchema.parse(payload({
        details: {
          tracking_number: null,
          tracking_url: null,
          cancellation_reason: null,
        },
      })),
    )
    expect(myHonorOrderNotificationRequestHash(omitted)).toBe(
      myHonorOrderNotificationRequestHash(explicit),
    )
  })

  it('authenticates the current or previous bearer without accepting malformed headers', () => {
    const configuration = getMyHonorOrderNotificationConfiguration(environment())
    expect(configuration.ready).toBe(true)
    expect(isAuthorizedMyHonorBearer(
      'Bearer current-secret-at-least-32-characters',
      configuration.apiKeys,
    )).toBe(true)
    expect(isAuthorizedMyHonorBearer(
      'Bearer previous-secret-at-least-32-chars',
      configuration.apiKeys,
    )).toBe(true)
    expect(isAuthorizedMyHonorBearer(
      'Basic current-secret-at-least-32-characters',
      configuration.apiKeys,
    )).toBe(false)
  })

  it('maps statuses only to configured templates and fixed parameters', () => {
    const configuration = getMyHonorOrderNotificationConfiguration(environment())
    const confirmed = normalizeMyHonorOrderNotification(
      myHonorOrderNotificationSchema.parse(payload()),
    )
    expect(buildMyHonorTemplateRequest(confirmed, configuration)).toEqual({
      templateName: 'myhonor_order_confirmed_v1',
      languageCode: 'ru',
      recipientId: '77051234567',
      bodyParameters: ['Марина', 'MH-0084'],
    })

    const shipped = normalizeMyHonorOrderNotification(
      myHonorOrderNotificationSchema.parse(payload({
        status: 'shipped',
        details: {
          tracking_number: 'TRACK-1',
          tracking_url: 'https://carrier.example/track/TRACK-1',
        },
      })),
    )
    expect(buildMyHonorTemplateRequest(shipped, configuration)?.bodyParameters)
      .toEqual([
        'Марина',
        'MH-0084',
        'TRACK-1 — https://carrier.example/track/TRACK-1',
      ])
  })

  it('reports only missing env names when provider configuration is incomplete', () => {
    const secret = 'secret-value-that-must-not-leak'
    const configuration = getMyHonorOrderNotificationConfiguration({
      MYHONOR_ORDER_NOTIFICATIONS_API_KEY: secret,
    })
    expect(configuration.ready).toBe(false)
    expect(configuration.missing).toContain('WHATSAPP_TOKEN')
    expect(configuration.missing).toContain('WHATSAPP_TEMPLATE_ORDER_CONFIRMED')
    expect(JSON.stringify(configuration)).not.toContain(secret)
  })
})
