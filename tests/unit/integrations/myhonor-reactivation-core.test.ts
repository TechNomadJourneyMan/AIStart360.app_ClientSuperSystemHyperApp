import { describe, expect, it } from 'vitest'
import {
  contactPhoneHash,
  decryptContactValue,
  encryptContactValue,
  externalCustomerHash,
  maskPhone,
  normalizeE164,
} from '@/lib/integrations/myhonor/reactivation/identity'
import {
  isMyHonorMarketingOptOut,
  isMyHonorMarketingQuietTime,
  myHonorFrequencyExclusion,
  nextMyHonorMarketingSendTime,
} from '@/lib/integrations/myhonor/reactivation/policy'
import {
  listMyHonorReactivationRecipientPreviews,
  myHonorSnapshotHash,
} from '@/lib/integrations/myhonor/reactivation/repository'
import {
  getMyHonorReactivationConfiguration,
  isAuthorizedMyHonorReactivationBearer,
  myHonorMarketingContactEventHash,
  myHonorMarketingContactEventSchema,
  normalizeMyHonorMarketingContactEvent,
} from '@/lib/integrations/myhonor/reactivation/types'

const MASTER_KEY = Buffer.alloc(32, 7).toString('base64')
const CURRENT_API_KEY = 'current-secret-value-with-at-least-32-bytes'
const PREVIOUS_API_KEY = 'previous-secret-value-with-at-least-32-bytes'

function event(overrides: Record<string, unknown> = {}) {
  return {
    schema_version: 1,
    event_id: 'myhonor:contact:00000000-0000-4000-8000-000000000001',
    source_version: 17,
    occurred_at: '2026-08-25T10:00:00+05:00',
    contact: {
      external_customer_id: 'customer-42',
      phone_e164: '+77051234567',
      first_name: ' Марина ',
      locale: 'ru',
      city: 'Алматы',
      interests: ['fishing', 'footwear', 'fishing'],
      size: 'L',
      budget_kzt: 80_000,
      club_status: 'not_member',
      customer_kind: 'retail',
    },
    lifecycle: {
      registered_at: '2025-01-01T10:00:00+05:00',
      last_activity_at: '2026-01-01T10:00:00+05:00',
      last_order_at: null,
      order_count: 0,
      lifetime_value_kzt: 0,
      last_order_product_ids: [],
      abandoned_cart: null,
      unresolved_complaint: false,
    },
    consent: {
      status: 'granted',
      purposes: ['product_recommendations'],
      source: 'account_settings',
      notice_version: 'marketing-2026-08-25',
      evidence_id: 'myhonor:consent:00000000-0000-4000-8000-000000000042',
      obtained_at: '2026-08-25T09:59:00+05:00',
      revoked_at: null,
      cross_border_disclosed: true,
    },
    ...overrides,
  }
}

function completeEnvironment(): Record<string, string | undefined> {
  return {
    MYHONOR_REACTIVATION_API_KEY: CURRENT_API_KEY,
    MYHONOR_REACTIVATION_API_KEY_PREVIOUS: PREVIOUS_API_KEY,
    MYHONOR_REACTIVATION_MASTER_KEY: MASTER_KEY,
    MYHONOR_REACTIVATION_OWNER_USER_ID: '123e4567-e89b-42d3-a456-426614174000',
    MYHONOR_REACTIVATION_COMPANY_ID: 'myhonor-company',
    MYHONOR_REACTIVATION_SEND_ENABLED: 'true',
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
  }
}

