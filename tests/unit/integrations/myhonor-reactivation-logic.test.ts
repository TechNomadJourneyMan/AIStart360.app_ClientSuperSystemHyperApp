import { describe, expect, it } from 'vitest'
import {
  evaluateMyHonorReactivationEligibility,
  type MyHonorReactivationEligibilityInput,
} from '@/lib/integrations/myhonor/reactivation/eligibility'
import {
  myHonorRecommendationAffinityExclusion,
  recommendVerifiedMyHonorProducts,
  type MyHonorProductRecommendation,
  type MyHonorVerifiedProduct,
} from '@/lib/integrations/myhonor/reactivation/recommendations'
import {
  classifyMyHonorReactivationSegments,
  selectPrimaryMyHonorReactivationSegment,
} from '@/lib/integrations/myhonor/reactivation/segmentation'
import {
  buildMyHonorApprovedTemplate,
  MYHONOR_TEMPLATE_PARAMETER_CONTRACT,
} from '@/lib/integrations/myhonor/reactivation/templates'
import {
  myHonorMarketingContactEventSchema,
  normalizeMyHonorMarketingContactEvent,
  type MyHonorMarketingContactEvent,
} from '@/lib/integrations/myhonor/reactivation/types'

const NOW = new Date('2026-08-25T08:00:00.000Z')
const DAY_MS = 24 * 60 * 60 * 1000
const CLUB_URL = 'https://chat.whatsapp.com/JDaVNsnloFMF0RpOtLSDRW?mode=gi_t'

function daysAgo(days: number): string {
  return new Date(NOW.getTime() - days * DAY_MS).toISOString()
}

function event(
  overrides: {
    registeredAt?: string | null
    lastActivityAt?: string | null
    lastOrderAt?: string | null
    orderCount?: number
    interests?: MyHonorMarketingContactEvent['contact']['interests']
    clubStatus?: MyHonorMarketingContactEvent['contact']['club_status']
    abandonedCart?: MyHonorMarketingContactEvent['lifecycle']['abandoned_cart']
  } = {},
) {
  return normalizeMyHonorMarketingContactEvent(
    myHonorMarketingContactEventSchema.parse({
      schema_version: 1,
      event_id: 'myhonor:test:00000000-0000-4000-8000-000000000001',
      source_version: 1,
      occurred_at: NOW.toISOString(),
      contact: {
        external_customer_id: 'customer-1',
        phone_e164: '+77001234567',
        locale: 'ru',
        city: 'Астана',
        interests: overrides.interests ?? [],
        size: 'L',
        budget_kzt: 50_000,
        club_status: overrides.clubStatus ?? 'unknown',
        customer_kind: 'retail',
      },
      lifecycle: {
        registered_at: overrides.registeredAt ?? null,
        last_activity_at: overrides.lastActivityAt ?? null,
        last_order_at: overrides.lastOrderAt ?? null,
        order_count: overrides.orderCount ?? 0,
        lifetime_value_kzt: 0,
        last_order_product_ids: [],
        abandoned_cart: overrides.abandonedCart ?? null,
        unresolved_complaint: false,
      },
      consent: {
        status: 'granted',
        purposes: ['product_recommendations'],
        source: 'checkout_checkbox',
        notice_version: 'marketing-v1',
        evidence_id: 'myhonor:evidence:00000000-0000-4000-8000-000000000001',
        obtained_at: daysAgo(180),
        cross_border_disclosed: true,
      },
    }),
  )
}

function product(
  suffix: string,
  overrides: Partial<MyHonorVerifiedProduct> = {},
): MyHonorVerifiedProduct {
  const id = `myhonor:${suffix.repeat(64).slice(0, 64)}`
  return {
    id,
    name: `Костюм ${suffix.toUpperCase()}`,
    canonicalUrl: `https://myhonor.shop/product/kostyum-${suffix}`,
    priceKzt: 35_000,
    currency: 'KZT',
    catalogActive: true,
    availability: 'in_stock',
    verificationStatus: 'verified',
    verifiedAt: daysAgo(1),
    interests: ['hunting'],
    seasons: ['autumn'],
    variants: [{
      id: `variant-${suffix}`,
      active: true,
      size: 'L',
      color: 'Хаки',
      priceKzt: null,
      stocks: [{
        warehouseCode: `warehouse-${suffix}`,
        city: 'Астана',
        availableQuantity: 3,
        verifiedAt: daysAgo(1),
      }],
    }],
    ...overrides,
  }
}

