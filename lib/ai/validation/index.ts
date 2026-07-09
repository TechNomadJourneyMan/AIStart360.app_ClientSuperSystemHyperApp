/**
 * lib/ai/validation/index.ts — the answer validation pipeline.
 *
 * Combines the always-on deterministic checker with an optional (injected) LLM
 * validator and the safe-response templates, producing the final answer to show
 * the user. Pure orchestration — the LLM is a dependency, so the whole decision
 * flow is unit-testable. See docs/SPEC-2026-07-09-AI-FEATURES/08-validation-layer.md.
 */

import { runDeterministicChecks, type DeterministicIssue, type RiskLevel } from './deterministic'
import { renderTemplate, type TemplateId } from './templates'

export type ValidationStatus = 'approved' | 'needs_revision' | 'blocked'

export interface LlmValidatorResult {
  status: ValidationStatus
  riskLevel?: RiskLevel
  issues?: DeterministicIssue[]
  rewrittenAnswer?: string | null
  templateId?: string | null
}

export type LlmValidator = (args: {
  answer: string
  issues: DeterministicIssue[]
  riskLevel: RiskLevel
}) => Promise<LlmValidatorResult>

export interface AnswerValidationInput {
  answer: string
  usedSources?: Array<{ ref: string }>
  providedSources?: string[]
  contextNumbers?: number[]
}

export interface AnswerValidationDeps {
  llmValidate?: LlmValidator
  /** 'always' (default when a validator is given) or 'risk_based' (skip on clean low-risk). */
  llmMode?: 'always' | 'risk_based'
}

export interface AnswerValidationResult {
  status: ValidationStatus
  riskLevel: RiskLevel
  issues: DeterministicIssue[]
  cleanedAnswer: string
  templateId: string | null
  /** What to actually show the user. */
  finalAnswer: string
  usedLlm: boolean
}

const STATUS_RANK: Record<ValidationStatus, number> = { approved: 0, needs_revision: 1, blocked: 2 }
const RISK_RANK: Record<RiskLevel, number> = { low: 0, medium: 1, high: 2 }

const worseStatus = (a: ValidationStatus, b: ValidationStatus): ValidationStatus =>
  STATUS_RANK[a] >= STATUS_RANK[b] ? a : b
const worseRisk = (a: RiskLevel, b: RiskLevel): RiskLevel => (RISK_RANK[a] >= RISK_RANK[b] ? a : b)

/** Map deterministic errors to an initial status + template. */
function deterministicVerdict(issues: DeterministicIssue[]): { status: ValidationStatus; templateId: string | null } {
  const errors = issues.filter((i) => i.severity === 'error')
  if (errors.length === 0) return { status: 'approved', templateId: null }

  if (errors.some((e) => e.category === 'data_leakage' || e.category === 'security' || e.category === 'prompt_injection')) {
    return { status: 'blocked', templateId: 'T16' }
  }
  if (errors.some((e) => e.category === 'psychological_risk' || e.category === 'medical_risk')) {
    return { status: 'blocked', templateId: 'T10' }
  }
  // e.g. an unsafe guarantee — needs a rewrite; no auto-template yet.
  return { status: 'needs_revision', templateId: null }
}

export async function runAnswerValidation(
  input: AnswerValidationInput,
  deps: AnswerValidationDeps = {},
): Promise<AnswerValidationResult> {
  const det = runDeterministicChecks(input)
  const verdict = deterministicVerdict(det.issues)

  let status = verdict.status
  let templateId = verdict.templateId
  let riskLevel = det.riskLevel
  let issues = det.issues
  let rewritten: string | null = null
  let usedLlm = false

  const mode = deps.llmMode ?? 'always'
  const shouldCallLlm =
    !!deps.llmValidate && (mode === 'always' || riskLevel !== 'low' || status !== 'approved')

  if (deps.llmValidate && shouldCallLlm) {
    try {
      const llm = await deps.llmValidate({ answer: det.cleanedAnswer, issues: det.issues, riskLevel })
      usedLlm = true
      status = worseStatus(status, llm.status)
      if (llm.templateId) templateId = llm.templateId
      if (llm.rewrittenAnswer) rewritten = llm.rewrittenAnswer
      if (llm.riskLevel) riskLevel = worseRisk(riskLevel, llm.riskLevel)
      if (llm.issues?.length) issues = [...issues, ...llm.issues]
    } catch {
      // Validator failed. On anything but a clean low-risk answer, refuse to
      // pass the raw answer through — degrade to the cautious template.
      if (riskLevel !== 'low' || status !== 'approved') {
        status = worseStatus(status, 'needs_revision')
      }
    }
  }

  const finalAnswer =
    status === 'blocked'
      ? renderTemplate((templateId as TemplateId) ?? 'T16')
      : status === 'needs_revision'
        ? (rewritten ?? renderTemplate('T2'))
        : det.cleanedAnswer

  return { status, riskLevel, issues, cleanedAnswer: det.cleanedAnswer, templateId, finalAnswer, usedLlm }
}
