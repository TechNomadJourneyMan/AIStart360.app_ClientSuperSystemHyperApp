/**
 * Brand-guide extractor.
 *
 * Two-step process:
 *   1. Regex-harvest hex colors from parsed text (no LLM, free).
 *   2. Claude Opus Vision reads the PDF as-is — pulls palette, typography,
 *      tone-of-voice, logo rules. Vision captures cues that text-only
 *      parsing misses (logo shapes, color swatches, typography samples).
 *
 * DOCX / TXT falls back to Sonnet text-mode since there are no visual
 * cues to extract.
 */

import type { ParsedDocument } from '@/lib/documents/parse'

import { CLAUDE_MODELS } from '../../anthropic'
import { extractWithCache } from '../../prompt-cache'
import { extractWithVision } from '../../vision'
import { excerpt, makeEntity } from '../base'
import { brandExtractionSchema } from '../schemas/brand'
import type { Extractor, ExtractorContext, ExtractedEntity } from '../types'
import { registerExtractor } from '../registry'

const NAME = 'generic.brand-guide'
const VERSION = '1.0.0'

const SYSTEM_PROMPT = `You are a brand-book extractor.

Given a brand guideline document (PDF / DOCX / image), extract:

1. **brand_name** — the brand this book belongs to.
2. **palette** — primary/secondary/accent/neutral hex colors plus full
   palette (all_colors[]) with their declared role (primary, button, text,
   background, etc.) and name if stated.
3. **typography** — primary/secondary/heading/body font families.
4. **tone_of_voice** — dominant archetype from [formal, playful, premium,
   caring, bold, friendly, authoritative, neutral]. Pull attributes
   (professional, warm, concise, ...). Include do/don't lists + example
   phrases when the book provides them.
5. **logo** — has_logo boolean, variants (horizontal, vertical, mono,
   reversed, ...), clear-space + minimum-size rules, common misuse
   warnings.
6. **confidence** 0..1 — based on how clearly the source states each field.

Skip cells/phrases that are placeholders or generic. Never invent a hex
that isn't in the document. If a section is absent, omit it.

Return strict JSON only.`

const HEX_REGEX = /#[0-9A-Fa-f]{6}\b/g

