/**
 * Financial-PDF extractor — P&L / balance sheet / cash flow.
 *
 * Phase 2: text-based only (pdf-parse → Sonnet + Zod).
 * Phase 5: adds Claude Vision fallback for scanned PDFs (low text yield).
 */

import type { ParsedDocument } from '@/lib/documents/parse'

import { CLAUDE_MODELS } from '../../anthropic'
import { extractWithCache } from '../../prompt-cache'
import { extractWithVision } from '../../vision'
import { excerpt, makeEntity } from '../base'
import { financialExtractionSchema } from '../schemas/financial'
import type { Extractor, ExtractorContext, ExtractedEntity, FiscalQuarter } from '../types'
import { registerExtractor } from '../index'

const NAME = 'generic.financial-pdf'
const VERSION = '1.0.0'

const SYSTEM_PROMPT = `You are a financial-statement extractor for a business-analytics platform.

Given a parsed P&L / balance sheet / cash flow document, extract:

1. **periods[]** — financial rows per reporting period (year / quarter).
   - revenue
   - gross_profit (revenue - COGS)
   - operating_profit (gross_profit - opex)
   - net_profit
   - ebitda (if present)
   - cogs (cost of goods sold)
   - opex (operating expenses, excl. COGS)
   - gross_margin_pct
   - net_margin_pct

2. **top_revenue_lines[]** — revenue breakdown by product/segment if shown.
3. **top_cost_lines[]** — major cost categories (salary, rent, marketing, etc.)
4. **currency** — KZT / USD / RUB / EUR / UAH / BYN.
5. **confidence** 0..1 based on clarity and completeness.

Normalize "млн", "тыс", "k", "M" into actual numeric values. Skip cells
that are clearly placeholders ("—", "n/a", blank). Never invent numbers.

If the document is clearly not a financial statement (e.g. a memo or
invoice), return confidence below 0.3 and empty periods[].

Return strict JSON only.`

