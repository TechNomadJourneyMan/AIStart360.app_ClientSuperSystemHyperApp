import { beforeEach, describe, expect, it, vi } from 'vitest'
import { encryptContactValue } from '@/lib/integrations/myhonor/reactivation/identity'
import { processMyHonorReactivationRecipientDirect } from '@/lib/integrations/myhonor/reactivation/process-recipient'
import { myHonorSnapshotHash } from '@/lib/integrations/myhonor/reactivation/repository'
import { getMyHonorReactivationConfiguration } from '@/lib/integrations/myhonor/reactivation/types'

const MASTER_KEY = Buffer.alloc(32, 11).toString('base64')

function configuration(sendEnabled = true) {
  return getMyHonorReactivationConfiguration({
    MYHONOR_REACTIVATION_API_KEY: 'integration-secret-with-at-least-32-bytes',
    MYHONOR_REACTIVATION_MASTER_KEY: MASTER_KEY,
    MYHONOR_REACTIVATION_OWNER_USER_ID: '123e4567-e89b-42d3-a456-426614174000',
    MYHONOR_REACTIVATION_COMPANY_ID: 'company-1',
    MYHONOR_REACTIVATION_SEND_ENABLED: sendEnabled ? 'true' : 'false',
    WHATSAPP_TOKEN: 'meta-token',
    WHATSAPP_PHONE_NUMBER_ID: 'phone-id',
    WHATSAPP_BUSINESS_ACCOUNT_ID: '123456789012345',
    WHATSAPP_TEMPLATE_LANGUAGE: 'ru',
    WHATSAPP_TEMPLATE_REACTIVATION_OLD_LEAD: 'myhonor_old_lead_v1',
    WHATSAPP_TEMPLATE_REACTIVATION_ABANDONED_CART: 'myhonor_abandoned_cart_v1',
    WHATSAPP_TEMPLATE_REACTIVATION_REGISTERED: 'myhonor_registered_v1',
    WHATSAPP_TEMPLATE_REACTIVATION_DORMANT: 'myhonor_dormant_v1',
    WHATSAPP_TEMPLATE_REACTIVATION_POST_PURCHASE: 'myhonor_post_purchase_v1',
    WHATSAPP_TEMPLATE_REACTIVATION_SEASONAL: 'myhonor_seasonal_v1',
    WHATSAPP_TEMPLATE_REACTIVATION_CLUB: 'myhonor_club_v1',
    WHATSAPP_TEMPLATE_REACTIVATION_BACK_IN_STOCK: 'myhonor_back_in_stock_v1',
  })
}

function claimed() {
  const templateParameters = ['Марина', 'рыбалки', 'https://myhonor.shop/catalog']
  return {
    id: '123e4567-e89b-42d3-a456-426614174001',
    leaseToken: '123e4567-e89b-42d3-a456-426614174002',
    campaignId: '123e4567-e89b-42d3-a456-426614174003',
    contactId: '123e4567-e89b-42d3-a456-426614174004',
    phoneCiphertext: encryptContactValue('+77051234567', MASTER_KEY),
    locale: 'ru',
    segment: 'old_lead' as const,
    templateName: 'myhonor_old_lead_v1',
    templateLanguage: 'ru',
    templateParametersHash: myHonorSnapshotHash(templateParameters),
    templateParametersCiphertext: encryptContactValue(
      JSON.stringify(templateParameters),
      MASTER_KEY,
    ),
    recommendationSnapshot: {
      products: [],
      verified_at: '2026-08-25T10:00:00Z',
    },
    attempts: 1,
    maxAttempts: 5,
  }
}

