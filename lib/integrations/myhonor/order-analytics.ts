import {
  createHash,
  createHmac,
  timingSafeEqual,
} from 'node:crypto'
import { z } from 'zod'

export const MYHONOR_ANALYTICS_SOURCE = 'myhonor.shop' as const
export const MYHONOR_ANALYTICS_STATUSES = [
  'pending',
  'confirmed',
  'paid',
  'processing',
  'shipped',
  'delivered',
  'cancelled',
  'partially_refunded',
  'refunded',
] as const

export type MyHonorAnalyticsOrderStatus =
  (typeof MYHONOR_ANALYTICS_STATUSES)[number]

const MAX_AMOUNT = 1_000_000_000_000
const CUSTOMER_KEY_PATTERN = /^[a-f0-9]{64}$/
const SAFE_EXTERNAL_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]*$/
const SAFE_COMPANY_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/
const MYHONOR_PRODUCT_ID_PATTERN = /^myhonor:[a-f0-9]{64}$/
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

const externalIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .regex(SAFE_EXTERNAL_ID_PATTERN)

const myHonorProductIdSchema = z
  .string()
  .regex(
    MYHONOR_PRODUCT_ID_PATTERN,
    'product_external_id must match the canonical MyHonor product URL',
  )

const amountSchema = z
  .number()
  .finite()
  .min(0)
  .max(MAX_AMOUNT)
  .refine(
    (value) => Math.abs(value * 100 - Math.round(value * 100)) < 1e-7,
    'amount must have at most two decimal places',
  )

const timestampSchema = z.string().datetime({ offset: true })

const httpsUrlSchema = z
  .string()
  .trim()
  .url()
  .max(1_000)
  .refine((value) => value.startsWith('https://'), 'URL must use https')

const productDetailsSchema = z
  .object({
    url: httpsUrlSchema.nullable().optional(),
    image_url: httpsUrlSchema.nullable().optional(),
    brand: z.string().trim().min(1).max(160).nullable().optional(),
    description: z.string().trim().min(1).max(2_000).nullable().optional(),
    availability: z
      .enum([
        'in_stock',
        'out_of_stock',
        'preorder',
        'discontinued',
        'unknown',
      ])
      .optional(),
  })
  .strict()

const orderItemSchema = z
  .object({
    external_line_id: externalIdSchema,
    product_external_id: myHonorProductIdSchema,
    sku: z.string().trim().min(1).max(160),
    name: z.string().trim().min(1).max(300),
    quantity: z.number().int().min(1).max(100_000),
    unit_price: amountSchema,
    line_total: amountSchema,
    product: productDetailsSchema.optional(),
  })
  .strict()

const orderSchema = z
  .object({
    external_id: externalIdSchema,
    order_number: z.string().trim().min(1).max(100),
    status: z.enum(MYHONOR_ANALYTICS_STATUSES),
    placed_at: timestampSchema,
    paid_at: timestampSchema.nullable().optional(),
    cancelled_at: timestampSchema.nullable().optional(),
    updated_at: timestampSchema,
    currency: z.literal('KZT'),
    gross_amount: amountSchema,
    discount_amount: amountSchema,
    shipping_amount: amountSchema,
    refund_amount: amountSchema,
    net_paid_amount: amountSchema,
    customer_key: z
      .string()
      .regex(
        CUSTOMER_KEY_PATTERN,
        'customer_key must be a stable, salted SHA-256 pseudonym',
      ),
    items: z.array(orderItemSchema).min(1).max(250),
  })
  .strict()

