import { createHash, timingSafeEqual } from 'crypto'
import { z } from 'zod'

export const MYHONOR_ORDER_STATUSES = [
  'confirmed',
  'shipped',
  'delivered',
  'cancelled',
] as const

export type MyHonorOrderStatus = (typeof MYHONOR_ORDER_STATUSES)[number]

const eventIdSchema = z
  .string()
  .trim()
  .min(8)
  .max(200)
  .regex(/^[A-Za-z0-9._:-]+$/)

const nullableDetail = (maximum: number) => z
  .string()
  .trim()
  .min(1)
  .max(maximum)
  .nullable()
  .optional()

export const myHonorOrderNotificationSchema = z
  .object({
    event_id: eventIdSchema,
    occurred_at: z.string().datetime({ offset: true }),
    order_id: z.string().trim().min(1).max(100),
    order_number: z.string().trim().min(1).max(64),
    status: z.enum(MYHONOR_ORDER_STATUSES),
    status_version: z.number().int().min(0).max(1_000_000_000),
    recipient: z
      .object({
        phone_e164: z.string().regex(/^\+[1-9][0-9]{7,14}$/),
        name: z.string().trim().min(1).max(80),
        whatsapp_opt_in: z.literal(true),
      })
      .strict(),
    locale: z.literal('ru'),
    details: z
      .object({
        tracking_number: nullableDetail(100),
        tracking_url: z.string().url().max(500).refine(
          (value) => value.startsWith('https://'),
          'tracking_url must use https',
        ).nullable().optional(),
        cancellation_reason: nullableDetail(500),
      })
      .strict()
      .default({}),
  })
  .strict()
  .superRefine((value, context) => {
    const trackingSupplied = Boolean(
      value.details.tracking_number || value.details.tracking_url,
    )
    if (trackingSupplied && value.status !== 'shipped') {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['details', 'tracking_number'],
        message: 'tracking details are allowed only for shipped orders',
      })
    }
    if (value.details.cancellation_reason && value.status !== 'cancelled') {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['details', 'cancellation_reason'],
        message: 'cancellation_reason is allowed only for cancelled orders',
      })
    }
  })

export type MyHonorOrderNotificationInput = z.infer<
  typeof myHonorOrderNotificationSchema
>

export interface NormalizedMyHonorOrderNotification
  extends Omit<MyHonorOrderNotificationInput, 'details'> {
  details: {
    tracking_number: string | null
    tracking_url: string | null
    cancellation_reason: string | null
  }
}

export const MYHONOR_ENV_NAMES = {
  apiKey: 'MYHONOR_ORDER_NOTIFICATIONS_API_KEY',
  previousApiKey: 'MYHONOR_ORDER_NOTIFICATIONS_API_KEY_PREVIOUS',
  whatsappToken: 'WHATSAPP_TOKEN',
  whatsappPhoneNumberId: 'WHATSAPP_PHONE_NUMBER_ID',
  templateLanguage: 'WHATSAPP_TEMPLATE_LANGUAGE',
  templates: {
    confirmed: 'WHATSAPP_TEMPLATE_ORDER_CONFIRMED',
    shipped: 'WHATSAPP_TEMPLATE_ORDER_SHIPPED',
    delivered: 'WHATSAPP_TEMPLATE_ORDER_DELIVERED',
    cancelled: 'WHATSAPP_TEMPLATE_ORDER_CANCELLED',
  },
} as const

export interface MyHonorOrderNotificationConfiguration {
  ready: boolean
  missing: string[]
  apiKeys: string[]
  whatsappPhoneNumberId: string | null
  templateLanguage: string | null
  templates: Record<MyHonorOrderStatus, string | null>
}

type Environment = Readonly<Record<string, string | undefined>>

function nonEmpty(value: string | undefined): string | null {
  const normalized = value?.trim()
  return normalized ? normalized : null
}

function validTemplateName(value: string | null): value is string {
  return Boolean(value && /^[a-z0-9_]{1,512}$/.test(value))
}

function validTemplateLanguage(value: string | null): value is string {
  return Boolean(value && /^[a-z]{2,3}(?:_[A-Z]{2})?$/.test(value))
}

