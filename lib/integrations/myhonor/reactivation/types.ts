import { createHash, timingSafeEqual } from 'node:crypto'
import { z } from 'zod'

export const MYHONOR_REACTIVATION_SEGMENTS = [
  'old_lead',
  'abandoned_cart',
  'registered_no_order',
  'dormant_customer',
  'post_purchase',
  'seasonal',
  'club_interest',
  'back_in_stock',
] as const

export type MyHonorReactivationSegment =
  (typeof MYHONOR_REACTIVATION_SEGMENTS)[number]

export const MYHONOR_REACTIVATION_INTERESTS = [
  'hunting',
  'fishing',
  'outdoor',
  'mountains',
  'tactical',
  'footwear',
  'base_layer',
  'accessories',
] as const

export type MyHonorReactivationInterest =
  (typeof MYHONOR_REACTIVATION_INTERESTS)[number]

export const MYHONOR_REACTIVATION_SEASONS = [
  'spring',
  'summer',
  'autumn',
  'winter',
  'all_season',
] as const

export type MyHonorReactivationSeason =
  (typeof MYHONOR_REACTIVATION_SEASONS)[number]

export const MYHONOR_MARKETING_PURPOSES = [
  'marketing_offers',
  'product_recommendations',
  'club_updates',
] as const

export type MyHonorMarketingPurpose =
  (typeof MYHONOR_MARKETING_PURPOSES)[number]

export const MYHONOR_MARKETING_HOLD_REASONS = [
  'open_order',
  'recent_cancel_or_return',
  'payment_unknown',
  'source_incomplete',
  'identity_conflict',
  'manual_review',
] as const

export type MyHonorMarketingHoldReason =
  (typeof MYHONOR_MARKETING_HOLD_REASONS)[number]

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const PRODUCT_ID = /^myhonor:[a-f0-9]{64}$/
export const MYHONOR_OPAQUE_ID_PATTERN =
  /^(?:myhonor|whatsapp|meta-wa)(?::[a-z][a-z0-9-]{0,39})?:(?:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|[a-f0-9]{64})$/

const optionalTimestamp = z.string().datetime({ offset: true }).nullable().optional()
const optionalShortText = (max: number) =>
  z.string().trim().min(1).max(max).nullable().optional()

const consentSchema = z
  .object({
    status: z.enum(['granted', 'revoked']),
    purposes: z.array(z.enum(MYHONOR_MARKETING_PURPOSES)).max(3),
    source: z.enum([
      'checkout_checkbox',
      'account_settings',
      'whatsapp_reply',
      'in_store',
      'import_verified',
    ]),
    notice_version: z.string().trim().min(1).max(100),
    evidence_id: z.string().trim().max(200).regex(MYHONOR_OPAQUE_ID_PATTERN),
    obtained_at: optionalTimestamp,
    revoked_at: optionalTimestamp,
    cross_border_disclosed: z.boolean(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.status === 'granted') {
      if (value.purposes.length === 0) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['purposes'],
          message: 'granted consent requires at least one purpose',
        })
      }
      if (!value.obtained_at) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['obtained_at'],
          message: 'granted consent requires obtained_at',
        })
      }
      if (value.revoked_at) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['revoked_at'],
          message: 'granted consent cannot include revoked_at',
        })
      }
      if (!value.cross_border_disclosed) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['cross_border_disclosed'],
          message: 'granted consent requires cross-border disclosure',
        })
      }
    } else {
      if (!value.revoked_at) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['revoked_at'],
          message: 'revoked consent requires revoked_at',
        })
      }
      if (value.purposes.length > 0) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['purposes'],
          message: 'revoked consent must not retain active purposes',
        })
      }
    }
  })

