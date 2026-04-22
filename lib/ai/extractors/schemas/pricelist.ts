/**
 * Zod schema for pricelist/catalog documents.
 */

import { z } from 'zod'

export const pricelistSchema = z.object({
  currency: z.enum(['KZT', 'USD', 'RUB', 'EUR', 'UAH', 'BYN']).default('KZT'),

  items: z
    .array(
      z.object({
        name: z.string().max(200),
        category: z.string().max(80).optional(),
        price: z.number().min(0),
        unit: z.string().max(40).optional().describe('per service, per hour, per month, etc.'),
        duration: z.string().max(40).optional(),
        notes: z.string().max(200).optional(),
      })
    )
    .max(200),

  packages: z
    .array(
      z.object({
        name: z.string().max(120),
        includes: z.array(z.string().max(200)).max(20),
        price: z.number().min(0),
        original_price: z.number().optional(),
        discount_pct: z.number().min(0).max(100).optional(),
      })
    )
    .max(30)
    .optional(),

  confidence: z.number().min(0).max(1),
  notes: z.array(z.string().max(200)).max(5).optional(),
})

export type PricelistExtraction = z.infer<typeof pricelistSchema>