describe('MyHonor reactivation contact contract', () => {
  it('accepts explicit purpose consent and canonicalizes optional profile data', () => {
    const parsed = myHonorMarketingContactEventSchema.parse(event())
    const normalized = normalizeMyHonorMarketingContactEvent(parsed)
    expect(normalized.contact.first_name).toBe('Марина')
    expect(normalized.contact.interests).toEqual(['fishing', 'footwear'])
    expect(normalized.contact.budget_kzt).toBe(80_000)
    expect(normalized.lifecycle.marketing_hold).toBe(false)
    expect(normalized.lifecycle.marketing_hold_reason).toBeNull()
  })

  it('requires an explicit allowlisted reason whenever lifecycle marketing is held', () => {
    const lifecycle = event().lifecycle as Record<string, unknown>
    expect(() => myHonorMarketingContactEventSchema.parse(event({
      lifecycle: {
        ...lifecycle,
        marketing_hold: true,
        marketing_hold_reason: 'payment_unknown',
      },
    }))).not.toThrow()
    expect(() => myHonorMarketingContactEventSchema.parse(event({
      lifecycle: {
        ...lifecycle,
        marketing_hold: true,
        marketing_hold_reason: null,
      },
    }))).toThrow()
    expect(() => myHonorMarketingContactEventSchema.parse(event({
      lifecycle: {
        ...lifecycle,
        marketing_hold: false,
        marketing_hold_reason: 'open_order',
      },
    }))).toThrow()
  })

  it('rejects an implicit grant, missing cross-border disclosure, and unknown fields', () => {
    const invalidConsent = {
      ...(event().consent as Record<string, unknown>),
      purposes: [],
      cross_border_disclosed: false,
    }
    expect(() => myHonorMarketingContactEventSchema.parse(event({
      consent: invalidConsent,
    }))).toThrow()
    expect(() => myHonorMarketingContactEventSchema.parse({
      ...event(),
      arbitrary_message: 'send this text',
    })).toThrow()
  })

  it('requires a positive monotonic source version in the signed event body', () => {
    const missing: Record<string, unknown> = { ...event() }
    delete missing.source_version
    expect(() => myHonorMarketingContactEventSchema.parse(missing)).toThrow()
    expect(() => myHonorMarketingContactEventSchema.parse(event({
      source_version: 0,
    }))).toThrow()
    expect(() => myHonorMarketingContactEventSchema.parse(event({
      source_version: Number.MAX_SAFE_INTEGER + 1,
    }))).toThrow()
  })

  it('rejects event and evidence identifiers that can contain customer PII', () => {
    expect(() => myHonorMarketingContactEventSchema.parse(event({
      event_id: 'customer:+77051234567',
    }))).toThrow()
    expect(() => myHonorMarketingContactEventSchema.parse(event({
      consent: {
        ...(event().consent as Record<string, unknown>),
        evidence_id: 'marina@example.com',
      },
    }))).toThrow()
  })

  it('requires revocation time and clears all purposes when consent is revoked', () => {
    expect(() => myHonorMarketingContactEventSchema.parse(event({
      consent: {
        status: 'revoked',
        purposes: [],
        source: 'whatsapp_reply',
        notice_version: 'marketing-2026-08-25',
        evidence_id: 'whatsapp:stop:00000000-0000-4000-8000-000000000042',
        obtained_at: null,
        revoked_at: '2026-08-25T09:59:00+05:00',
        cross_border_disclosed: false,
      },
    }))).not.toThrow()
  })

  it('uses a stable canonical event hash', () => {
    const parsed = myHonorMarketingContactEventSchema.parse(event())
    const normalized = normalizeMyHonorMarketingContactEvent(parsed)
    expect(myHonorMarketingContactEventHash(normalized)).toMatch(/^[a-f0-9]{64}$/)
    expect(myHonorMarketingContactEventHash(normalized)).toBe(
      myHonorMarketingContactEventHash({
        ...normalized,
        contact: {
          ...normalized.contact,
          interests: ['fishing', 'footwear'],
        },
      }),
    )
  })
})