export const myHonorMarketingContactEventSchema = z
  .object({
    schema_version: z.literal(1),
    event_id: z.string().trim().max(200).regex(MYHONOR_OPAQUE_ID_PATTERN),
    source_version: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    occurred_at: z.string().datetime({ offset: true }),
    contact: z
      .object({
        external_customer_id: z.string().trim().min(1).max(200),
        phone_e164: z.string().regex(/^\+[1-9][0-9]{7,14}$/),
        first_name: optionalShortText(80),
        locale: z.enum(['ru', 'kk']).default('ru'),
        city: optionalShortText(120),
        interests: z
          .array(z.enum(MYHONOR_REACTIVATION_INTERESTS))
          .max(MYHONOR_REACTIVATION_INTERESTS.length)
          .default([]),
        size: optionalShortText(40),
        budget_kzt: z.number().int().min(0).max(100_000_000).nullable().optional(),
        club_status: z.enum(['member', 'not_member', 'unknown']).default('unknown'),
        customer_kind: z.enum(['retail', 'wholesale', 'unknown']).default('unknown'),
      })
      .strict(),
    lifecycle: z
      .object({
        registered_at: optionalTimestamp,
        last_activity_at: optionalTimestamp,
        last_order_at: optionalTimestamp,
        order_count: z.number().int().min(0).max(1_000_000).default(0),
        lifetime_value_kzt: z.number().min(0).max(1_000_000_000_000).default(0),
        last_order_product_ids: z.array(z.string().regex(PRODUCT_ID)).max(50).default([]),
        abandoned_cart: z
          .object({
            active: z.boolean(),
            updated_at: z.string().datetime({ offset: true }),
            product_ids: z.array(z.string().regex(PRODUCT_ID)).min(1).max(50),
          })
          .strict()
          .nullable()
          .default(null),
        club_interest: z.boolean().default(false),
        back_in_stock_product_ids: z
          .array(z.string().regex(PRODUCT_ID))
          .max(50)
          .default([]),
        unresolved_complaint: z.boolean().default(false),
        marketing_hold: z.boolean().default(false),
        marketing_hold_reason: z
          .enum(MYHONOR_MARKETING_HOLD_REASONS)
          .nullable()
          .default(null),
      })
      .strict()
      .superRefine((value, context) => {
        if (value.marketing_hold && !value.marketing_hold_reason) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['marketing_hold_reason'],
            message: 'marketing hold requires a reason',
          })
        }
        if (!value.marketing_hold && value.marketing_hold_reason) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['marketing_hold_reason'],
            message: 'marketing hold reason requires an active hold',
          })
        }
      }),
    consent: consentSchema,
  })
  .strict()
  .superRefine((value, context) => {
    const occurred = Date.parse(value.occurred_at)
    const evidenceTime = value.consent.status === 'granted'
      ? value.consent.obtained_at
      : value.consent.revoked_at
    if (evidenceTime && Date.parse(evidenceTime) > occurred + 5 * 60_000) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['consent'],
        message: 'consent evidence cannot occur after the event',
      })
    }
  })

export type MyHonorMarketingContactEvent = z.infer<
  typeof myHonorMarketingContactEventSchema
>

export interface NormalizedMyHonorMarketingContactEvent
  extends Omit<MyHonorMarketingContactEvent, 'contact'> {
  contact: Omit<MyHonorMarketingContactEvent['contact'], 'first_name' | 'city' | 'size' | 'budget_kzt'> & {
    first_name: string | null
    city: string | null
    size: string | null
    budget_kzt: number | null
  }
}

export const myHonorCampaignDraftSchema = z
  .object({
    name: z.string().trim().min(3).max(160),
    segment: z.enum(MYHONOR_REACTIVATION_SEGMENTS),
    interest: z.enum(MYHONOR_REACTIVATION_INTERESTS).nullable().optional(),
    season: z.enum(MYHONOR_REACTIVATION_SEASONS).nullable().optional(),
    inactivity_days: z.number().int().min(3).max(730).default(90),
    frequency_cap_days: z.number().int().min(7).max(365).default(14),
    monthly_cap: z.number().int().min(1).max(3).default(3),
    daily_limit: z.number().int().min(1).max(100).default(10),
    holdout_percent: z.number().int().min(0).max(50).default(10),
    product_limit: z.number().int().min(1).max(3).default(2),
    dry_run: z.boolean().default(true),
    utm_campaign: z
      .string()
      .trim()
      .min(3)
      .max(100)
      .regex(/^[a-z0-9][a-z0-9_-]*$/),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.segment === 'seasonal' && !value.season) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['season'],
        message: 'seasonal campaign requires a season',
      })
    }
  })

export type MyHonorCampaignDraftInput = z.infer<
  typeof myHonorCampaignDraftSchema
>