function recommendation(): MyHonorProductRecommendation {
  const selected = recommendVerifiedMyHonorProducts({
    products: [product('a')],
    profile: {
      interests: ['hunting'],
      seasons: ['autumn'],
      size: 'L',
      budgetKzt: 50_000,
      city: 'Астана',
    },
    now: NOW,
  })
  if (!selected[0]) throw new Error('test recommendation was not selected')
  return selected[0]
}

function eligibleInput(
  overrides: Partial<MyHonorReactivationEligibilityInput> = {},
): MyHonorReactivationEligibilityInput {
  return {
    segment: 'old_lead',
    phoneE164: '+77001234567',
    consent: {
      status: 'granted',
      purposes: ['product_recommendations'],
      source: 'checkout_checkbox',
      notice_version: 'marketing-v1',
      evidence_id: 'myhonor:evidence:00000000-0000-4000-8000-000000000001',
      obtained_at: daysAgo(180),
      cross_border_disclosed: true,
    },
    suppressed: false,
    optedOut: false,
    unresolvedComplaint: false,
    sourceUpdatedAt: NOW.toISOString(),
    lastMarketingSentAt: null,
    marketingSentLast30Days: 0,
    frequencyCapDays: 14,
    monthlyCap: 3,
    now: NOW,
    ...overrides,
  }
}

describe('MyHonor reactivation segmentation', () => {
  it('classifies old leads and registered customers without orders without overlap', () => {
    const oldLead = classifyMyHonorReactivationSegments(event({
      lastActivityAt: daysAgo(40),
    }), { now: NOW })
    expect(oldLead.map((match) => match.segment)).toEqual(['old_lead'])

    const registered = classifyMyHonorReactivationSegments(event({
      registeredAt: daysAgo(12),
      lastActivityAt: daysAgo(5),
    }), { now: NOW })
    expect(registered.map((match) => match.segment)).toEqual(['registered_no_order'])
  })

  it('classifies dormant and post-purchase windows deterministically', () => {
    const dormant = classifyMyHonorReactivationSegments(event({
      registeredAt: daysAgo(400),
      lastActivityAt: daysAgo(120),
      lastOrderAt: daysAgo(130),
      orderCount: 2,
    }), { now: NOW })
    expect(dormant.map((match) => match.segment)).toEqual(['dormant_customer'])

    const postPurchase = classifyMyHonorReactivationSegments(event({
      registeredAt: daysAgo(100),
      lastActivityAt: daysAgo(20),
      lastOrderAt: daysAgo(20),
      orderCount: 1,
    }), { now: NOW })
    expect(postPurchase.map((match) => match.segment)).toEqual(['post_purchase'])
  })

  it('classifies only an active cart aged from two hours to fourteen days', () => {
    const productId = `myhonor:${'a'.repeat(64)}`
    const sixHoursAgo = new Date(NOW.getTime() - 6 * 60 * 60 * 1_000).toISOString()
    const oneHourAgo = new Date(NOW.getTime() - 60 * 60 * 1_000).toISOString()

    const abandoned = classifyMyHonorReactivationSegments(event({
      lastActivityAt: sixHoursAgo,
      abandonedCart: {
        active: true,
        updated_at: sixHoursAgo,
        product_ids: [productId],
      },
    }), { now: NOW })
    expect(abandoned.map((match) => match.segment)).toEqual(['abandoned_cart'])

    const tooFresh = classifyMyHonorReactivationSegments(event({
      lastActivityAt: oneHourAgo,
      abandonedCart: {
        active: true,
        updated_at: oneHourAgo,
        product_ids: [productId],
      },
    }), { now: NOW })
    expect(tooFresh).toEqual([])

    const completedAfterCart = classifyMyHonorReactivationSegments(event({
      lastActivityAt: daysAgo(3),
      lastOrderAt: daysAgo(2),
      orderCount: 1,
      abandonedCart: {
        active: true,
        updated_at: daysAgo(3),
        product_ids: [productId],
      },
    }), { now: NOW })
    expect(completedAfterCart.map((match) => match.segment))
      .not.toContain('abandoned_cart')
  })

  it('requires explicit campaign signals for seasonal, club and back-in-stock', () => {
    const contact = event({
      lastActivityAt: daysAgo(2),
      interests: ['hunting'],
      clubStatus: 'not_member',
    })
    expect(classifyMyHonorReactivationSegments(contact, { now: NOW })).toEqual([])
    expect(classifyMyHonorReactivationSegments(contact, {
      now: NOW,
      signals: { backInStockProductIds: ['not-a-canonical-product'] },
    })).toEqual([])

    const matches = classifyMyHonorReactivationSegments(contact, {
      now: NOW,
      signals: {
        seasonalCampaignActive: true,
        seasonalInterests: ['hunting'],
        clubInterest: true,
        backInStockProductIds: [`myhonor:${'a'.repeat(64)}`],
      },
    })
    expect(matches.map((match) => match.segment)).toEqual([
      'back_in_stock',
      'club_interest',
      'seasonal',
    ])
    expect(selectPrimaryMyHonorReactivationSegment(matches)?.segment)
      .toBe('back_in_stock')
  })
})