describe('MyHonor reactivation secrets and configuration', () => {
  it('encrypts PII with randomized AES-GCM and derives a stable non-phone hash', () => {
    const first = encryptContactValue('+77051234567', MASTER_KEY)
    const second = encryptContactValue('+77051234567', MASTER_KEY)
    expect(first).not.toBe(second)
    expect(decryptContactValue(first, MASTER_KEY)).toBe('+77051234567')
    expect(contactPhoneHash('+77051234567', MASTER_KEY)).toMatch(/^[a-f0-9]{64}$/)
    expect(contactPhoneHash('+77051234567', MASTER_KEY)).not.toContain('77051234567')
    expect(externalCustomerHash('customer-42', 'company-1', MASTER_KEY)).toMatch(
      /^[a-f0-9]{64}$/,
    )
    expect(externalCustomerHash('customer-42', 'company-1', MASTER_KEY)).not.toBe(
      externalCustomerHash('customer-42', 'company-2', MASTER_KEY),
    )
    expect(maskPhone('+77051234567')).toBe('+77••••••4567')
  })

  it('normalizes harmless E.164 formatting and rejects ambiguous local numbers', () => {
    expect(normalizeE164('+7 (705) 123-45-67')).toBe('+77051234567')
    expect(() => normalizeE164('87051234567')).toThrow()
  })

  it('keeps ingestion and live delivery as separate readiness gates', () => {
    const env = completeEnvironment()
    const complete = getMyHonorReactivationConfiguration(env)
    expect(complete.ingestReady).toBe(true)
    expect(complete.sendReady).toBe(true)

    const disabled = getMyHonorReactivationConfiguration({
      ...env,
      MYHONOR_REACTIVATION_SEND_ENABLED: 'false',
      WHATSAPP_TOKEN: undefined,
    })
    expect(disabled.ingestReady).toBe(true)
    expect(disabled.sendReady).toBe(false)
    expect(disabled.missingForSend).toContain('MYHONOR_REACTIVATION_SEND_ENABLED')
    expect(disabled.missingForSend).toContain('WHATSAPP_TOKEN')
  })

  it('fails ingestion closed when the shared bearer is shorter than 32 bytes', () => {
    const configuration = getMyHonorReactivationConfiguration({
      ...completeEnvironment(),
      MYHONOR_REACTIVATION_API_KEY: 'short-secret',
      MYHONOR_REACTIVATION_API_KEY_PREVIOUS: undefined,
    })
    expect(configuration.ingestReady).toBe(false)
    expect(configuration.apiKeys).toEqual([])
    expect(configuration.missingForIngest).toContain('MYHONOR_REACTIVATION_API_KEY')
  })

  it('accepts current or previous bearer but rejects other schemes', () => {
    const configuration = getMyHonorReactivationConfiguration(completeEnvironment())
    expect(isAuthorizedMyHonorReactivationBearer(
      `Bearer ${CURRENT_API_KEY}`,
      configuration.apiKeys,
    )).toBe(true)
    expect(isAuthorizedMyHonorReactivationBearer(
      `Bearer ${PREVIOUS_API_KEY}`,
      configuration.apiKeys,
    )).toBe(true)
    expect(isAuthorizedMyHonorReactivationBearer(
      `Basic ${CURRENT_API_KEY}`,
      configuration.apiKeys,
    )).toBe(false)
  })
})