export const MYHONOR_REACTIVATION_ENV_NAMES = {
  apiKey: 'MYHONOR_REACTIVATION_API_KEY',
  previousApiKey: 'MYHONOR_REACTIVATION_API_KEY_PREVIOUS',
  masterKey: 'MYHONOR_REACTIVATION_MASTER_KEY',
  ownerUserId: 'MYHONOR_REACTIVATION_OWNER_USER_ID',
  companyId: 'MYHONOR_REACTIVATION_COMPANY_ID',
  sendEnabled: 'MYHONOR_REACTIVATION_SEND_ENABLED',
  whatsappToken: 'WHATSAPP_TOKEN',
  whatsappPhoneNumberId: 'WHATSAPP_PHONE_NUMBER_ID',
  whatsappBusinessAccountId: 'WHATSAPP_BUSINESS_ACCOUNT_ID',
  templateLanguage: 'WHATSAPP_TEMPLATE_LANGUAGE',
  templates: {
    old_lead: 'WHATSAPP_TEMPLATE_REACTIVATION_OLD_LEAD',
    abandoned_cart: 'WHATSAPP_TEMPLATE_REACTIVATION_ABANDONED_CART',
    registered_no_order: 'WHATSAPP_TEMPLATE_REACTIVATION_REGISTERED',
    dormant_customer: 'WHATSAPP_TEMPLATE_REACTIVATION_DORMANT',
    post_purchase: 'WHATSAPP_TEMPLATE_REACTIVATION_POST_PURCHASE',
    seasonal: 'WHATSAPP_TEMPLATE_REACTIVATION_SEASONAL',
    club_interest: 'WHATSAPP_TEMPLATE_REACTIVATION_CLUB',
    back_in_stock: 'WHATSAPP_TEMPLATE_REACTIVATION_BACK_IN_STOCK',
  },
} as const

type Environment = Readonly<Record<string, string | undefined>>

export interface MyHonorReactivationConfiguration {
  ingestReady: boolean
  sendReady: boolean
  sendEnabled: boolean
  missingForIngest: string[]
  missingForSend: string[]
  apiKeys: string[]
  masterKey: string | null
  ownerUserId: string | null
  companyId: string | null
  whatsappPhoneNumberId: string | null
  whatsappBusinessAccountId: string | null
  templateLanguage: string | null
  templates: Record<MyHonorReactivationSegment, string | null>
}

function nonEmpty(value: string | undefined): string | null {
  return value?.trim() || null
}

function validApiKey(value: string | null): value is string {
  return Boolean(value && Buffer.byteLength(value, 'utf8') >= 32)
}

function booleanFlag(value: string | undefined): boolean {
  return /^(?:1|true|yes|on)$/i.test(value?.trim() ?? '')
}

function validMasterKey(value: string | null): value is string {
  if (!value) return false
  try {
    return Buffer.from(value, 'base64').length === 32
  } catch {
    return false
  }
}

function validTemplateName(value: string | null): value is string {
  return Boolean(value && /^[a-z0-9_]{1,512}$/.test(value))
}

function validLanguage(value: string | null): value is string {
  return Boolean(value && /^[a-z]{2,3}(?:_[A-Z]{2})?$/.test(value))
}

