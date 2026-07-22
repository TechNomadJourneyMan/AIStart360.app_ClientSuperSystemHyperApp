import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  processMyHonorOrderNotificationDirect,
} from '@/lib/integrations/myhonor/process-order-notification'
import { getMyHonorOrderNotificationConfiguration } from '@/lib/integrations/myhonor/order-notifications'

const notificationId = '00000000-0000-4000-8000-000000000001'
const leaseToken = '00000000-0000-4000-8000-000000000002'

function configuration() {
  return getMyHonorOrderNotificationConfiguration({
    MYHONOR_ORDER_NOTIFICATIONS_API_KEY: 'integration-secret',
    WHATSAPP_TOKEN: 'meta-token',
    WHATSAPP_PHONE_NUMBER_ID: 'phone-id',
    WHATSAPP_TEMPLATE_LANGUAGE: 'ru',
    WHATSAPP_TEMPLATE_ORDER_CONFIRMED: 'myhonor_order_confirmed_v1',
    WHATSAPP_TEMPLATE_ORDER_SHIPPED: 'myhonor_order_shipped_v1',
    WHATSAPP_TEMPLATE_ORDER_DELIVERED: 'myhonor_order_delivered_v1',
    WHATSAPP_TEMPLATE_ORDER_CANCELLED: 'myhonor_order_cancelled_v1',
  })
}

function claimed() {
  return {
    id: notificationId,
    leaseToken,
    eventId: 'myhonor:order:84:status:3',
    orderId: '84',
    orderNumber: 'MH-0084',
    orderStatus: 'confirmed' as const,
    statusVersion: 3,
    recipientPhoneE164: '+77051234567',
    recipientName: 'Марина',
    locale: 'ru',
    details: {},
    attempts: 1,
    maxAttempts: 5,
  }
}

describe('myhonor utility-template processor', () => {
  const claim = vi.fn()
  const authorize = vi.fn()
  const finish = vi.fn()
  const sendTemplate = vi.fn()

  beforeEach(() => {
    vi.resetAllMocks()
    claim.mockResolvedValue(claimed())
    authorize.mockResolvedValue({ authorized: true, reason: 'authorized' })
    finish.mockResolvedValue({
      accepted: true,
      state: 'accepted',
      runAt: '2026-07-22T06:30:00.000Z',
    })
    sendTemplate.mockResolvedValue({
      ok: true,
      externalMessageId: 'wamid.template-1',
      rawStatus: 200,
    })
  })

  it('authorizes the database fence before calling Meta and records acceptance', async () => {
    const result = await processMyHonorOrderNotificationDirect({
      notificationId,
      ownerToken: 'workflow:wrun-1',
    }, {
      configuration: configuration(),
      claim,
      authorize,
      finish,
      sendTemplate,
    })

    expect(result).toEqual({
      action: 'accepted',
      providerMessageId: 'wamid.template-1',
    })
    expect(authorize.mock.invocationCallOrder[0]).toBeLessThan(
      sendTemplate.mock.invocationCallOrder[0],
    )
    expect(sendTemplate).toHaveBeenCalledWith({
      recipientId: '77051234567',
      templateName: 'myhonor_order_confirmed_v1',
      languageCode: 'ru',
      bodyParameters: ['Марина', 'MH-0084'],
      accountExternalId: 'phone-id',
    })
    expect(finish).toHaveBeenCalledWith(expect.objectContaining({
      outcome: 'accepted',
      providerMessageId: 'wamid.template-1',
    }))
  })

  it('fails a claimed row before authorization when runtime configuration drifts', async () => {
    const result = await processMyHonorOrderNotificationDirect({
      notificationId,
      ownerToken: 'workflow:wrun-1',
    }, {
      configuration: getMyHonorOrderNotificationConfiguration({}),
      claim,
      authorize,
      finish,
      sendTemplate,
    })

    expect(result).toEqual({
      action: 'failed',
      reason: 'integration_configuration_missing',
    })
    expect(authorize).not.toHaveBeenCalled()
    expect(sendTemplate).not.toHaveBeenCalled()
    expect(finish).toHaveBeenCalledWith(expect.objectContaining({
      outcome: 'failed',
      errorCode: 'integration_configuration_missing',
    }))
  })

  it('never retries an ambiguous network outcome', async () => {
    sendTemplate.mockResolvedValue({
      ok: false,
      status: null,
      code: 'timeout',
      message: 'request timed out',
      retryable: true,
    })
    finish.mockResolvedValue({
      accepted: true,
      state: 'delivery_unknown',
      runAt: null,
    })

    await expect(processMyHonorOrderNotificationDirect({
      notificationId,
      ownerToken: 'workflow:wrun-1',
    }, {
      configuration: configuration(),
      claim,
      authorize,
      finish,
      sendTemplate,
    })).resolves.toEqual({
      action: 'delivery_unknown',
      reason: 'meta.timeout',
    })
    expect(finish).toHaveBeenCalledWith(expect.objectContaining({
      outcome: 'delivery_unknown',
      errorCode: 'meta.timeout',
    }))
  })

  it('retries an explicit transient provider rejection through the durable queue', async () => {
    sendTemplate.mockResolvedValue({
      ok: false,
      status: 429,
      code: '4',
      message: 'rate limited',
      retryable: true,
    })
    finish.mockResolvedValue({
      accepted: true,
      state: 'queued',
      runAt: '2026-07-22T06:30:05.000Z',
    })

    await expect(processMyHonorOrderNotificationDirect({
      notificationId,
      ownerToken: 'workflow:wrun-1',
    }, {
      configuration: configuration(),
      claim,
      authorize,
      finish,
      sendTemplate,
    })).resolves.toEqual({
      action: 'retry',
      runAt: '2026-07-22T06:30:05.000Z',
      reason: 'meta.4',
    })
    expect(finish).toHaveBeenCalledWith(expect.objectContaining({
      outcome: 'failed',
      retryable: true,
      retryAfterSeconds: 5,
    }))
  })

  it('skips duplicate workflows that cannot acquire the claim', async () => {
    claim.mockResolvedValue(null)
    await expect(processMyHonorOrderNotificationDirect({
      notificationId,
      ownerToken: 'workflow:wrun-duplicate',
    }, {
      configuration: configuration(),
      claim,
      authorize,
      finish,
      sendTemplate,
    })).resolves.toEqual({
      action: 'skipped',
      reason: 'notification_not_claimable',
    })
    expect(authorize).not.toHaveBeenCalled()
    expect(sendTemplate).not.toHaveBeenCalled()
  })
})