describe('MyHonor reactivation recipient processor', () => {
  const claim = vi.fn()
  const authorize = vi.fn()
  const finish = vi.fn()
  const sendTemplate = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    claim.mockResolvedValue(claimed())
    authorize.mockResolvedValue({
      authorized: true,
      reason: 'authorized',
      providerAttemptId: '123e4567-e89b-42d3-a456-426614174005',
      nextRunAt: null,
    })
    finish.mockResolvedValue({ accepted: true, state: 'accepted', runAt: null })
    sendTemplate.mockResolvedValue({ ok: true, externalMessageId: 'wamid-1' })
  })

  it('decrypts only after claim, reauthorizes, and sends the approved template', async () => {
    const result = await processMyHonorReactivationRecipientDirect({
      recipientId: claimed().id,
      ownerToken: 'workflow:run-1',
    }, {
      configuration: configuration(),
      claim,
      authorize,
      finish,
      sendTemplate,
    })

    expect(result).toEqual({ action: 'accepted', providerMessageId: 'wamid-1' })
    expect(authorize).toHaveBeenCalledOnce()
    expect(sendTemplate).toHaveBeenCalledWith({
      recipientId: '77051234567',
      templateName: 'myhonor_old_lead_v1',
      languageCode: 'ru',
      bodyParameters: ['Марина', 'рыбалки', 'https://myhonor.shop/catalog'],
      accountExternalId: 'phone-id',
    })
  })

  it('fails closed before authorization when the global send switch is off', async () => {
    const result = await processMyHonorReactivationRecipientDirect({
      recipientId: claimed().id,
      ownerToken: 'workflow:run-2',
    }, { configuration: configuration(false), claim, authorize, finish, sendTemplate })

    expect(result).toEqual({ action: 'failed', reason: 'provider_not_ready' })
    expect(authorize).not.toHaveBeenCalled()
    expect(sendTemplate).not.toHaveBeenCalled()
  })

  it('does not call Meta when the atomic final authorization is denied', async () => {
    authorize.mockResolvedValue({
      authorized: false,
      reason: 'consent_revoked',
      providerAttemptId: null,
      nextRunAt: null,
    })
    const result = await processMyHonorReactivationRecipientDirect({
      recipientId: claimed().id,
      ownerToken: 'workflow:run-3',
    }, { configuration: configuration(), claim, authorize, finish, sendTemplate })

    expect(result).toEqual({ action: 'skipped', reason: 'consent_revoked' })
    expect(sendTemplate).not.toHaveBeenCalled()
    expect(finish).not.toHaveBeenCalled()
  })

  it('durably retries when final authorization moves the recipient to a future slot', async () => {
    const runAt = new Date(Date.now() + 60_000).toISOString()
    authorize.mockResolvedValue({
      authorized: false,
      reason: 'quiet_hours',
      providerAttemptId: null,
      nextRunAt: runAt,
    })

    const result = await processMyHonorReactivationRecipientDirect({
      recipientId: claimed().id,
      ownerToken: 'workflow:run-quiet-hours',
    }, { configuration: configuration(), claim, authorize, finish, sendTemplate })

    expect(result).toEqual({ action: 'retry', runAt, reason: 'quiet_hours' })
    expect(sendTemplate).not.toHaveBeenCalled()
    expect(finish).not.toHaveBeenCalled()
  })

  it('fails closed when a different segment template is substituted', async () => {
    claim.mockResolvedValue({
      ...claimed(),
      templateName: 'myhonor_registered_v1',
    })

    const result = await processMyHonorReactivationRecipientDirect({
      recipientId: claimed().id,
      ownerToken: 'workflow:run-template-substitution',
    }, { configuration: configuration(), claim, authorize, finish, sendTemplate })

    expect(result).toEqual({ action: 'failed', reason: 'invalid_recipient_snapshot' })
    expect(authorize).not.toHaveBeenCalled()
    expect(sendTemplate).not.toHaveBeenCalled()
  })

  it('fails closed when approved template parameters were changed after preview', async () => {
    claim.mockResolvedValue({
      ...claimed(),
      templateParametersCiphertext: encryptContactValue(
        JSON.stringify(['Марина', 'скидка 50%', 'https://myhonor.shop/catalog']),
        MASTER_KEY,
      ),
    })

    const result = await processMyHonorReactivationRecipientDirect({
      recipientId: claimed().id,
      ownerToken: 'workflow:run-template-parameters-tampered',
    }, { configuration: configuration(), claim, authorize, finish, sendTemplate })

    expect(result).toEqual({ action: 'failed', reason: 'invalid_recipient_snapshot' })
    expect(authorize).not.toHaveBeenCalled()
    expect(sendTemplate).not.toHaveBeenCalled()
  })

  it('does not immediately retry Meta marketing-limit error 131049', async () => {
    sendTemplate.mockResolvedValue({
      ok: false,
      status: 400,
      code: '131049',
      message: 'marketing limit',
      retryable: true,
    })
    finish.mockResolvedValue({ accepted: true, state: 'failed', runAt: null })
    const result = await processMyHonorReactivationRecipientDirect({
      recipientId: claimed().id,
      ownerToken: 'workflow:run-4',
    }, { configuration: configuration(), claim, authorize, finish, sendTemplate })

    expect(result).toEqual({ action: 'failed', reason: '131049' })
    expect(finish).toHaveBeenCalledWith(expect.objectContaining({
      errorCode: 'meta_marketing_limit_131049',
      retryable: false,
    }))
  })

  it('retries a transient provider rejection through the durable queue', async () => {
    sendTemplate.mockResolvedValue({
      ok: false,
      status: 429,
      code: '4',
      message: 'provider rate limit',
      retryable: true,
    })
    finish.mockResolvedValue({
      accepted: true,
      state: 'queued',
      runAt: '2026-08-25T10:01:00Z',
    })
    const result = await processMyHonorReactivationRecipientDirect({
      recipientId: claimed().id,
      ownerToken: 'workflow:run-5',
    }, { configuration: configuration(), claim, authorize, finish, sendTemplate })

    expect(result).toEqual({
      action: 'retry',
      runAt: '2026-08-25T10:01:00Z',
      reason: '4',
    })
  })

  it('marks an interrupted authorized provider call as delivery unknown', async () => {
    sendTemplate.mockRejectedValue(new Error('socket closed'))
    finish.mockResolvedValue({
      accepted: true,
      state: 'delivery_unknown',
      runAt: null,
    })
    const result = await processMyHonorReactivationRecipientDirect({
      recipientId: claimed().id,
      ownerToken: 'workflow:run-6',
    }, { configuration: configuration(), claim, authorize, finish, sendTemplate })

    expect(result).toEqual({
      action: 'delivery_unknown',
      reason: 'provider_call_interrupted',
    })
  })

  it('never retries when Meta returns 2xx without a provider message id', async () => {
    sendTemplate.mockResolvedValue({
      ok: false,
      deliveryUnknown: true,
      status: 200,
      code: 'provider_ack_missing_message_id',
      message: 'WhatsApp API returned 2xx without messages[0].id; delivery is unknown',
      retryable: false,
    })
    finish.mockResolvedValue({
      accepted: true,
      state: 'delivery_unknown',
      runAt: null,
    })

    const result = await processMyHonorReactivationRecipientDirect({
      recipientId: claimed().id,
      ownerToken: 'workflow:run-provider-ack-missing-id',
    }, { configuration: configuration(), claim, authorize, finish, sendTemplate })

    expect(result).toEqual({
      action: 'delivery_unknown',
      reason: 'provider_ack_missing_message_id',
    })
    expect(finish).toHaveBeenCalledWith(expect.objectContaining({
      outcome: 'delivery_unknown',
      errorCode: 'provider_ack_missing_message_id',
      retryable: false,
    }))
  })

  it('never retries when the template POST network outcome is unknown', async () => {
    sendTemplate.mockResolvedValue({
      ok: false,
      deliveryUnknown: true,
      status: null,
      code: 'provider_request_outcome_unknown',
      message: 'WhatsApp API request outcome is unknown',
      retryable: false,
    })
    finish.mockResolvedValue({
      accepted: true,
      state: 'delivery_unknown',
      runAt: null,
    })

    const result = await processMyHonorReactivationRecipientDirect({
      recipientId: claimed().id,
      ownerToken: 'workflow:run-provider-network-unknown',
    }, { configuration: configuration(), claim, authorize, finish, sendTemplate })

    expect(result).toEqual({
      action: 'delivery_unknown',
      reason: 'provider_request_outcome_unknown',
    })
    expect(finish).toHaveBeenCalledWith(expect.objectContaining({
      outcome: 'delivery_unknown',
      errorCode: 'provider_request_outcome_unknown',
      retryable: false,
    }))
  })
})
