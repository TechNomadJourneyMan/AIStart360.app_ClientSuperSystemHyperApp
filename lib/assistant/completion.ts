/**
 * lib/assistant/completion.ts — completion engine + status state machine.
 *
 *   computeCompletion(ctx)  → overall_pct + per-section pct + missing lists
 *   deriveStatus(...)       → the AssistantStatus lifecycle
 *
 * Both walk the single editable SECTION_FIELD_MAP (lib/assistant/sections.ts),
 * using its alias-aware isFieldAnswered() so the legacy s2_/s3_/s6_ and current
 * s*n_ survey generations both count correctly (no false "missing").
 */

import {
  SECTION_FIELD_MAP,
  isFieldAnswered,
  type AssistantSection,
} from './sections'
import type {
  AssistantContext,
  AssistantStatus,
  CompletionReport,
  LlmAnalysis,
  SectionCompletion,
  ValidationIssue,
} from './types'

// ─── computeCompletion ───────────────────────────────────────────────────────

function sectionCompletion(
  section: AssistantSection,
  answers: Record<string, unknown>,
): SectionCompletion {
  const missing_required: string[] = []
  const missing_recommended: string[] = []
  let requiredFilled = 0

  for (const field of section.required) {
    if (isFieldAnswered(answers, field)) requiredFilled++
    else missing_required.push(field.key)
  }
  for (const field of section.recommended) {
    if (!isFieldAnswered(answers, field)) missing_recommended.push(field.key)
  }

  const requiredTotal = section.required.length
  // A section with no required fields is, by definition, 100% on the required
  // axis — it can never block readiness (recommended fields are advisory).
  const pct =
    requiredTotal === 0 ? 100 : Math.round((requiredFilled / requiredTotal) * 100)

  return {
    section: section.id,
    label: section.label,
    step: section.step,
    pct,
    missing_required,
    missing_recommended,
    required_total: requiredTotal,
    required_filled: requiredFilled,
  }
}

/**
 * Walk SECTION_FIELD_MAP and produce the aggregate completion. `overall_pct` is
 * the share of ALL required fields answered across every section (not an average
 * of section percentages) so a section with more required fields weighs more.
 *
 * Note: `status` is set to a provisional value here and is the caller's job to
 * finalize via {@link deriveStatus} once validation issues (and optionally LLM
 * analysis) are known. We pre-fill it from completion alone for convenience.
 */
export function computeCompletion(ctx: AssistantContext): CompletionReport {
  const answers = ctx.answers ?? {}

  const sections = SECTION_FIELD_MAP.map((s) => sectionCompletion(s, answers))

  let requiredTotal = 0
  let requiredFilled = 0
  const missing_required: string[] = []
  const missing_recommended: string[] = []

  for (const s of sections) {
    requiredTotal += s.required_total
    requiredFilled += s.required_filled
    missing_required.push(...s.missing_required)
    missing_recommended.push(...s.missing_recommended)
  }

  const overall_pct =
    requiredTotal === 0 ? 100 : Math.round((requiredFilled / requiredTotal) * 100)

  const report: CompletionReport = {
    overall_pct,
    sections,
    status: 'not_started',
    missing_required,
    missing_recommended,
  }
  // Provisional status from completion only; deriveStatus() refines it with
  // issues + llm. Computing it here keeps computeCompletion() useful standalone.
  report.status = deriveStatus(report, [])
  return report
}

// ─── deriveStatus — the AssistantStatus state machine ───────────────────────

function hasAnyData(ctx: AssistantContext | null, completion: CompletionReport): boolean {
  if (completion.overall_pct > 0) return true
  if (!ctx) return false
  if (ctx.pointA.has_diagnostic) return true
  if (ctx.answers && Object.keys(ctx.answers).length > 0) return true
  return false
}

/**
 * Map completion + issues (+ optional LLM analysis + ctx) to the lifecycle.
 *
 * Precedence (highest first):
 *   1. ready_for_expert_review — LLM recommends escalation (explicit human-review signal)
 *   2. needs_attention         — any error-severity issue (contradictory/blocking data)
 *   3. completed               — 100% required, no errors, analysis present
 *   4. ready_for_analysis      — all required complete, no errors → safe to run LLM
 *   5. not_started             — no data at all
 *   6. in_progress             — some data, required not complete, no blocking errors
 *
 * Rationale for ordering: an error must win over a high % (a user can be 100%
 * "filled" yet have contradictory numbers) — but an explicit expert-review
 * recommendation from the LLM is the strongest signal and wins over everything,
 * matching the spec's ready_for_expert_review gate (shouldEscalate true).
 */
export function deriveStatus(
  completion: CompletionReport,
  issues: ValidationIssue[],
  llm?: LlmAnalysis | null,
  ctx?: AssistantContext | null,
): AssistantStatus {
  const hasErrors = issues.some((i) => i.severity === 'error')
  const requiredComplete = completion.missing_required.length === 0
  const escalationRecommended = !!llm?.expert_escalation?.recommended

  // 1. Expert review requested by the analysis layer.
  if (escalationRecommended) return 'ready_for_expert_review'

  // 2. Blocking errors trump everything else (except an explicit escalation).
  if (hasErrors) return 'needs_attention'

  // 5. No data at all.
  if (!hasAnyData(ctx ?? null, completion)) return 'not_started'

  // 6. Data present but required fields still incomplete.
  if (!requiredComplete) return 'in_progress'

  // Required complete + no errors below this point.

  // 3. Completed — fully filled (required + recommended) and analysis generated.
  const recommendedComplete = completion.missing_recommended.length === 0
  const analysisDone = !!llm && !llm.insufficient_data
  if (completion.overall_pct >= 100 && recommendedComplete && analysisDone) {
    return 'completed'
  }

  // 4. Ready to run the LLM analysis.
  return 'ready_for_analysis'
}
