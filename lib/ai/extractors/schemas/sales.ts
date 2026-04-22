/**
 * Zod schemas for sales and CRM documents.
 *
 * sales.ts covers two related but distinct shapes:
 *   - salesReportSchema: revenue by period / product / channel
 *   - crmExportSchema: pipeline stages, deal status, lost reasons
 */

import { z } from 'zod'

// ─── Sales report ───────────────────────────────────────────────────────────
export const salesReportSchema = z.object({
  currency: z.enum(['KZT', 'USD', 'RUB', 'EUR', 'UAH', 'BYN']).default('KZT'),

  periods: z
    .array(
      z.object({
        year: z.number().int().min(2000).max(2100),
        quarter: z.enum(['Q1', 'Q2', 'Q3', 'Q4']).optional(),
        month: z.number().int().min(1).max(12).optional(),
        revenue: z.number(),
        deals_closed: z.number().int().optional(),
        avg_check: z.number().optional(),
        margin_pct: z.number().min(-100).max(100).optional(),
      })
    )
    .max(24)
    .describe('Monthly / quarterly / yearly revenue rows — max 24 (2 years monthly).'),

  top_products: z
    .array(
      z.object({
        name: z.string().max(120),
        revenue: z.number(),
        share_pct: z.number().min(0).max(100).optional(),
        margin_pct: z.number().min(-100).max(100).optional(),
      })
    )
    .max(10)
    .optional(),

  channel_mix: z
    .array(
      z.object({
        channel: z.string().max(80),
        revenue: z.number(),
        share_pct: z.number().min(0).max(100).optional(),
      })
    )
    .max(10)
    .optional()
    .describe('Revenue by acquisition channel (direct, ads, referral, organic, etc.)'),

  confidence: z.number().min(0).max(1),
  notes: z.array(z.string().max(200)).max(5).optional(),
})

export type SalesReportExtraction = z.infer<typeof salesReportSchema>

// ─── CRM export ─────────────────────────────────────────────────────────────
export const crmExportSchema = z.object({
  currency: z.enum(['KZT', 'USD', 'RUB', 'EUR', 'UAH', 'BYN']).default('KZT'),

  deal_count_total: z.number().int().min(0),
  deal_count_won: z.number().int().min(0),
  deal_count_lost: z.number().int().min(0),
  deal_count_open: z.number().int().min(0),

  win_rate_pct: z.number().min(0).max(100).optional(),
  avg_cycle_days: z.number().min(0).optional(),
  avg_deal_value: z.number().optional(),
  total_pipeline_value: z.number().optional(),

  stages: z
    .array(
      z.object({
        name: z.string().max(80),
        count: z.number().int().min(0),
        value: z.number().optional(),
        conversion_to_next_pct: z.number().min(0).max(100).optional(),
      })
    )
    .max(10)
    .describe('Pipeline stages in order from top-of-funnel to closed-won.'),

  lost_reasons: z
    .array(
      z.object({
        reason: z.string().max(120),
        count: z.number().int().min(0),
        share_pct: z.number().min(0).max(100).optional(),
      })
    )
    .max(10)
    .optional(),

  top_reps: z
    .array(
      z.object({
        name: z.string().max(80),
        deals_won: z.number().int().min(0),
        revenue: z.number().optional(),
      })
    )
    .max(10)
    .optional(),

  confidence: z.number().min(0).max(1),
  notes: z.array(z.string().max(200)).max(5).optional(),
})

export type CrmExportExtraction = z.infer<typeof crmExportSchema>
