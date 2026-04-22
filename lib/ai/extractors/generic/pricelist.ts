/**
 * Pricelist / catalog extractor.
 *
 * Emits one `asset.service_catalog` entity containing the items array
 * plus optional `asset.service_packages`. Individual prices surface on
 * the client's services page, feeding medical revenue audit and
 * upsell/cross-sell bundles.
 */

import type { ParsedDocument } from '@/lib/documents/parse'

import { CLAUDE_MODELS } from '../../anthropic'
import { extractWithCache } from '../../prompt-cache'
import { excerpt, makeEntity } from '../base'
import { pricelistSchema } from '../schemas/pricelist'
import type { Extractor, ExtractorContext, ExtractedEntity } from '../types'
import { registerExtractor } from '../index'

const NAME = 'generic.pricelist'
const VERSION = '1.0.0'

const SYSTEM_PROMPT = `You are a price-catalog extractor.

Given a parsed pricelist (xlsx/csv/pdf/docx text), extract:

1. **items[]** — up to 200 services / products. For each:
   - name
   - category (optional, if the doc groups them)
   - price (number, no currency suffix, normalize "5 000", "5 тыс.", "5K" → 5000)
   - unit (per service / per hour / per month / ... when present)
   - duration (when a procedure duration is stated)
   - notes (e.g. "для пенсионеров -10%")

2. **packages[]** — up to 30 bundles. Each:
   - name
   - includes[] — list of items included
   - price
   - original_price (if discount visible)
   - discount_pct

3. **currency** — one of KZT / USD / RUB / EUR / UAH / BYN.
4. **confidence** 0..1.

Skip header rows, sub-totals, and footer legal text. Do NOT invent items
not present in the document.

Return strict JSON only.`

export const pricelistExtractor: Extractor<ParsedDocument> = {
  name: NAME,
  version: VERSION,
  label: 'Pricelist / service catalog',

  supports(_ctx: ExtractorContext): boolean {
    return true
  },

  async extract(input: ParsedDocument, ctx: ExtractorContext): Promise<ExtractedEntity[]> {
    if (!process.env.ANTHROPIC_API_KEY) return []
    if (!input?.text) return []

    const MAX_CHARS = 50_000 // pricelists can be long
    const text = input.text.length > MAX_CHARS ? input.text.slice(0, MAX_CHARS) : input.text

    const userMsg = `Filename: ${input.metadata.fileName}
Type: ${input.metadata.type}
Word count: ${input.metadata.wordCount}

--- Pricelist content ---
${text}`

    const { data } = await extractWithCache({
      system: SYSTEM_PROMPT,
      user: userMsg,
      schema: pricelistSchema,
      model: CLAUDE_MODELS.sonnet,
      maxTokens: 4000,
      temperature: 0,
      schemaName: 'PricelistExtraction',
    })

    const out: ExtractedEntity[] = []
    const baseMeta = {
      confidence: data.confidence,
      source_type: 'document' as const,
      extractor_name: NAME,
      extractor_version: VERSION,
      source_doc_id: ctx.documentId,
      raw_excerpt: excerpt(text, 200),
    }

    // Whole catalog as one asset (consumers filter/rank/group on their side)
    if (data.items?.length) {
      out.push(
        makeEntity({
          ...baseMeta,
          entity_type: 'asset.service_catalog',
          value: { items: data.items, currency: data.currency ?? 'KZT' },
          source_field: `doc.${input.metadata.fileName}#catalog`,
        })
      )

      // Aggregate metrics derived from the catalog
      const prices = data.items.map((i) => i.price).filter((n) => Number.isFinite(n))
      if (prices.length) {
        const avg = prices.reduce((s, n) => s + n, 0) / prices.length
        const min = Math.min(...prices)
        const max = Math.max(...prices)

        out.push(makeEntity({ ...baseMeta, entity_type: 'metric.catalog_avg_price', value: Math.round(avg), unit: data.currency ?? 'KZT', source_field: 'catalog.avg_price' }))
        out.push(makeEntity({ ...baseMeta, entity_type: 'metric.catalog_min_price', value: min,              unit: data.currency ?? 'KZT', source_field: 'catalog.min_price' }))
        out.push(makeEntity({ ...baseMeta, entity_type: 'metric.catalog_max_price', value: max,              unit: data.currency ?? 'KZT', source_field: 'catalog.max_price' }))
        out.push(makeEntity({ ...baseMeta, entity_type: 'metric.catalog_size',      value: prices.length,    unit: 'count',                source_field: 'catalog.size' }))
      }
    }

    if (data.packages?.length) {
      out.push(
        makeEntity({
          ...baseMeta,
          entity_type: 'asset.service_packages',
          value: { packages: data.packages, currency: data.currency ?? 'KZT' },
          source_field: `doc.${input.metadata.fileName}#packages`,
        })
      )
    }

    for (const note of data.notes ?? []) {
      out.push(
        makeEntity({
          ...baseMeta,
          entity_type: 'insight.pricelist',
          value: note,
          confidence: data.confidence * 0.9,
          source_field: 'pricelist.note',
          raw_excerpt: excerpt(note, 200),
        })
      )
    }

    return out
  },
}

registerExtractor('generic', 'pricelist', pricelistExtractor)
registerExtractor('medical', 'pricelist', pricelistExtractor)
