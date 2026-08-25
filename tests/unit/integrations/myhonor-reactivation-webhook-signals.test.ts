import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  contactPhoneHash,
  encryptContactValue,
} from '@/lib/integrations/myhonor/reactivation/identity'
import { recordMyHonorReactivationInboundContext } from '@/lib/integrations/myhonor/reactivation/outbound-context'
import {
  applyMyHonorReactivationDeliveryStatus,
  applyMyHonorReactivationInboundSignal,
} from '@/lib/integrations/myhonor/reactivation/webhook-signals'
import { getMyHonorReactivationConfiguration } from '@/lib/integrations/myhonor/reactivation/types'
import type {
  NormalizedOmnichannelMessage,
  NormalizedWhatsAppStatus,
} from '@/lib/omnichannel/types'

const MASTER_KEY = Buffer.alloc(32, 23).toString('base64')
const OWNER_USER_ID = '123e4567-e89b-42d3-a456-426614174000'
const ATTRIBUTED_RECIPIENT_ID = '123e4567-e89b-42d3-a456-426614174001'

function configuration() {
  return getMyHonorReactivationConfiguration({
    MYHONOR_REACTIVATION_API_KEY: 'integration-secret-with-at-least-32-bytes',
    MYHONOR_REACTIVATION_MASTER_KEY: MASTER_KEY,
    MYHONOR_REACTIVATION_OWNER_USER_ID: OWNER_USER_ID,
    MYHONOR_REACTIVATION_COMPANY_ID: 'myhonor-company',
  })
}

function inbound(
  overrides: Partial<NormalizedOmnichannelMessage> = {},
): NormalizedOmnichannelMessage {
  return {
    eventType: 'message',
    channel: 'whatsapp',
    accountExternalId: 'phone-number-1',
    conversationExternalId: '77051234567',
    contactExternalId: '77051234567',
    contactName: 'Клиент',
    contactPhone: null,
    externalMessageId: 'wamid.inbound-reactivation-1',
    direction: 'in',
    messageType: 'text',
    text: 'Подскажите, есть ли мой размер?',
    status: 'received',
    replyToExternalId: null,
    occurredAt: '2026-08-25T10:00:00.000Z',
    metadata: {},
    ...overrides,
  }
}

function statusEvent(): NormalizedWhatsAppStatus {
  return {
    eventType: 'status',
    channel: 'whatsapp',
    accountExternalId: 'phone-number-1',
    conversationExternalId: '77051234567',
    contactExternalId: '77051234567',
    externalMessageId: 'wamid.outbound-reactivation-1',
    status: 'delivered',
    occurredAt: '2026-08-25T10:00:00.000Z',
    errorReason: null,
    metadata: {},
  }
}

function fakeClient(result: { data: unknown; error: unknown }) {
  const maybeSingle = vi.fn().mockResolvedValue(result)
  const rpc = vi.fn().mockReturnValue({ maybeSingle })
  return {
    client: { rpc } as unknown as SupabaseClient,
    rpc,
    maybeSingle,
  }
}

