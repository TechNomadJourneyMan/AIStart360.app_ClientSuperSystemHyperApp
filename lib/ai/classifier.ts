/**
 * Document classifier — figures out what kind of document was uploaded
 * when upload UI said "other" or doc_type wasn't trustworthy.
 *
 * Uses Claude Haiku (cheapest, fastest). Cost per classification ~$0.0003.
 * Falls back to 'unknown' on errors so the pipeline can continue with the
 * generic fallback extractor.
 */

import { z } from 'zod'

import { CLAUDE_MODELS } from './anthropic'
import { extractWithCache } from './prompt-cache'

export type DocClass =
  | 'sales_report'
  | 'crm_export'
  | 'financial_pdf'
  | 'pricelist'
  | 'patient_base'
  | 'brand_guide'
  | 'marketing_report'
  | 'ops_report'
  | 'other'

export type VerticalGuess = 'generic' | 'medical'

export interface ClassificationResult {
  doc_type: DocClass
  vertical: VerticalGuess
  confidence: number
  reasoning: string
}

const SCHEMA = z.object({
  doc_type: z.enum([
    'sales_report',
    'crm_export',
    'financial_pdf',
    'pricelist',
    'patient_base',
    'brand_guide',
    'marketing_report',
    'ops_report',
    'other',
  ]),
  vertical: z.enum(['generic', 'medical']),
  confidence: z.number().min(0).max(1),
  reasoning: z.string().max(500),
})

const SYSTEM_PROMPT = `You are a document classifier for a business-analytics platform.

Given the first ~3000 characters of a document plus its filename, identify:

1. doc_type — what kind of business document this is. Choose one:
   - sales_report: revenue / deals / channels / pipeline data
   - crm_export: CRM dump with deal stages, lost reasons, salesperson assignments
   - financial_pdf: P&L statement, balance sheet, cash flow, EBITDA report
   - pricelist: catalog of products/services with prices, tariffs, packages
   - patient_base: clinic patient database — names, visit dates, services, amounts
   - brand_guide: brand book — colors, logos, typography, tone of voice
   - marketing_report: campaigns, channels, budgets, ROAS, funnel stats
   - ops_report: operations KPIs, production, fulfillment, inventory
   - other: can't tell

2. vertical — is this a medical/healthcare organization or a generic business?
   Medical clues: patient, prescription, diagnosis, clinic, doctor, appointment,
   insurance codes (МКБ-10, ICD), medical services (УЗИ, ЭКГ).

3. confidence 0..1 — how sure you are.

4. reasoning — 1-2 sentence justification referring to specific content markers.

Return strict JSON, no markdown.`

/**
 * Classify a document snippet. Never throws — returns { doc_type: 'other',
 * vertical: 'generic', confidence: 0 } on failure so the pipeline can
 * continue with fallback extractor.
 */
export async function classifyDocument(params: {
  fileName: string
  textSnippet: string
  hintType?: string
}): Promise<ClassificationResult> {
  if (!process.env.ANTHROPIC_API_KEY) {
    return {
      doc_type: 'other',
      vertical: 'generic',
      confidence: 0,
      reasoning: 'Classifier disabled — ANTHROPIC_API_KEY not set',
    }
  }

  const snippet = params.textSnippet.slice(0, 3000)
  const userMsg = `Filename: ${params.fileName}
Upload hint: ${params.hintType ?? '(none)'}

--- Document excerpt (first 3000 chars) ---
${snippet}`

  try {
    const result = await extractWithCache({
      system: SYSTEM_PROMPT,
      user: userMsg,
      schema: SCHEMA,
      model: CLAUDE_MODELS.haiku,
      maxTokens: 400,
      temperature: 0,
      schemaName: 'DocumentClassification',
    })
    return result.data
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[classifier] fallback to "other":', err instanceof Error ? err.message : err)
    return {
      doc_type: 'other',
      vertical: 'generic',
      confidence: 0,
      reasoning: `Classifier error: ${err instanceof Error ? err.message : String(err)}`,
    }
  }
}
