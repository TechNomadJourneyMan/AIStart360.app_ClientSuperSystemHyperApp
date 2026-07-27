import { z } from 'zod'

const uuid = z.string().uuid()
const money = z.string().regex(/^-?\d{1,18}(?:\.\d{1,2})?$/, 'Ожидается денежное значение с двумя знаками')
const nonNegativeMoney = money.refine((value) => !value.startsWith('-'), 'Значение не может быть отрицательным')
const quantity = z.string()
  .regex(/^\d{1,15}(?:\.\d{1,3})?$/, 'Количество поддерживает до трёх знаков')
  .refine((value) => Number(value) > 0, 'Количество должно быть больше нуля')
const currency = z.string().regex(/^[A-Z]{3}$/).default('KZT')

export const createSaleSchema = z.object({
  organizationId: z.string().min(1),
  soldAt: z.string().datetime({ offset: true }),
  managerId: z.string().min(1).optional(),
  managerName: z.string().max(200).optional(),
  regionId: uuid.optional(),
  channelId: uuid.optional(),
  currency,
  negativeMarginReason: z.string().max(100).optional(),
  negativeMarginComment: z.string().max(1000).optional(),
  source: z.enum(['manual', 'import', 'assistant']).default('manual'),
  sourceRef: z.string().max(500).optional(),
  items: z.array(z.object({
    productVariantId: uuid,
    quantity,
    unitPrice: nonNegativeMoney,
    discountAmount: nonNegativeMoney.default('0.00'),
  })).min(1).max(100),
})

export const createExpenseSchema = z.object({
  organizationId: z.string().min(1),
  operationType: z.enum([
    'operating_expense', 'write_off', 'owner_payment', 'tax',
    'capital_expense', 'internal_transfer', 'adjustment', 'depreciation',
  ]),
  documentDate: z.string().date(),
  paymentDate: z.string().date().optional(),
  categoryId: uuid,
  costCenterId: uuid.optional(),
  amount: nonNegativeMoney.refine((value) => Number(value) > 0, 'Сумма должна быть больше нуля'),
  currency,
  supplier: z.string().max(250).optional(),
  documentNumber: z.string().max(100).optional(),
  comment: z.string().max(2000).optional(),
  attachmentPaths: z.array(z.string().max(1000)).max(20).default([]),
  source: z.enum(['manual', 'import', 'assistant']).default('manual'),
  sourceRef: z.string().max(500).optional(),
})

export const createPlanSchema = z.object({
  organizationId: z.string().min(1),
  periodStart: z.string().date(),
  periodEnd: z.string().date(),
  currency,
  lines: z.array(z.object({
    regionId: uuid.optional(),
    channelId: uuid.optional(),
    productId: uuid.optional(),
    managerId: z.string().optional(),
    revenueTarget: nonNegativeMoney,
    grossProfitTarget: money,
    quantityTarget: z.string().regex(/^\d{1,15}(?:\.\d{1,3})?$/),
    averagePriceTarget: nonNegativeMoney.optional(),
    averageCostTarget: nonNegativeMoney.optional(),
  })).min(1),
}).refine((value) => value.periodEnd >= value.periodStart, {
  message: 'Конец периода должен быть не раньше начала',
  path: ['periodEnd'],
})

export const productRequestSchema = z.object({
  organizationId: z.string().min(1),
  saleId: uuid.optional(),
  sku: z.string().max(120).optional(),
  barcode: z.string().max(120).optional(),
  name: z.string().max(250).optional(),
  size: z.string().max(80).optional(),
  color: z.string().max(80).optional(),
  photoPaths: z.array(z.string().max(1000)).max(10).default([]),
  comment: z.string().max(1000).optional(),
}).refine((value) => Boolean(value.sku || value.barcode || value.name), {
  message: 'Укажите артикул, штрихкод или название',
})

export const createProductSchema = z.object({
  organizationId: z.string().min(1),
  name: z.string().min(2).max(250),
  category: z.string().max(150).optional(),
  sku: z.string().min(1).max(120),
  barcode: z.string().max(120).optional(),
  size: z.string().max(80).optional(),
  color: z.string().max(80).optional(),
  availability: z.enum(['available', 'unavailable', 'unknown']).default('available'),
  costAmount: nonNegativeMoney,
  priceAmount: nonNegativeMoney,
  currency,
  validFrom: z.string().datetime({ offset: true }),
  costReason: z.string().min(3).max(500),
  supplier: z.string().max(250).optional(),
})

export const assistantQuerySchema = z.object({
  organizationId: z.string().min(1),
  conversationId: uuid.optional(),
  question: z.string().min(2).max(4000),
  filters: z.object({
    from: z.string().date().optional(),
    to: z.string().date().optional(),
    regionId: uuid.optional(),
    channelId: uuid.optional(),
  }).default({}),
})

export const actionDraftSchema = z.object({
  organizationId: z.string().min(1),
  conversationId: uuid.optional(),
  actionType: z.enum([
    'create_sale', 'create_expense', 'create_plan',
    'reverse_sale', 'reverse_expense', 'create_product_request',
  ]),
  payload: z.record(z.string(), z.unknown()),
})

export const actionConfirmSchema = z.object({
  organizationId: z.string().min(1),
  checksum: z.string().min(32),
})