describe('MyHonor reactivation Meta webhook signals', () => {
  beforeEach(() => vi.clearAllMocks())

  it('routes delivery state through the dedicated reactivation RPC', async () => {
    const database = fakeClient({
      data: {
        matched: true,
        recipient_id: ATTRIBUTED_RECIPIENT_ID,
        recipient_state: 'delivered',
      },
      error: null,
    })

    await expect(applyMyHonorReactivationDeliveryStatus(
      statusEvent(),
      database.client,
    )).resolves.toEqual({
      matched: true,
      recipientId: ATTRIBUTED_RECIPIENT_ID,
      state: 'delivered',
    })
    expect(database.rpc).toHaveBeenCalledWith(
      'apply_myhonor_reactivation_delivery_status',
      {
        p_provider_message_id: 'wamid.outbound-reactivation-1',
        p_status: 'delivered',
        p_occurred_at: '2026-08-25T10:00:00.000Z',
        p_error_code: null,
      },
    )
  })

  it('turns the existing deterministic STOP guardrail into an atomic suppression signal', async () => {
    const database = fakeClient({
      data: {
        matched_contact: true,
        attributed_recipient_id: ATTRIBUTED_RECIPIENT_ID,
        suppressed: true,
      },
      error: null,
    })

    const result = await applyMyHonorReactivationInboundSignal(
      inbound({ text: 'Пожалуйста, больше не пишите мне' }),
      { configuration: configuration(), client: database.client },
    )

    expect(result).toEqual({
      applied: true,
      reason: null,
      matchedContact: true,
      attributedRecipientId: ATTRIBUTED_RECIPIENT_ID,
      suppressed: true,
    })
    const parameters = database.rpc.mock.calls[0]?.[1]
    expect(database.rpc).toHaveBeenCalledWith(
      'apply_myhonor_reactivation_inbound_signal',
      expect.objectContaining({
        p_user_id: OWNER_USER_ID,
        p_company_id: 'myhonor-company',
        p_phone_hash: contactPhoneHash('+77051234567', MASTER_KEY),
        p_opt_out: true,
      }),
    )
    expect(parameters.p_event_id).toMatch(/^meta-wa:[a-f0-9]{64}$/)
    expect(parameters.p_event_hash).toMatch(/^[a-f0-9]{64}$/)
    expect(parameters.p_actor_hash).toMatch(/^[a-f0-9]{64}$/)
    expect(JSON.stringify(parameters)).not.toContain('не пишите')
    expect(JSON.stringify(parameters)).not.toContain('77051234567')
  })

  it('records an ordinary reply without creating a STOP suppression', async () => {
    const database = fakeClient({
      data: {
        matched_contact: true,
        attributed_recipient_id: ATTRIBUTED_RECIPIENT_ID,
        suppressed: false,
      },
      error: null,
    })

    const result = await applyMyHonorReactivationInboundSignal(inbound(), {
      configuration: configuration(),
      client: database.client,
    })

    expect(result.applied).toBe(true)
    expect(result.suppressed).toBe(false)
    expect(database.rpc).toHaveBeenCalledWith(
      'apply_myhonor_reactivation_inbound_signal',
      expect.objectContaining({ p_opt_out: false }),
    )
  })

  it('restores accepted offer context only after an inbound identity exists', async () => {
    const getContext = vi.fn().mockResolvedValue({
      recipientId: ATTRIBUTED_RECIPIENT_ID,
      campaignId: '123e4567-e89b-42d3-a456-426614174002',
      segment: 'old_lead',
      templateName: 'myhonor_old_lead_v1',
      templateLanguage: 'ru',
      templateParametersCiphertext: encryptContactValue(JSON.stringify([
        'Костюм HONOR',
        '35 000 ₸',
        'https://myhonor.shop/product/kostyum-honor?utm_source=whatsapp',
      ]), MASTER_KEY),
      providerMessageId: 'wamid.outbound-reactivation-1',
      providerAcceptedAt: '2026-08-25T09:55:00.000Z',
    })
    const ingest = vi.fn().mockResolvedValue({
      duplicate: false,
      messageId: 'context-message',
      conversationId: 'conversation-1',
      shouldQueue: false,
    })

    await expect(recordMyHonorReactivationInboundContext({
      event: inbound(),
      recipientId: ATTRIBUTED_RECIPIENT_ID,
    }, {
      configuration: configuration(),
      getContext,
      ingest,
    })).resolves.toBe(true)

    expect(ingest).toHaveBeenCalledWith(expect.objectContaining({
      channel: 'whatsapp',
      conversationExternalId: '77051234567',
      externalMessageId: `myhonor-reactivation-context:${ATTRIBUTED_RECIPIENT_ID}`,
      direction: 'out',
      occurredAt: '2026-08-25T09:55:00.000Z',
      text: expect.stringContaining('Костюм HONOR'),
      metadata: expect.objectContaining({
        source: 'myhonor_reactivation',
        contextRestoredAfterInbound: true,
      }),
    }))
  })

  it('skips opaque @lid identities without opening the database client', async () => {
    const database = fakeClient({ data: null, error: null })

    await expect(applyMyHonorReactivationInboundSignal(inbound({
      contactExternalId: '123456789012345@lid',
      conversationExternalId: '123456789012345@lid',
    }), {
      configuration: configuration(),
      client: database.client,
    })).resolves.toEqual({
      applied: false,
      reason: 'invalid_or_opaque_phone',
      matchedContact: false,
      attributedRecipientId: null,
      suppressed: false,
    })
    expect(database.rpc).not.toHaveBeenCalled()
  })

  it('skips safely when the reactivation binding is not configured', async () => {
    const database = fakeClient({ data: null, error: null })

    const result = await applyMyHonorReactivationInboundSignal(inbound(), {
      configuration: getMyHonorReactivationConfiguration({}),
      client: database.client,
    })

    expect(result.reason).toBe('reactivation_not_configured')
    expect(database.rpc).not.toHaveBeenCalled()
  })

  it('throws a stable non-PII error so the webhook can request a retry', async () => {
    const database = fakeClient({
      data: null,
      error: { message: 'database failure mentioning 77051234567' },
    })

    await expect(applyMyHonorReactivationInboundSignal(inbound(), {
      configuration: configuration(),
      client: database.client,
    })).rejects.toThrow('apply MyHonor reactivation inbound signal failed')
    await expect(applyMyHonorReactivationInboundSignal(inbound(), {
      configuration: configuration(),
      client: database.client,
    })).rejects.not.toThrow('77051234567')
  })
})
