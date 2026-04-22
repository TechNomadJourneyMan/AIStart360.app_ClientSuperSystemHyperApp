/**
 * CRM export extractor.
 *
 * Parses exports from Bitrix24, amoCRM, Salesforce, HubSpot, generic CSV
 * dumps, etc. Emits pipeline metrics (win rate, cycle time, stage conversion)
 * plus lost-reasons insight.
 */

import type { ParsedDocument } from '@/lib/documents/parse'

import { CLAUDE_MODELS } from '../../anthropic'
import { extractWithCache } from '../../prompt-cache'
import { excerpt, makeEntity } from '../base'
import { crmExportSchema } from '../schemas/sales'
import type { Extractor, ExtractorContext, ExtractedEntity } from '../types'
import { registerExtractor } from '../index'

const NAME = 'generic.crm-export'
const VERSION = '1.0.0'

const SYSTEM_PROMPT = `You are a CRM-pipeline extractor.

Given a parsed CRM export (xlsx/csv/pdf), compute / extract:

1. Deal counts: total, won, lost, open.
2. Win rate %, average cycle days (created → closed), average deal value,
   total pipeline value (open deals only).
3. **stages[]** — pipeline stages in order with count and value per stage.
   Conversion % to next stage when derivable.
4. **lost_reasons[]** — top 10 reasons for lost deals with counts and share %.
5. **top_reps[]** — top 10 sales reps by won deals / revenue.
6. currency code.
7. confidence 0..1.

If the dump doesn't include stages or reasons, omit those arrays instead
of inventing labels. Numeric values are plain numbers (no currency suffix).

Return strict JSON only.`

export const crmExportExtractor: Extractor<ParsedDocument> = {
  name: NAME,
  version: VERSION,
  label: 'CRM export (xlsx/csv/pdf)',

  supports(_ctx: ExtractorContext): boolean {
    return true
  },

  async extract(input: ParsedDocument, ctx: ExtractorContext): Promise<ExtractedEntity[]> {
    if (!process.env.ANTHROPIC_API_KEY) return []
    if (!input?.text) return []

    const MAX_CHARS = 40_000
    const text = input.text.length > MAX_CHARS ? input.text.slice(0, MAX_CHARS) : input.text

    const userMsg = `Filename: ${input.metadata.fileName}
Type: ${input.metadata.type}
Word count: ${input.metadata.wordCount}

--- CRM export content ---
${text}`

    const { data } = await extractWithCache({
      system: SYSTEM_PROMPT,
      user: userMsg,
      schema: crmExportSchema,
      model: CLAUDE_MODELS.sonnet,
      maxTokens: 2500,
      temperature: 0,
      schemaName: 'CrmExportExtraction',
    })

    const out: ExtractedEntity[] = []
    const currency = data.currency ?? 'KZT'
    const baseMeta = {
      confidence: data.confidence,
      source_type: 'document' as const,
      extractor_name: NAME,
      extractor_version: VERSION,
      source_doc_id: ctx.documentId,
      raw_excerpt: excerpt(text, 200),
    }

    // Headline metrics
    out.push(makeEntity({ ...baseMeta, entity_type: 'metric.deals_total', value: data.deal_count_total, unit: 'count', source_field: 'crm.deals_total' }))
    out.push(makeEntity({ ...baseMeta, entity_type: 'metric.deals_closed', value: data.deal_count_won, unit: 'count', source_field: 'crm.deals_won' }))
    out.push(makeEntity({ ...baseMeta, entity_type: 'metric.deals_rejected', value: data.deal_count_lost, unit: 'count', source_field: 'crm.deals_lost' }))
    out.push(makeEntity({ ...baseMeta, entity_type: 'metric.deals_open', value: data.deal_count_open, unit: 'count', source_field: 'crm.deals_open' }))

    if (typeof data.win_rate_pct === 'number') {
      out.push(makeEntity({ ...baseMeta, entity_type: 'metric.win_rate', value: data.win_rate_pct, unit: '%', source_field: 'crm.win_rate' }))
    }
    if (typeof data.avg_cycle_days === 'number') {
      out.push(makeEntity({ ...baseMeta, entity_type: 'metric.deal_cycle_days', value: data.avg_cycle_days, unit: 'days', source_field: 'crm.avg_cycle' }))
    }
    if (typeof data.avg_deal_value === 'number') {
      out.push(makeEntity({ ...baseMeta, entity_type: 'metric.avg_deal_value', value: data.avg_deal_value, unit: currency, source_field: 'crm.avg_deal_value' }))
    }
    if (typeof data.total_pipeline_value === 'number') {
      out.push(makeEntity({ ...baseMeta, entity_type: 'metric.pipeline_value', value: data.total_pipeline_value, unit: currency, source_field: 'crm.pipeline_value' }))
    }

    // Stages + lost reasons + top reps stored as asset aggregates (one row each)
    if (data.stages?.length) {
      out.push(makeEntity({ ...baseMeta, entity_type: 'asset.pipeline_stages', value: data.stages, source_field: 'crm.stages' }))
    }
    if (data.lost_reasons?.length) {
      out.push(makeEntity({ ...baseMeta, entity_type: 'asset.lost_reasons', value: data.lost_reasons, source_field: 'crm.lost_reasons' }))
    }
    if (data.top_reps?.length) {
      out.push(makeEntity({ ...baseMeta, entity_type: 'asset.top_reps', value: data.top_reps, source_field: 'crm.top_reps' }))
    }

    for (const note of data.notes ?? []) {
      out.push(
        makeEntity({
          ...baseMeta,
          confidence: data.confidence * 0.9,
          entity_type: 'insight.crm_export',
          value: note,
          source_field: 'crm.note',
          raw_excerpt: excerpt(note, 200),
        })
      )
    }

    return out
  },
}

registerExtractor('generic', 'crm_export', crmExportExtractor)
registerExtractor('medical', 'crm_export', crmExportExtractor)