export const financialPdfExtractor: Extractor<ParsedDocument & { buffer?: Buffer }> = {
  name: NAME,
  version: VERSION,
  label: 'Financial statement (pdf/docx/xlsx)',

  supports(_ctx: ExtractorContext): boolean {
    return true
  },

  async extract(
    input: ParsedDocument & { buffer?: Buffer },
    ctx: ExtractorContext
  ): Promise<ExtractedEntity[]> {
    if (!process.env.ANTHROPIC_API_KEY) return []
    if (!input?.text && !input.buffer) return []

    const MAX_CHARS = 40_000
    const text = input.text.length > MAX_CHARS ? input.text.slice(0, MAX_CHARS) : input.text

    // Scanned-PDF branch: use Claude Vision on the raw PDF when pdf-parse
    // yielded almost nothing. Keeps extractor responsibility in one place.
    const scanned = text.length < 500 && input.metadata.type === 'pdf' && !!input.buffer
    let data: Awaited<ReturnType<typeof financialExtractionSchema.parse>>

    if (scanned) {
      const res = await extractWithVision({
        system: SYSTEM_PROMPT,
        instruction: `Filename: ${input.metadata.fileName}\nThis PDF has very little extractable text — likely a scan. Read it visually and extract the financial data.`,
        bytes: input.buffer!,
        mediaType: 'application/pdf',
        schema: financialExtractionSchema,
        model: CLAUDE_MODELS.opus,
        maxTokens: 3000,
        schemaName: 'FinancialExtraction',
      })
      data = res.data
    } else {
      const userMsg = `Filename: ${input.metadata.fileName}
Type: ${input.metadata.type}
Word count: ${input.metadata.wordCount}

--- Financial document content ---
${text}`
      const res = await extractWithCache({
        system: SYSTEM_PROMPT,
        user: userMsg,
        schema: financialExtractionSchema,
        model: CLAUDE_MODELS.sonnet,
        maxTokens: 3000,
        temperature: 0,
        schemaName: 'FinancialExtraction',
      })
      data = res.data
    }

    const out: ExtractedEntity[] = []
    const currency = data.currency ?? 'KZT'

    for (const p of data.periods ?? []) {
      const base = {
        confidence: data.confidence,
        source_type: 'document' as const,
        extractor_name: NAME,
        extractor_version: VERSION,
        source_doc_id: ctx.documentId,
        period_year: p.year,
        period_quarter: p.quarter as FiscalQuarter | undefined,
        raw_excerpt: excerpt(text, 200),
      }
      const periodTag = `${p.year}${p.quarter ? '.' + p.quarter : ''}`

      if (typeof p.revenue === 'number')           out.push(makeEntity({ ...base, entity_type: 'metric.revenue',          value: p.revenue,          unit: currency, source_field: `fin.revenue.${periodTag}` }))
      if (typeof p.gross_profit === 'number')      out.push(makeEntity({ ...base, entity_type: 'metric.gross_profit',     value: p.gross_profit,     unit: currency, source_field: `fin.gross_profit.${periodTag}` }))
      if (typeof p.operating_profit === 'number')  out.push(makeEntity({ ...base, entity_type: 'metric.operating_profit', value: p.operating_profit, unit: currency, source_field: `fin.op_profit.${periodTag}` }))
      if (typeof p.net_profit === 'number')        out.push(makeEntity({ ...base, entity_type: 'metric.net_profit',       value: p.net_profit,       unit: currency, source_field: `fin.net_profit.${periodTag}` }))
      if (typeof p.ebitda === 'number')            out.push(makeEntity({ ...base, entity_type: 'metric.ebitda',           value: p.ebitda,           unit: currency, source_field: `fin.ebitda.${periodTag}` }))
      if (typeof p.cogs === 'number')              out.push(makeEntity({ ...base, entity_type: 'metric.cogs',             value: p.cogs,             unit: currency, source_field: `fin.cogs.${periodTag}` }))
      if (typeof p.opex === 'number')              out.push(makeEntity({ ...base, entity_type: 'metric.opex',             value: p.opex,             unit: currency, source_field: `fin.opex.${periodTag}` }))
      if (typeof p.gross_margin_pct === 'number')  out.push(makeEntity({ ...base, entity_type: 'metric.gross_margin',     value: p.gross_margin_pct, unit: '%',      source_field: `fin.gross_margin.${periodTag}` }))
      if (typeof p.net_margin_pct === 'number')    out.push(makeEntity({ ...base, entity_type: 'metric.net_margin',       value: p.net_margin_pct,   unit: '%',      source_field: `fin.net_margin.${periodTag}` }))
    }

    if (data.top_revenue_lines?.length) {
      out.push(
        makeEntity({
          entity_type: 'asset.revenue_breakdown',
          value: data.top_revenue_lines,
          confidence: data.confidence,
          source_type: 'document',
          extractor_name: NAME,
          extractor_version: VERSION,
          source_doc_id: ctx.documentId,
          source_field: `doc.${input.metadata.fileName}#revenue_breakdown`,
          raw_excerpt: excerpt(text, 200),
        })
      )
    }

    if (data.top_cost_lines?.length) {
      out.push(
        makeEntity({
          entity_type: 'asset.cost_breakdown',
          value: data.top_cost_lines,
          confidence: data.confidence,
          source_type: 'document',
          extractor_name: NAME,
          extractor_version: VERSION,
          source_doc_id: ctx.documentId,
          source_field: `doc.${input.metadata.fileName}#cost_breakdown`,
          raw_excerpt: excerpt(text, 200),
        })
      )
    }

    for (const note of data.notes ?? []) {
      out.push(
        makeEntity({
          entity_type: 'insight.financial_pdf',
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

registerExtractor('generic', 'financial_pdf', financialPdfExtractor)
registerExtractor('generic', 'pl_report', financialPdfExtractor)
registerExtractor('generic', 'balance_sheet', financialPdfExtractor)
registerExtractor('medical', 'financial_pdf', financialPdfExtractor)
registerExtractor('medical', 'pl_report', financialPdfExtractor)