export const myHonorOrderAnalyticsSchema = z
  .object({
    schema_version: z.literal(1),
    event_id: z
      .string()
      .trim()
      .min(12)
      .max(200)
      .regex(SAFE_EXTERNAL_ID_PATTERN),
    occurred_at: timestampSchema,
    status_version: z.number().int().min(1).max(1_000_000_000),
    order: orderSchema,
  })
  .strict()
  .superRefine((value, context) => {
    const order = value.order
    const placedAt = Date.parse(order.placed_at)
    const updatedAt = Date.parse(order.updated_at)
    const paidAt = order.paid_at ? Date.parse(order.paid_at) : null
    const cancelledAt = order.cancelled_at
      ? Date.parse(order.cancelled_at)
      : null

    if (updatedAt < placedAt) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['order', 'updated_at'],
        message: 'updated_at cannot precede placed_at',
      })
    }
    if (paidAt !== null && paidAt < placedAt) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['order', 'paid_at'],
        message: 'paid_at cannot precede placed_at',
      })
    }
    if (cancelledAt !== null && cancelledAt < placedAt) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['order', 'cancelled_at'],
        message: 'cancelled_at cannot precede placed_at',
      })
    }

    const lineIds = new Set<string>()
    let itemTotalMinor = BigInt(0)
    order.items.forEach((item, index) => {
      if (lineIds.has(item.external_line_id)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['order', 'items', index, 'external_line_id'],
          message: 'external_line_id must be unique within an order',
        })
      }
      lineIds.add(item.external_line_id)

      const expectedMinor =
        BigInt(Math.round(item.unit_price * 100)) * BigInt(item.quantity)
      const actualMinor = BigInt(Math.round(item.line_total * 100))
      if (expectedMinor !== actualMinor) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['order', 'items', index, 'line_total'],
          message: 'line_total must equal quantity multiplied by unit_price',
        })
      }
      itemTotalMinor += actualMinor
    })

    const grossMinor = BigInt(Math.round(order.gross_amount * 100))
    const discountMinor = BigInt(Math.round(order.discount_amount * 100))
    const shippingMinor = BigInt(Math.round(order.shipping_amount * 100))
    const refundMinor = BigInt(Math.round(order.refund_amount * 100))
    const netPaidMinor = BigInt(Math.round(order.net_paid_amount * 100))
    const payableMinor = grossMinor - discountMinor + shippingMinor
    const zero = BigInt(0)

    if (itemTotalMinor !== grossMinor) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['order', 'gross_amount'],
        message: 'gross_amount must equal the sum of item line totals',
      })
    }
    if (discountMinor > grossMinor) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['order', 'discount_amount'],
        message: 'discount_amount cannot exceed gross_amount',
      })
    }
    if (refundMinor > payableMinor) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['order', 'refund_amount'],
        message: 'refund_amount cannot exceed the payable amount',
      })
    }

    const requirePaidInFull =
      order.status === 'paid'
      || order.status === 'processing'
      || order.status === 'shipped'
      || order.status === 'delivered'
    if (requirePaidInFull) {
      if (!order.paid_at) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['order', 'paid_at'],
          message: `${order.status} orders require paid_at`,
        })
      }
      if (refundMinor !== zero || netPaidMinor !== payableMinor) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['order', 'net_paid_amount'],
          message: `${order.status} orders must be fully paid and not refunded`,
        })
      }
    }

    if (order.status === 'pending') {
      if (order.paid_at || refundMinor !== zero || netPaidMinor !== zero) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['order', 'status'],
          message: 'pending orders cannot be paid or refunded',
        })
      }
    }

    if (order.status === 'confirmed') {
      const expectedNet = order.paid_at ? payableMinor : zero
      if (refundMinor !== zero || netPaidMinor !== expectedNet) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['order', 'net_paid_amount'],
          message: 'confirmed payment fields are inconsistent',
        })
      }
    }

    if (order.status === 'cancelled') {
      if (!order.cancelled_at) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['order', 'cancelled_at'],
          message: 'cancelled orders require cancelled_at',
        })
      }
      const expectedRefund = order.paid_at ? payableMinor : zero
      if (refundMinor !== expectedRefund || netPaidMinor !== zero) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['order', 'refund_amount'],
          message: 'cancelled paid orders must be fully refunded',
        })
      }
    } else if (order.cancelled_at) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['order', 'cancelled_at'],
        message: 'cancelled_at is allowed only for cancelled orders',
      })
    }

    if (order.status === 'partially_refunded') {
      if (
        !order.paid_at
        || refundMinor <= zero
        || refundMinor >= payableMinor
        || netPaidMinor !== payableMinor - refundMinor
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['order', 'refund_amount'],
          message: 'partially_refunded amounts or paid_at are inconsistent',
        })
      }
    }

    if (order.status === 'refunded') {
      if (
        !order.paid_at
        || refundMinor !== payableMinor
        || netPaidMinor !== zero
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['order', 'refund_amount'],
          message: 'refunded orders must have paid_at and a full refund',
        })
      }
    }
  })

export type MyHonorOrderAnalyticsInput = z.infer<
  typeof myHonorOrderAnalyticsSchema
