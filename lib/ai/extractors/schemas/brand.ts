/**
 * Zod schema for brand-guide / brand-book documents.
 */

import { z } from 'zod'

export const brandExtractionSchema = z.object({
  brand_name: z.string().max(120).optional(),

  palette: z
    .object({
      primary_hex:   z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
      secondary_hex: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
      accent_hex:    z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
      neutral_hex:   z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
      all_colors: z
        .array(
          z.object({
            hex: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
            role: z.string().max(40).optional(),
            name: z.string().max(80).optional(),
          })
        )
        .max(12)
        .optional(),
    })
    .optional(),

  typography: z
    .object({
      primary_family:   z.string().max(80).optional(),
      secondary_family: z.string().max(80).optional(),
      heading_family:   z.string().max(80).optional(),
      body_family:      z.string().max(80).optional(),
      notes:            z.array(z.string().max(200)).max(5).optional(),
    })
    .optional(),

  tone_of_voice: z
    .object({
      archetype: z.enum(['formal', 'playful', 'premium', 'caring', 'bold', 'friendly', 'authoritative', 'neutral']).optional(),
      attributes: z.array(z.string().max(60)).max(10).optional(),
      do_list:   z.array(z.string().max(160)).max(10).optional(),
      dont_list: z.array(z.string().max(160)).max(10).optional(),
      example_phrases: z.array(z.string().max(200)).max(5).optional(),
    })
    .optional(),

  logo: z
    .object({
      has_logo: z.boolean(),
      variants: z.array(z.string().max(80)).max(10).optional(),
      clear_space_rules: z.string().max(200).optional(),
      min_size_rules:    z.string().max(200).optional(),
      incorrect_uses:    z.array(z.string().max(200)).max(5).optional(),
    })
    .optional(),

  confidence: z.number().min(0).max(1),
  notes: z.array(z.string().max(200)).max(5).optional(),
})

export type BrandExtraction = z.infer<typeof brandExtractionSchema>
