/**
 * Zod schema for financial documents (P&L, balance sheet, cash flow).
 *
 * Used by generic/financial-pdf.ts — passed to extractWithCache() which runs
 * it through Claude Sonnet with structured-output instruction.
 */

import { z } from 'zod'

/** Accept either string[] or single string (LLM sometimes returns one note as string). */
const notesSchema = z
  .preprocess(
    (v) => (typeof v === 'string' ? [v] : v),
    z.array(z.string().max(500)).max(8)
  )
  .optional()

export const financialExtractionSchema = z.object({
  currency: z.enum(['KZT', 'USD', 'RUB', 'EUR', 'UAH', 'BYN']).default('KZT'),

  periods: z
    .array(
      z.object({
        year: z.number().int().min(2000).max(2100),
        quarter: z.enum(['Q1', 'Q2', 'Q3', 'Q4']).optional(),
        revenue: z.number().optional(),
        gross_profit: z.number().optional(),
        operating_profit: z.number().optional(),
        net_profit: z.number().optional(),
        ebitda: z.number().optional(),
        cogs: z.number().optional(),
        opex: z.number().optional(),
        gross_margin_pct: z.number().min(-100).max(100).optional(),
        net_margin_pct: z.number().min(-100).max(100).optional(),
      })
    )
    .max(10)
    .describe('Row per reporting period; max 10 (2.5 years quarterly).'),

  top_revenue_lines: z
    .array(
      z.object({
        label: z.string().max(120),
        value: z.number(),
        share_pct: z.number().min(0).max(100).optional(),
      })
    )
    .max(10)
    .optional()
    .describe('Top 10 revenue lines by value if broken down in the report.'),

  top_cost_lines: z
    .array(
      z.object({
        label: z.string().max(120),
        value: z.number(),
        share_pct: z.number().min(0).max(100).optional(),
      })
    )
    .max(10)
    .optional(),

  confidence: z.number().min(0).max(1).describe('Overall confidence in extraction quality.'),
  notes: notesSchema,
})

export type FinancialExtraction = z.infer<typeof financialExtractionSchema>