export function getMyHonorOrderNotificationConfiguration(
  env: Environment = process.env,
): MyHonorOrderNotificationConfiguration {
  const apiKey = nonEmpty(env[MYHONOR_ENV_NAMES.apiKey])
  const previousApiKey = nonEmpty(env[MYHONOR_ENV_NAMES.previousApiKey])
  const whatsappToken = nonEmpty(env[MYHONOR_ENV_NAMES.whatsappToken])
  const whatsappPhoneNumberId = nonEmpty(
    env[MYHONOR_ENV_NAMES.whatsappPhoneNumberId],
  )
  const templateLanguage = nonEmpty(env[MYHONOR_ENV_NAMES.templateLanguage])
  const templates = Object.fromEntries(
    MYHONOR_ORDER_STATUSES.map((status) => [
      status,
      nonEmpty(env[MYHONOR_ENV_NAMES.templates[status]]),
    ]),
  ) as Record<MyHonorOrderStatus, string | null>
  const missing: string[] = []

  if (!apiKey) missing.push(MYHONOR_ENV_NAMES.apiKey)
  if (!whatsappToken) missing.push(MYHONOR_ENV_NAMES.whatsappToken)
  if (!whatsappPhoneNumberId) {
    missing.push(MYHONOR_ENV_NAMES.whatsappPhoneNumberId)
  }
  if (!validTemplateLanguage(templateLanguage)) {
    missing.push(MYHONOR_ENV_NAMES.templateLanguage)
  }
  for (const status of MYHONOR_ORDER_STATUSES) {
    if (!validTemplateName(templates[status])) {
      missing.push(MYHONOR_ENV_NAMES.templates[status])
    }
  }

  const configuration = {
    ready: missing.length === 0,
    missing,
    whatsappPhoneNumberId,
    templateLanguage: validTemplateLanguage(templateLanguage)
      ? templateLanguage
      : null,
    templates,
  } as MyHonorOrderNotificationConfiguration

  Object.defineProperty(configuration, 'apiKeys', {
    value: [apiKey, previousApiKey].filter(
      (value): value is string => Boolean(value),
    ),
    enumerable: false,
    writable: false,
    configurable: false,
  })

  return configuration
}

function constantTimeEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left, 'utf8')
  const rightBytes = Buffer.from(right, 'utf8')
  return leftBytes.length === rightBytes.length
    && timingSafeEqual(leftBytes, rightBytes)
}

export function isAuthorizedMyHonorBearer(
  authorizationHeader: string | null,
  apiKeys: readonly string[],
): boolean {
  const match = authorizationHeader?.match(/^Bearer ([^\s]+)$/)
  if (!match) return false
  const supplied = match[1]
  // Check every configured key instead of returning on the first comparison.
  return apiKeys.reduce(
    (matched, candidate) => constantTimeEqual(supplied, candidate) || matched,
    false,
  )
}

export function normalizeMyHonorOrderNotification(
  input: MyHonorOrderNotificationInput,
): NormalizedMyHonorOrderNotification {
  return {
    ...input,
    details: {
      tracking_number: input.details.tracking_number ?? null,
      tracking_url: input.details.tracking_url ?? null,
      cancellation_reason: input.details.cancellation_reason ?? null,
    },
  }
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  const record = value as Record<string, unknown>
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
    .join(',')}}`
}

export function myHonorOrderNotificationRequestHash(
  input: NormalizedMyHonorOrderNotification,
): string {
  return createHash('sha256').update(stableJson(input)).digest('hex')
}

export interface MyHonorTemplateRequest {
  templateName: string
  languageCode: string
  recipientId: string
  bodyParameters: string[]
}

export interface MyHonorTemplateSource {
  status: MyHonorOrderStatus
  order_number: string
  recipient: {
    phone_e164: string
    name: string
  }
  details: {
    tracking_number?: string | null
    tracking_url?: string | null
    cancellation_reason?: string | null
  }
}

export function buildMyHonorTemplateRequest(
  input: MyHonorTemplateSource,
  configuration: MyHonorOrderNotificationConfiguration,
): MyHonorTemplateRequest | null {
  const templateName = configuration.templates[input.status]
  const languageCode = configuration.templateLanguage
  if (!validTemplateName(templateName) || !languageCode) return null

  const common = [input.recipient.name, input.order_number]
  let bodyParameters: string[]
  switch (input.status) {
    case 'confirmed':
    case 'delivered':
      bodyParameters = common
      break
    case 'shipped': {
      const tracking = [
        input.details.tracking_number,
        input.details.tracking_url,
      ].filter((value): value is string => Boolean(value))
      bodyParameters = [
        ...common,
        tracking.join(' — ') || 'будет сообщён дополнительно',
      ]
      break
    }
    case 'cancelled':
      bodyParameters = [
        ...common,
        input.details.cancellation_reason || 'причину можно уточнить у менеджера',
      ]
      break
  }

  return {
    templateName,
    languageCode,
    recipientId: input.recipient.phone_e164.slice(1),
    bodyParameters,
  }
}
