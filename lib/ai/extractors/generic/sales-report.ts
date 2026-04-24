/**
 * Sales-report extractor.
 *
 * Input: ParsedDocument (text body from xlsx/csv/pdf/docx).
 * Output: ExtractedEntity[] covering revenue per period, top products,
 *         channel mix.
 *
 * Uses Claude Sonnet + Zod with prompt caching on the long system prompt.
 */

import type { ParsedDocument } from '@/lib/documents/parse'

import { CLAUDE_MODELS } from '../../anthropic'
import { extractWithCache } from '../../prompt-cache'
import { excerpt, makeEntity } from '../base'
import { salesReportSchema } from '../schemas/sales'
import type { Extractor, ExtractorContext, ExtractedEntity, FiscalQuarter } from '../types'
import { registerExtractor } from '../registry'

const NAME = 'generic.sales-report'
const VERSION = '1.0.0'

const SYSTEM_PROMPT = `You are a sales-data extractor for a business-analytics platform.

Given a parsed document (xlsx/csv/pdf/docx text), extract:

1. **periods[]** — revenue breakdown by period (year / quarter / month).
   Combine data even if spread across multiple tables. Use original currency.
   Include deals_closed and avg_check when visible.

2. **top_products[]** — up to 10 revenue-ranked products/services with
   revenue and % share.

3. **channel_mix[]** — up to 10 acquisition channels with revenue and % share.

4. **currency** — detect (KZT / USD / RUB / EUR / UAH / BYN).

5. **confidence** 0..1 — honest self-assessment.
   - 1.0: clean tabular data, totals match period breakdowns.
   - 0.6: some cells missing or ambiguous.
   - 0.3: scanned PDF or heavily narrative text.

Values are numeric (no currency suffix, no thousand separators). For
thousands/millions markers ("10 500 000", "10.5 млн", "2.4M") normalize
to the actual number.

If a field is not present in the document, OMIT it rather than guess.
Return strict JSON only, no markdown.`

export const salesReportExtractor: Extractor<ParsedDocument> = {
  name: NAME,
  version: VERSION,
  label: 'Sales report (xlsx/csv/pdf/docx)',

  supports(_ctx: ExtractorContext): boolean {
    return true
  },

  async extract(input: ParsedDocument, ctx: ExtractorContext): Promise<ExtractedEntity[]> {
    if (!process.env.OPENROUTER_API_KEY && !process.env.ANTHROPIC_API_KEY) return []
    if (!input?.text) return []

    const MAX_CHARS = 40_000
    const text = input.text.length > MAX_CHARS ? input.text.slice(0, MAX_CHARS) : input.text

    const userMsg = `Filename: ${input.metadata.fileName}
Type: ${input.metadata.type}
Word count: ${input.metadata.wordCount}

--- Document content ---
${text}`

    const { data } = await extractWithCache({
      system: SYSTEM_PROMPT,
      user: userMsg,
      schema: salesReportSchema,
      model: CLAUDE_MODELS.sonnet,
      maxTokens: 3000,
      temperature: 0,
      schemaName: 'SalesReportExtraction',
    })

    const out: ExtractedEntity[] = []
    const currency = data.currency ?? 'KZT'

    // Periods → metric.revenue / metric.deals_closed / metric.avg_check / metric.gross_margin
    for (const p of data.periods ?? []) {
      const baseFields = {
        confidence: data.confidence,
        source_type: 'document' as const,
        extractor_name: NAME,
        extractor_version: VERSION,
        source_doc_id: ctx.documentId,
        source_field: `doc.${input.metadata.fileName}#period:${p.year}${p.quarter ? '.' + p.quarter : ''}${p.month ? '.m' + p.month : ''}`,
        period_year: p.year,
        period_quarter: (p.quarter ?? undefined) as FiscalQuarter | undefined,
        raw_excerpt: excerpt(text, 200),
      }

      if (typeof p.revenue === 'number') {
        out.push(makeEntity({ ...baseFields, entity_type: 'metric.revenue', value: p.revenue, unit: currency }))
      }
      if (typeof p.deals_closed === 'number') {
        out.push(makeEntity({ ...baseFields, entity_type: 'metric.deals_closed', value: p.deals_closed, unit: 'count' }))
      }
      if (typeof p.avg_check === 'number') {
        out.push(makeEntity({ ...baseFields, entity_type: 'metric.avg_check', value: p.avg_check, unit: currency }))
      }
      if (typeof p.margin_pct === 'number') {
        out.push(makeEntity({ ...baseFields, entity_type: 'metric.gross_margin', value: p.margin_pct, unit: '%' }))
      }
    }

    // Top products → asset.top_products (one aggregate entity)
    if (data.top_products?.length) {
      out.push(
        makeEntity({
          entity_type: 'asset.top_products',
          value: data.top_products,
          confidence: data.confidence,
          source_type: 'document',
          extractor_name: NAME,
          extractor_version: VERSION,
          source_doc_id: ctx.documentId,
          source_field: `doc.${input.metadata.fileName}#top_products`,
          raw_excerpt: excerpt(text, 200),
        })
      )
    }

    // Channel mix → asset.channel_mix
    if (data.channel_mix?.length) {
      out.push(
        makeEntity({
          entity_type: 'asset.channel_mix',
          value: data.channel_mix,
          confidence: data.confidence,
          source_type: 'document',
          extractor_name: NAME,
          extractor_version: VERSION,
          source_doc_id: ctx.documentId,
          source_field: `doc.${input.metadata.fileName}#channel_mix`,
          raw_excerpt: excerpt(text, 200),
        })
      )
    }

    // Extractor notes → insight.* for UI
    for (const note of data.notes ?? []) {
      out.push(
        makeEntity({
          entity_type: 'insight.sales_report',
          value: note,
          confidence: data.confidence * 0.9,
          source_type: 'document',
          extractor_name: NAME,
          extractor_version: VERSION,
          source_doc_id: ctx.documentId,
          source_field: `doc.${input.metadata.fileName}#note`,
          raw_excerpt: excerpt(note, 200),
        })
      )
    }

    return out
  },
}

registerExtractor('generic', 'sales_report', salesReportExtractor)
registerExtractor('medical', 'sales_report', salesReportExtractor)
