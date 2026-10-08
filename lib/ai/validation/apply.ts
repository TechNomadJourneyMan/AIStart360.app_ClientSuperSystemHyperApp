/**
 * lib/ai/validation/apply.ts — run the answer validator on any AI text (F-072).
 *
 * The report chat (`/api/v1/ai/chat`) already validates its answers; the
 * assistant routes (ask / converse / insight) and the Pulse briefing now go
 * through the same pipeline: data-leak / prompt-echo / unsafe-guarantee /
 * psychological-diagnosis checks, PII scrubbing, and — on failure — the safe
 * template instead of the raw model text. The outcome is returned as small
 * metadata that routes put into their JSON response (`validation`).
 */

import { runAnswerValidation, type ValidationStatus } from './index'
import type { RiskLevel } from './deterministic'

export interface AiTextValidationMeta {
  status: ValidationStatus
  risk_level: RiskLevel
  template: string | null
  issues: number
}

export interface ValidatedAiText {
  /** What to show the user (cleaned answer, or a safe template). */
  text: string
  /** True when the model text passed as-is (only PII-cleaned). */
  approved: boolean
  meta: AiTextValidationMeta
}

export async function validateAiText(
  answer: string,
  opts: { contextNumbers?: number[] } = {},
): Promise<ValidatedAiText> {
  const v = await runAnswerValidation({ answer, contextNumbers: opts.contextNumbers })
  return {
    text: v.finalAnswer,
    approved: v.status === 'approved',
    meta: { status: v.status, risk_level: v.riskLevel, template: v.templateId, issues: v.issues.length },
  }
}