export function getMyHonorReactivationConfiguration(
  env: Environment = process.env,
): MyHonorReactivationConfiguration {
  const apiKeys = [
    nonEmpty(env[MYHONOR_REACTIVATION_ENV_NAMES.apiKey]),
    nonEmpty(env[MYHONOR_REACTIVATION_ENV_NAMES.previousApiKey]),
  ].filter(validApiKey)
  const rawMasterKey = nonEmpty(env[MYHONOR_REACTIVATION_ENV_NAMES.masterKey])
  const masterKey = validMasterKey(rawMasterKey) ? rawMasterKey : null
  const rawOwner = nonEmpty(env[MYHONOR_REACTIVATION_ENV_NAMES.ownerUserId])
  const ownerUserId = rawOwner && UUID.test(rawOwner) ? rawOwner : null
  const companyId = nonEmpty(env[MYHONOR_REACTIVATION_ENV_NAMES.companyId])
  const whatsappToken = nonEmpty(env[MYHONOR_REACTIVATION_ENV_NAMES.whatsappToken])
  const whatsappPhoneNumberId = nonEmpty(
    env[MYHONOR_REACTIVATION_ENV_NAMES.whatsappPhoneNumberId],
  )
  const whatsappBusinessAccountId = nonEmpty(
    env[MYHONOR_REACTIVATION_ENV_NAMES.whatsappBusinessAccountId],
  )
  const rawLanguage = nonEmpty(env[MYHONOR_REACTIVATION_ENV_NAMES.templateLanguage])
  const templateLanguage = validLanguage(rawLanguage) ? rawLanguage : null
  const templates = Object.fromEntries(
    MYHONOR_REACTIVATION_SEGMENTS.map((segment) => {
      const value = nonEmpty(env[MYHONOR_REACTIVATION_ENV_NAMES.templates[segment]])
      return [segment, validTemplateName(value) ? value : null]
    }),
  ) as Record<MyHonorReactivationSegment, string | null>
  const missingForIngest: string[] = []
  if (apiKeys.length === 0) missingForIngest.push(MYHONOR_REACTIVATION_ENV_NAMES.apiKey)
  if (!masterKey) missingForIngest.push(MYHONOR_REACTIVATION_ENV_NAMES.masterKey)
  if (!ownerUserId) missingForIngest.push(MYHONOR_REACTIVATION_ENV_NAMES.ownerUserId)
  if (!companyId) missingForIngest.push(MYHONOR_REACTIVATION_ENV_NAMES.companyId)

  const missingForSend = [...missingForIngest]
  if (!booleanFlag(env[MYHONOR_REACTIVATION_ENV_NAMES.sendEnabled])) {
    missingForSend.push(MYHONOR_REACTIVATION_ENV_NAMES.sendEnabled)
  }
  if (!whatsappToken) missingForSend.push(MYHONOR_REACTIVATION_ENV_NAMES.whatsappToken)
  if (!whatsappPhoneNumberId) {
    missingForSend.push(MYHONOR_REACTIVATION_ENV_NAMES.whatsappPhoneNumberId)
  }
  if (!whatsappBusinessAccountId) {
    missingForSend.push(MYHONOR_REACTIVATION_ENV_NAMES.whatsappBusinessAccountId)
  }
  if (!templateLanguage) {
    missingForSend.push(MYHONOR_REACTIVATION_ENV_NAMES.templateLanguage)
  }
  for (const segment of MYHONOR_REACTIVATION_SEGMENTS) {
    if (!templates[segment]) {
      missingForSend.push(MYHONOR_REACTIVATION_ENV_NAMES.templates[segment])
    }
  }

  return {
    ingestReady: missingForIngest.length === 0,
    sendReady: missingForSend.length === 0,
    sendEnabled: booleanFlag(env[MYHONOR_REACTIVATION_ENV_NAMES.sendEnabled]),
    missingForIngest,
    missingForSend,
    apiKeys,
    masterKey,
    ownerUserId,
    companyId,
    whatsappPhoneNumberId,
    whatsappBusinessAccountId,
    templateLanguage,
    templates,
  }
}

export function isAuthorizedMyHonorReactivationBearer(
  header: string | null,
  keys: readonly string[],
): boolean {
  const supplied = header?.match(/^Bearer ([^\s]+)$/)?.[1]
  if (!supplied) return false
  const suppliedBytes = Buffer.from(supplied)
  return keys.reduce((matched, key) => {
    const keyBytes = Buffer.from(key)
    return (
      matched
      || (keyBytes.length === suppliedBytes.length
        && timingSafeEqual(keyBytes, suppliedBytes))
    )
  }, false)
}

export function normalizeMyHonorMarketingContactEvent(
  input: MyHonorMarketingContactEvent,
): NormalizedMyHonorMarketingContactEvent {
  return {
    ...input,
    contact: {
      ...input.contact,
      first_name: input.contact.first_name ?? null,
      city: input.contact.city ?? null,
      size: input.contact.size ?? null,
      budget_kzt: input.contact.budget_kzt ?? null,
      interests: [...new Set(input.contact.interests)].sort() as MyHonorReactivationInterest[],
    },
  }
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  const object = value as Record<string, unknown>
  return `{${Object.keys(object)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(object[key])}`)
    .join(',')}}`
}

export function myHonorMarketingContactEventHash(
  event: NormalizedMyHonorMarketingContactEvent,
): string {
  return createHash('sha256').update(stableJson(event)).digest('hex')
}

export function requiredMarketingPurpose(
  segment: MyHonorReactivationSegment,
): MyHonorMarketingPurpose {
  return segment === 'club_interest' ? 'club_updates' : 'product_recommendations'
}