describe('MyHonor reactivation eligibility', () => {
  it('permits only an E.164 contact with proven purpose-specific consent', () => {
    expect(evaluateMyHonorReactivationEligibility(eligibleInput())).toEqual({
      eligible: true,
      requiredPurpose: 'product_recommendations',
      exclusions: [],
    })
  })

  it('fails closed for invalid identity, missing purpose, suppression and complaints', () => {
    const result = evaluateMyHonorReactivationEligibility(eligibleInput({
      phoneE164: '77001234567',
      consent: {
        status: 'granted',
        purposes: ['marketing_offers'],
        source: 'checkout_checkbox',
        notice_version: 'marketing-v1',
        evidence_id: 'myhonor:evidence:00000000-0000-4000-8000-000000000001',
        obtained_at: daysAgo(180),
        cross_border_disclosed: true,
      },
      suppressed: true,
      optedOut: true,
      unresolvedComplaint: true,
      manualHold: true,
      providerMarketingLimited: true,
    }))
    expect(result.eligible).toBe(false)
    expect(result.exclusions).toEqual(expect.arrayContaining([
      'invalid_phone_e164',
      'required_purpose_not_granted',
      'suppressed',
      'opted_out',
      'unresolved_complaint',
      'manual_hold',
      'provider_marketing_limit',
    ]))
  })

  it('enforces cooling periods and both frequency caps', () => {
    const result = evaluateMyHonorReactivationEligibility(eligibleInput({
      cooldownUntil: new Date(NOW.getTime() + DAY_MS).toISOString(),
      lastMarketingSentAt: daysAgo(3),
      marketingSentLast30Days: 3,
    }))
    expect(result.exclusions).toEqual(expect.arrayContaining([
      'cooling_period',
      'monthly_frequency_cap',
    ]))
  })

  it('fails closed when the Store lifecycle snapshot is more than 24 hours old', () => {
    const stale = evaluateMyHonorReactivationEligibility(eligibleInput({
      sourceUpdatedAt: new Date(NOW.getTime() - 24 * 60 * 60_000 - 1).toISOString(),
    }))
    expect(stale.eligible).toBe(false)
    expect(stale.exclusions).toContain('source_snapshot_stale')

    const fresh = evaluateMyHonorReactivationEligibility(eligibleInput({
      sourceUpdatedAt: new Date(NOW.getTime() - 24 * 60 * 60_000).toISOString(),
    }))
    expect(fresh.exclusions).not.toContain('source_snapshot_stale')
  })

  it('requires club-specific consent for the club segment', () => {
    const denied = evaluateMyHonorReactivationEligibility(eligibleInput({
      segment: 'club_interest',
    }))
    expect(denied.requiredPurpose).toBe('club_updates')
    expect(denied.exclusions).toContain('required_purpose_not_granted')
  })
})