>

export interface NormalizedMyHonorOrderAnalytics
  extends Omit<MyHonorOrderAnalyticsInput, 'occurred_at' | 'order'> {
  occurred_at: string
  order: Omit<
    MyHonorOrderAnalyticsInput['order'],
    'placed_at' | 'paid_at' | 'cancelled_at' | 'updated_at' | 'items'
  > & {
    placed_at: string
    paid_at: string | null
    cancelled_at: string | null
    updated_at: string
    items: Array<
      Omit<MyHonorOrderAnalyticsInput['order']['items'][number], 'product'> & {
        product: {
          url: string | null
          image_url: string | null
          brand: string | null
          description: string | null
          availability:
            | 'in_stock'
            | 'out_of_stock'
            | 'preorder'
            | 'discontinued'
            | 'unknown'
        }
        product_source_hash: string
      }
    >
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

function sha256(value: unknown): string {
  return createHash('sha256').update(stableJson(value)).digest('hex')
}

function normalizeTimestamp(value: string): string {
  return new Date(value).toISOString()
}

function normalizeAmount(value: number): number {
  return Math.round(value * 100) / 100
}

export function normalizeMyHonorOrderAnalytics(
  input: MyHonorOrderAnalyticsInput,
): NormalizedMyHonorOrderAnalytics {
  const normalizedItems =
    input.order.items.map((item) => {
      const product = {
        url: item.product?.url ?? null,
        image_url: item.product?.image_url ?? null,
        brand: item.product?.brand ?? null,
        description: item.product?.description ?? null,
        availability: item.product?.availability ?? 'unknown',
      }
      return {
        external_line_id: item.external_line_id,
        product_external_id: item.product_external_id,
        sku: item.sku,
        name: item.name,
        quantity: item.quantity,
        unit_price: normalizeAmount(item.unit_price),
        line_total: normalizeAmount(item.line_total),
        product,
        product_source_hash: sha256({
          external_id: item.product_external_id,
          sku: item.sku,
          name: item.name,
          price: normalizeAmount(item.unit_price),
          currency: 'KZT',
          ...product,
        }),
      }
    })

  return {
    schema_version: 1,
    event_id: input.event_id,
    occurred_at: normalizeTimestamp(input.occurred_at),
    status_version: input.status_version,
    order: {
      external_id: input.order.external_id,
      order_number: input.order.order_number,
      status: input.order.status,
      placed_at: normalizeTimestamp(input.order.placed_at),
      paid_at: input.order.paid_at
        ? normalizeTimestamp(input.order.paid_at)
        : null,
      cancelled_at: input.order.cancelled_at
        ? normalizeTimestamp(input.order.cancelled_at)
        : null,
      updated_at: normalizeTimestamp(input.order.updated_at),
      currency: 'KZT',
      gross_amount: normalizeAmount(input.order.gross_amount),
      discount_amount: normalizeAmount(input.order.discount_amount),
      shipping_amount: normalizeAmount(input.order.shipping_amount),
      refund_amount: normalizeAmount(input.order.refund_amount),
      net_paid_amount: normalizeAmount(input.order.net_paid_amount),
      customer_key: input.order.customer_key,
      items: normalizedItems,
    },
  }
}

export function myHonorAnalyticsRequestHash(
  input: NormalizedMyHonorOrderAnalytics,
): string {
  return sha256(input)
}

export function myHonorAnalyticsOrderHash(
  input: NormalizedMyHonorOrderAnalytics,
): string {
  return sha256({
    status_version: input.status_version,
    order: input.order,
  })
}

export const MYHONOR_ANALYTICS_ENV_NAMES = {
  webhookSecret: 'MYHONOR_ANALYTICS_WEBHOOK_SECRET',
  userId: 'MYHONOR_ANALYTICS_USER_ID',
  companyId: 'MYHONOR_ANALYTICS_COMPANY_ID',
  replayWindowSeconds: 'MYHONOR_ANALYTICS_REPLAY_WINDOW_SECONDS',
} as const

type Environment = Readonly<Record<string, string | undefined>>

export interface MyHonorAnalyticsConfiguration {
  ready: boolean
  missing: string[]
  webhookSecret: string | null
  userId: string | null
  companyId: string | null
  replayWindowSeconds: number
}

function nonEmpty(value: string | undefined): string | null {
  const normalized = value?.trim()
  return normalized ? normalized : null
}

export function getMyHonorAnalyticsConfiguration(
  env: Environment = process.env,
): MyHonorAnalyticsConfiguration {
  const webhookSecret = nonEmpty(
    env[MYHONOR_ANALYTICS_ENV_NAMES.webhookSecret],
  )
  const userId = nonEmpty(env[MYHONOR_ANALYTICS_ENV_NAMES.userId])
  const companyId = nonEmpty(env[MYHONOR_ANALYTICS_ENV_NAMES.companyId])
  const replayWindowCandidate = Number(
    env[MYHONOR_ANALYTICS_ENV_NAMES.replayWindowSeconds] ?? 300,
  )
  const replayWindowSeconds =
    Number.isInteger(replayWindowCandidate)
    && replayWindowCandidate >= 60
    && replayWindowCandidate <= 900
      ? replayWindowCandidate
      : 300
  const missing: string[] = []

  if (!webhookSecret || Buffer.byteLength(webhookSecret, 'utf8') < 32) {
    missing.push(MYHONOR_ANALYTICS_ENV_NAMES.webhookSecret)
  }
  if (!userId || !UUID_PATTERN.test(userId)) {
    missing.push(MYHONOR_ANALYTICS_ENV_NAMES.userId)
  }
  if (
    !companyId
    || companyId.length > 200
    || !SAFE_COMPANY_ID_PATTERN.test(companyId)
  ) {
    missing.push(MYHONOR_ANALYTICS_ENV_NAMES.companyId)
  }

  const configuration = {
    ready: missing.length === 0,
    missing,
    userId: userId && UUID_PATTERN.test(userId) ? userId : null,
    companyId:
      companyId
      && companyId.length <= 200
      && SAFE_COMPANY_ID_PATTERN.test(companyId)
        ? companyId
        : null,
    replayWindowSeconds,
  } as MyHonorAnalyticsConfiguration

  Object.defineProperty(configuration, 'webhookSecret', {
    value:
      webhookSecret && Buffer.byteLength(webhookSecret, 'utf8') >= 32
        ? webhookSecret
        : null,
    enumerable: false,
    writable: false,
    configurable: false,
  })
  return configuration
}

export type MyHonorSignatureVerification =
  | { ok: true; timestampSeconds: number }
  | {
      ok: false
      reason: 'invalid_timestamp' | 'stale_timestamp' | 'invalid_signature'
    }

export function createMyHonorAnalyticsSignature(
  rawBody: Uint8Array,
  timestampSeconds: number,
  secret: string,
): string {
  const hmac = createHmac('sha256', secret)
  hmac.update(String(timestampSeconds))
  hmac.update('.')
  hmac.update(rawBody)
  return `sha256=${hmac.digest('hex')}`
}

export function verifyMyHonorAnalyticsSignature(input: {
  rawBody: Uint8Array
  timestampHeader: string | null
  signatureHeader: string | null
  secret: string
  replayWindowSeconds?: number
  nowMs?: number
}): MyHonorSignatureVerification {
  const timestampHeader = input.timestampHeader?.trim() ?? ''
  if (!/^[0-9]{10}$/.test(timestampHeader)) {
    return { ok: false, reason: 'invalid_timestamp' }
  }
  const timestampSeconds = Number(timestampHeader)
  const nowSeconds = Math.floor((input.nowMs ?? Date.now()) / 1_000)
  const replayWindowSeconds = input.replayWindowSeconds ?? 300
  if (Math.abs(nowSeconds - timestampSeconds) > replayWindowSeconds) {
    return { ok: false, reason: 'stale_timestamp' }
  }

  const expected = createMyHonorAnalyticsSignature(
    input.rawBody,
    timestampSeconds,
    input.secret,
  )
  const expectedBytes = Buffer.from(expected.slice('sha256='.length), 'hex')
  const suppliedMatch =
    input.signatureHeader?.trim().match(/^sha256=([a-f0-9]{64})$/i) ?? null
  const suppliedBytes = suppliedMatch
    ? Buffer.from(suppliedMatch[1], 'hex')
    : Buffer.alloc(expectedBytes.length)
  const matched = timingSafeEqual(expectedBytes, suppliedBytes)

  return matched && suppliedMatch
    ? { ok: true, timestampSeconds }
    : { ok: false, reason: 'invalid_signature' }
}