export const brandGuideExtractor: Extractor<ParsedDocument & { buffer?: Buffer }> = {
  name: NAME,
  version: VERSION,
  label: 'Brand guide (PDF/DOCX → palette + typography + ToV + logo)',

  supports(_ctx: ExtractorContext): boolean {
    return true
  },

  async extract(
    input: ParsedDocument & { buffer?: Buffer },
    ctx: ExtractorContext
  ): Promise<ExtractedEntity[]> {
    if (!process.env.ANTHROPIC_API_KEY) return []

    // ── Step 1: regex hex colors (free, always runs) ──────────────────────
    const hexMatches = [...new Set(input.text.match(HEX_REGEX) ?? [])].slice(0, 12)

    // ── Step 2: LLM extraction ────────────────────────────────────────────
    let data: Awaited<ReturnType<typeof brandExtractionSchema.parse>>
    try {
      if (input.metadata.type === 'pdf' && input.buffer) {
        const res = await extractWithVision({
          system: SYSTEM_PROMPT,
          instruction: `Filename: ${input.metadata.fileName}\nExtract the full brand profile from this document.`,
          bytes: input.buffer,
          mediaType: 'application/pdf',
          schema: brandExtractionSchema,
          model: CLAUDE_MODELS.opus,
          maxTokens: 3500,
          schemaName: 'BrandExtraction',
        })
        data = res.data
      } else {
        // DOCX / TXT / XLSX: text-mode Sonnet fallback
        const MAX_CHARS = 40_000
        const text = input.text.length > MAX_CHARS ? input.text.slice(0, MAX_CHARS) : input.text
        const res = await extractWithCache({
          system: SYSTEM_PROMPT,
          user: `Filename: ${input.metadata.fileName}\nType: ${input.metadata.type}\n\n--- Content ---\n${text}`,
          schema: brandExtractionSchema,
          model: CLAUDE_MODELS.sonnet,
          maxTokens: 3500,
          temperature: 0,
          schemaName: 'BrandExtraction',
        })
        data = res.data
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[brand-guide] LLM extract failed:', err)
      return [
        makeEntity({
          entity_type: 'insight.brand_guide',
          value: `Vision/text extract failed: ${err instanceof Error ? err.message : String(err)}`,
          confidence: 0.3,
          source_type: 'document',
          extractor_name: NAME,
          extractor_version: VERSION,
          source_doc_id: ctx.documentId,
          source_field: `doc.${input.metadata.fileName}#extract-failed`,
          raw_excerpt: excerpt(input.text, 200),
        }),
      ]
    }

    const out: ExtractedEntity[] = []
    const baseMeta = {
      confidence: data.confidence,
      source_type: 'document' as const,
      extractor_name: NAME,
      extractor_version: VERSION,
      source_doc_id: ctx.documentId,
      raw_excerpt: excerpt(input.text, 200),
    }

    // Brand name
    if (data.brand_name) {
      out.push(
        makeEntity({
          ...baseMeta,
          entity_type: 'attribute.brand_name',
          value: data.brand_name,
          source_field: 'brand.name',
        })
      )
    }

    // Palette — individual primary/secondary/accent/neutral + full set
    if (data.palette) {
      const roleFields: Array<[keyof typeof data.palette, string]> = [
        ['primary_hex', 'brand.palette.primary'],
        ['secondary_hex', 'brand.palette.secondary'],
        ['accent_hex', 'brand.palette.accent'],
        ['neutral_hex', 'brand.palette.neutral'],
      ]
      for (const [field, sourceField] of roleFields) {
        const hex = data.palette[field]
        if (typeof hex === 'string') {
          out.push(
            makeEntity({
              ...baseMeta,
              entity_type: `asset.palette_${field.replace('_hex', '')}`,
              value: hex,
              source_field: sourceField,
            })
          )
        }
      }
      if (data.palette.all_colors?.length) {
        out.push(
          makeEntity({
            ...baseMeta,
            entity_type: 'asset.palette',
            value: data.palette.all_colors,
            source_field: 'brand.palette.all',
          })
        )
      }
    }

    // Regex-only colors if LLM missed them — confidence lower
    if (hexMatches.length && !data.palette?.all_colors?.length) {
      out.push(
        makeEntity({
          ...baseMeta,
          confidence: Math.min(data.confidence, 0.6),
          entity_type: 'asset.palette',
          value: hexMatches.map((hex) => ({ hex })),
          source_field: 'brand.palette.regex',
        })
      )
    }

    // Typography
    if (data.typography) {
      out.push(
        makeEntity({
          ...baseMeta,
          entity_type: 'asset.typography',
          value: data.typography,
          source_field: 'brand.typography',
        })
      )
    }

    // Tone of voice
    if (data.tone_of_voice) {
      out.push(
        makeEntity({
          ...baseMeta,
          entity_type: 'asset.tone_of_voice',
          value: data.tone_of_voice,
          source_field: 'brand.tone_of_voice',
        })
      )
      if (data.tone_of_voice.archetype) {
        out.push(
          makeEntity({
            ...baseMeta,
            entity_type: 'attribute.tone_archetype',
            value: data.tone_of_voice.archetype,
            source_field: 'brand.tone_of_voice.archetype',
          })
        )
      }
    }

    // Logo rules
    if (data.logo) {
      out.push(
        makeEntity({
          ...baseMeta,
          entity_type: 'asset.logo_rules',
          value: data.logo,
          source_field: 'brand.logo',
        })
      )
    }

    for (const note of data.notes ?? []) {
      out.push(
        makeEntity({
          ...baseMeta,
          entity_type: 'insight.brand_guide',
          value: note,
          confidence: data.confidence * 0.9,
          source_field: 'brand.note',
          raw_excerpt: excerpt(note, 200),
        })
      )
    }

    return out
  },
}

registerExtractor('generic', 'brand_guide', brandGuideExtractor)
registerExtractor('medical', 'brand_guide', brandGuideExtractor)