describe('verified MyHonor product recommendations', () => {
  it('requires proven interest affinity for broad lifecycle segments', () => {
    for (const segment of [
      'old_lead',
      'registered_no_order',
      'dormant_customer',
      'post_purchase',
    ] as const) {
      expect(myHonorRecommendationAffinityExclusion({
        segment,
        campaignInterest: null,
        contactInterests: [],
      })).toBe('insufficient_personalization')
      expect(myHonorRecommendationAffinityExclusion({
        segment,
        campaignInterest: 'fishing',
        contactInterests: [],
      })).toBeNull()
      expect(myHonorRecommendationAffinityExclusion({
        segment,
        campaignInterest: null,
        contactInterests: ['hunting'],
      })).toBeNull()
    }

    for (const segment of [
      'abandoned_cart',
      'back_in_stock',
      'seasonal',
      'club_interest',
    ] as const) {
      expect(myHonorRecommendationAffinityExclusion({
        segment,
        campaignInterest: null,
        contactInterests: [],
      })).toBeNull()
    }
  })

  it('uses only fresh verified active products, exact size, budget and sellable stock', () => {
    const valid = product('a')
    const products = [
      valid,
      product('b', { verificationStatus: 'unverified' }),
      product('c', { catalogActive: false }),
      product('d', { verifiedAt: daysAgo(20) }),
      product('e', { priceKzt: 80_000 }),
      product('f', {
        variants: [{
          id: 'variant-f',
          active: true,
          size: 'XL',
          color: null,
          priceKzt: null,
          stocks: [{
            warehouseCode: 'warehouse-f',
            city: 'Астана',
            availableQuantity: 4,
            verifiedAt: daysAgo(1),
          }],
        }],
      }),
    ]
    const result = recommendVerifiedMyHonorProducts({
      products,
      profile: {
        interests: ['hunting'],
        seasons: ['autumn'],
        size: 'L',
        budgetKzt: 50_000,
        city: 'Астана',
      },
      now: NOW,
    })
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      productId: valid.id,
      canonicalUrl: valid.canonicalUrl,
      priceKzt: 35_000,
      size: 'L',
      stockCity: 'Астана',
      stockScope: 'requested_city',
    })
  })

  it('prefers city stock and remains stable regardless of input ordering', () => {
    const cheap = product('a', { priceKzt: 30_000 })
    const local = product('b', { priceKzt: 35_000 })
    const remote = product('c', {
      priceKzt: 20_000,
      variants: [{
        id: 'variant-c',
        active: true,
        size: 'L',
        color: null,
        priceKzt: null,
        stocks: [{
          warehouseCode: 'warehouse-c',
          city: 'Алматы',
          availableQuantity: 10,
          verifiedAt: daysAgo(1),
        }],
      }],
    })
    const profile = {
      interests: ['hunting'] as const,
      seasons: ['autumn'] as const,
      size: 'L',
      budgetKzt: 50_000,
      city: 'Астана',
    }
    const first = recommendVerifiedMyHonorProducts({
      products: [remote, local, cheap], profile, now: NOW, limit: 3,
    })
    const second = recommendVerifiedMyHonorProducts({
      products: [cheap, remote, local], profile, now: NOW, limit: 3,
    })
    expect(first.map((item) => item.productId))
      .toEqual(second.map((item) => item.productId))
    expect(first.map((item) => item.productId)).toEqual([
      cheap.id,
      local.id,
      remote.id,
    ])
  })

  it('supports contact-specific back-in-stock and exact-city restrictions', () => {
    const local = product('a')
    const remote = product('b', {
      variants: [{
        id: 'variant-b',
        active: true,
        size: 'L',
        color: null,
        priceKzt: null,
        stocks: [{
          warehouseCode: 'warehouse-b',
          city: 'Алматы',
          availableQuantity: 2,
          verifiedAt: daysAgo(1),
        }],
      }],
    })
    const result = recommendVerifiedMyHonorProducts({
      products: [local, remote],
      profile: {
        interests: ['hunting'], seasons: ['autumn'], size: 'L',
        budgetKzt: 50_000, city: 'Астана',
      },
      requiredProductIds: [remote.id],
      requireCityStock: true,
      now: NOW,
    })
    expect(result).toEqual([])
  })

  it('does not claim another city when the customer city is unknown', () => {
    const result = recommendVerifiedMyHonorProducts({
      products: [product('a')],
      profile: {
        interests: ['hunting'], seasons: ['autumn'], size: 'L',
        budgetKzt: 50_000, city: null,
      },
      now: NOW,
    })
    expect(result[0]?.stockScope).toBe('unspecified_city')
  })
})