describe('MyHonor reactivation recipient preview parsing', () => {
  it('allows an empty message only for an explicitly excluded or holdout row', async () => {
    const configuration = getMyHonorReactivationConfiguration(completeEnvironment())
    const templateParameters: string[] = []
    let recipientState = 'excluded'
    const client = {
      rpc: async () => ({
        data: [{
          recipient_id: '00000000-0000-4000-8000-000000000001',
          preview_snapshot_hash: 'a'.repeat(64),
          phone_masked: '+77••••••4567',
          locale: 'ru',
          recipient_state: recipientState,
          exclusion_reason: 'source_snapshot_stale',
          is_holdout: false,
          consent_snapshot: {},
          eligibility_snapshot: { segment: 'old_lead' },
          recommendation_snapshot: {},
          template_parameters_ciphertext: encryptContactValue(
            JSON.stringify(templateParameters),
            MASTER_KEY,
          ),
          template_parameters_hash: myHonorSnapshotHash(templateParameters),
          run_at: '2026-08-25T10:00:00.000Z',
        }],
        error: null,
      }),
    }

    const excluded = await listMyHonorReactivationRecipientPreviews({
      campaignId: '00000000-0000-4000-8000-000000000002',
      configuration,
    }, client as never)
    expect(excluded[0]?.messagePreview).toBeNull()

    recipientState = 'queued'
    await expect(listMyHonorReactivationRecipientPreviews({
      campaignId: '00000000-0000-4000-8000-000000000002',
      configuration,
    }, client as never)).rejects.toThrow('message contract is invalid')
  })

  it('does not render an unsupported-locale message for an excluded recipient', async () => {
    const configuration = getMyHonorReactivationConfiguration(completeEnvironment())
    const templateParameters = [
      'Куртка HONOR',
      '42 000 ₸',
      'https://myhonor.shop/product/kurtka-honor',
    ]
    const client = {
      rpc: async () => ({
        data: [{
          recipient_id: '00000000-0000-4000-8000-000000000003',
          preview_snapshot_hash: 'b'.repeat(64),
          phone_masked: '+77••••••4567',
          locale: 'kk',
          recipient_state: 'excluded',
          exclusion_reason: 'application_ineligible',
          is_holdout: false,
          consent_snapshot: {},
          eligibility_snapshot: {
            segment: 'old_lead',
            exclusions: ['template_locale_mismatch'],
          },
          recommendation_snapshot: {},
          template_parameters_ciphertext: encryptContactValue(
            JSON.stringify(templateParameters),
            MASTER_KEY,
          ),
          template_parameters_hash: myHonorSnapshotHash(templateParameters),
          run_at: '2026-08-25T10:00:00.000Z',
        }],
        error: null,
      }),
    }

    const rows = await listMyHonorReactivationRecipientPreviews({
      campaignId: '00000000-0000-4000-8000-000000000004',
      configuration,
    }, client as never)
    expect(rows[0]?.messagePreview).toBeNull()
  })
})

describe('MyHonor marketing policy', () => {
  it('allows only the conservative Almaty send window', () => {
    expect(isMyHonorMarketingQuietTime(new Date('2026-08-25T05:00:00Z'))).toBe(false)
    expect(isMyHonorMarketingQuietTime(new Date('2026-08-25T15:00:00Z'))).toBe(true)
    expect(isMyHonorMarketingQuietTime(new Date('2026-08-29T06:00:00Z'))).toBe(false)
    expect(isMyHonorMarketingQuietTime(new Date('2026-08-29T13:00:00Z'))).toBe(true)
    expect(nextMyHonorMarketingSendTime(new Date('2026-08-25T03:00:00Z')).getTime())
      .toBeGreaterThan(new Date('2026-08-25T03:00:00Z').getTime())
  })

  it('enforces both rolling gap and monthly cap', () => {
    const now = new Date('2026-08-25T10:00:00Z')
    expect(myHonorFrequencyExclusion({
      lastMarketingSentAt: '2026-08-20T10:00:00Z',
      marketingSentLast30Days: 1,
      frequencyCapDays: 7,
      monthlyCap: 3,
    }, now)).toBe('frequency_cap')
    expect(myHonorFrequencyExclusion({
      lastMarketingSentAt: '2026-08-01T10:00:00Z',
      marketingSentLast30Days: 3,
      frequencyCapDays: 7,
      monthlyCap: 3,
    }, now)).toBe('monthly_frequency_cap')
  })

  it('recognizes explicit Russian and Kazakh opt-outs', () => {
    expect(isMyHonorMarketingOptOut('Больше не пишите мне')).toBe(true)
    expect(isMyHonorMarketingOptOut('Маған хабарлама жібермеңіз')).toBe(true)
    expect(isMyHonorMarketingOptOut('Спасибо, не сейчас')).toBe(false)
  })
})