describe('approved MyHonor template mapping', () => {
  const utmCampaign = 'autumn_return_2026'

  it('maps product segments to the configured approved template and verified facts', () => {
    const selected = recommendation()
    const result = buildMyHonorApprovedTemplate({
      segment: 'old_lead',
      templateName: 'myhonor_old_lead_v1',
      languageCode: 'ru',
      locale: 'ru',
      recommendations: [selected],
      catalogUrl: 'https://myhonor.shop/catalog',
      clubInviteUrl: CLUB_URL,
      utmCampaign,
    })
    expect(result).toMatchObject({
      templateName: 'myhonor_old_lead_v1',
      languageCode: 'ru',
      parameterContract: MYHONOR_TEMPLATE_PARAMETER_CONTRACT.old_lead,
      sourceProductId: selected.productId,
      ctas: [{ kind: 'product', url: expect.stringContaining('utm_campaign=autumn_return_2026') }],
    })
    expect(result?.bodyParameters).toEqual([
      selected.name,
      expect.stringContaining('35'),
      expect.stringMatching(/^https:\/\/myhonor\.shop\/product\/.+utm_source=whatsapp/),
    ])
  })

  it('uses the exact cart product with the abandoned-cart template contract', () => {
    const selected = recommendation()
    const result = buildMyHonorApprovedTemplate({
      segment: 'abandoned_cart',
      templateName: 'myhonor_abandoned_cart_v1',
      languageCode: 'ru',
      locale: 'ru',
      recommendations: [selected],
      catalogUrl: 'https://myhonor.shop/catalog',
      clubInviteUrl: CLUB_URL,
      utmCampaign,
    })
    expect(result).toMatchObject({
      templateName: 'myhonor_abandoned_cart_v1',
      parameterContract: MYHONOR_TEMPLATE_PARAMETER_CONTRACT.abandoned_cart,
      sourceProductId: selected.productId,
    })
  })

  it('uses fixed seasonal and club contracts without generated sales claims', () => {
    const selected = recommendation()
    const seasonal = buildMyHonorApprovedTemplate({
      segment: 'seasonal',
      templateName: 'myhonor_seasonal_v1',
      languageCode: 'ru',
      locale: 'ru',
      recommendations: [selected],
      season: 'autumn',
      catalogUrl: 'https://myhonor.shop/catalog',
      clubInviteUrl: CLUB_URL,
      utmCampaign,
    })
    expect(seasonal?.bodyParameters).toEqual([
      'осень', selected.name, expect.stringContaining('35'),
      expect.stringContaining('utm_campaign=autumn_return_2026'),
    ])

    const club = buildMyHonorApprovedTemplate({
      segment: 'club_interest',
      templateName: 'myhonor_club_v1',
      languageCode: 'ru',
      locale: 'ru',
      recommendations: [],
      catalogUrl: 'https://myhonor.shop/catalog',
      clubInviteUrl: CLUB_URL,
      utmCampaign,
    })
    expect(club?.bodyParameters).toEqual([
      expect.stringContaining('https://myhonor.shop/catalog?utm_source=whatsapp'), CLUB_URL,
    ])
    expect(club?.ctas.map((cta) => cta.kind)).toEqual(['club', 'catalog'])
    expect(club?.sourceProductId).toBeNull()
  })

  it('fails closed for unapproved names, unsafe URLs or missing required facts', () => {
    expect(buildMyHonorApprovedTemplate({
      segment: 'old_lead',
      templateName: 'Not Approved',
      languageCode: 'ru',
      locale: 'ru',
      recommendations: [],
      catalogUrl: 'https://myhonor.shop/catalog',
      clubInviteUrl: CLUB_URL,
      utmCampaign,
    })).toBeNull()
    expect(buildMyHonorApprovedTemplate({
      segment: 'club_interest',
      templateName: 'myhonor_club_v1',
      languageCode: 'ru',
      locale: 'ru',
      recommendations: [],
      catalogUrl: 'https://evil.example/catalog',
      clubInviteUrl: CLUB_URL,
      utmCampaign,
    })).toBeNull()
    expect(buildMyHonorApprovedTemplate({
      segment: 'club_interest',
      templateName: 'myhonor_club_v1',
      languageCode: 'ru',
      locale: 'ru',
      recommendations: [],
      catalogUrl: 'https://myhonor.shop/catalog',
      clubInviteUrl: CLUB_URL,
      utmCampaign: '../unsafe tag',
    })).toBeNull()
  })
})
