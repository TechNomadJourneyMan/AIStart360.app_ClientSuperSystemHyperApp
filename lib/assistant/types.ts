/**
 * lib/assistant/types.ts — SINGLE SOURCE OF TRUTH for the Smart Assistant module.
 *
 * Every other assistant module (sections, context, completion, validators,
 * llm-analyzer, escalation, chat-scripts) imports its shared types from here.
 * NO runtime logic lives in this file — types only.
 *
 * ANTI-HALLUCINATION BOUNDARY: {@link AssistantContext} is the ONLY structure
 * ever serialized into an LLM prompt. It is a curated snapshot assembled by
 * lib/assistant/context.ts — never a raw DB row dump. If a future change passes
 * raw rows to the LLM, the honesty guarantee breaks.
 */

// ─── Completion status state machine ────────────────────────────────────────

/**
 * The lifecycle of a client's assistant readiness. Derived by
 * lib/assistant/completion.ts deriveStatus():
 *   not_started → in_progress → needs_attention → ready_for_analysis
 *   → ready_for_expert_review → completed
 */
export type AssistantStatus =
  | 'not_started'
  | 'in_progress'
  | 'needs_attention'
  | 'ready_for_analysis'
  | 'ready_for_expert_review'
  | 'completed'

// ─── Validation issues ──────────────────────────────────────────────────────

/**
 * A single problem found by the deterministic field validators (Layer 1),
 * the configurable inconsistency rules (Layer 2), or the optional LLM
 * semantic checks (Layer 3). All user-facing copy is Russian (`*_ru`).
 */
export interface ValidationIssue {
  id: string
  severity: 'error' | 'warning' | 'info'
  /** Section this issue belongs to (анкета step id / key from SECTION_FIELD_MAP). */
  section: string
  /** Optional survey question key the issue is attached to (for inline hints). */
  field?: string
  /** Stable machine code (e.g. 'empty_required_field', 'percent_out_of_range'). */
  code: string
  message_ru: string
  hint_ru?: string
  source: 'deterministic' | 'diagnostic' | 'llm'
}

// ─── Completion report ──────────────────────────────────────────────────────

/** Per-section completion produced by computeCompletion(). */
export interface SectionCompletion {
  /** Section id (matches SECTION_FIELD_MAP key, e.g. 'finance', 'goals'). */
  section: string
  /** Russian label for the section (drives the UI). */
  label: string
  /** Анкета step number (1–12) this section maps to. */
  step: number
  /** Required-field completion for this section, 0–100. */
  pct: number
  /** Required keys still empty in this section. */
  missing_required: string[]
  /** Recommended keys still empty in this section. */
  missing_recommended: string[]
  /** Number of required keys defined for the section. */
  required_total: number
  /** Number of required keys answered. */
  required_filled: number
}

/** Aggregate completion across all 12 sections. */
export interface CompletionReport {
  overall_pct: number
  sections: SectionCompletion[]
  status: AssistantStatus
  missing_required: string[]
  missing_recommended: string[]
}

// ─── LLM semantic analysis (Layer 3) ────────────────────────────────────────

/**
 * Result of the optional OpenRouter semantic analysis. Honest by construction:
 * when key inputs are missing the analyzer sets `insufficient_data: true`, lists
 * `missing_data`, and never fabricates numbers (mirrors point-a-analyzer.ts).
 */
export interface LlmAnalysis {
  situation_summary: string
  strengths: string[]
  weaknesses: string[]
  risks: string[]
  opportunities: string[]
  missing_data: string[]
  next_actions: string[]
  questions_for_user: string[]
  expert_escalation: {
    recommended: boolean
    priority: 'low' | 'medium' | 'high' | 'critical'
    reason: string
  }
  confidence: number
  insufficient_data: boolean
}

// ─── Expert escalation ──────────────────────────────────────────────────────

/** The five escalation triggers plus the manual catch-all. */
export type EscalationTrigger =
  | 'user_requested_help'
  | 'validation_issue'
  | 'llm_recommendation'
  | 'critical_risk'
  | 'incomplete_data'
  | 'manual'

/**
 * An escalation case routed to a human expert. Persisted to public.expert_cases
 * (companyId is TEXT — companies.id is Prisma-owned TEXT, not UUID).
 */
export interface ExpertCase {
  id: string
  userId: string
  companyId?: string
  diagnosticId?: string
  status: 'new' | 'in_progress' | 'resolved' | 'closed'
  priority: 'low' | 'medium' | 'high' | 'critical'
  triggerType: EscalationTrigger
  title: string
  summary: string
  detectedIssues: ValidationIssue[]
  userMessage?: string
  assistantRecommendation?: string
  expertActionRecommended?: string
  createdAt: string
  updatedAt: string
}

// ─── Chat scripts (ready-made Q&A 7.1–7.12) ─────────────────────────────────

/**
 * A ready-made assistant question + Russian answer-script template. The chat
 * API hydrates `scriptOutline` against {@link AssistantContext}; every numeric
 * slot must fall back to a "Недостаточно данных" branch when the ctx field is
 * null (никаких выдуманных цифр).
 */
export interface ChatScript {
  id: string
  section: string
  question: string
  intent: string
  /** Which ctx fields this script reads (documentation + hydration map). */
  usesData: string
  scriptOutline: string
  valueLine?: string
}

// ─── AssistantContext — the curated snapshot the LLM sees ────────────────────

/** Point A block summary (one of finance/sales/operations/marketing/strategy). */
export interface AssistantBlock {
  key: string
  label: string
  score: number
  status: string
}

/** Point A slice of the snapshot (from the current diagnostic). */
export interface AssistantPointA {
  has_diagnostic: boolean
  overall_score: number | null
  health_index: number | null
  stage: string | null
  blocks: AssistantBlock[]
  /** Weakest blocks first (by score). */
  weakest_blocks: AssistantBlock[]
  risks: Array<{ level: string; area: string; text: string }>
  data_gaps: Array<{ field: string; step: number; impact: string }>
  quick_wins: Array<{ action: string; timeline: string; area: string }>
}

/** Point B gap/realism slice (from calculatePointBV2 — never fabricated). */
export interface AssistantPointB {
  has_goal: boolean
  current_revenue_year: number | null
  goal_12m_revenue_year: number | null
  goal_3y_revenue_year: number | null
  gap: {
    multiplier: number | null
    required_cagr: number | null
    required_mom_growth: number | null
    data_complete: boolean
  }
  realism: {
    level: string
    score: number
    rationale: string[]
    weak_blocks: string[]
  }
  data_sufficiency: {
    sufficient: boolean
    confidence: number
    missing: string[]
    have: string[]
  }
  levers: Array<{ key: string; label: string; expected_effect: string; data_available: boolean }>
  top5_limits: Array<{ rank: number; title: string; block: string; severity: string }>
}

/** GRI slice (gri_assessments — gri_index is 0–10). */
export interface AssistantGri {
  has_assessment: boolean
  gri_index: number | null
  top_5_limits: Array<{ rank: number; title: string; block: string; score: number | null }>
}

/** Metrics slice (canonical revenue from public.metrics). */
export interface AssistantMetrics {
  revenue: number | null
  revenue_year: number | null
}

/** Company-level targets/identity used by rules and chat scripts. */
export interface AssistantCompany {
  id: string | null
  name: string | null
  stage: string | null
  industry: string | null
  employee_count: number | null
  target_revenue_12m_kzt: number | null
  target_revenue_3y_kzt: number | null
}

/**
 * The curated snapshot. THE ONLY thing serialized into the LLM prompt.
 * `answers` holds parsed survey values (answer.value already unwrapped), keyed
 * by question_key — consumed by the deterministic validators and chat scripts.
 */
export interface AssistantContext {
  userId: string
  diagnosticId: string | null
  generatedAt: string

  company: AssistantCompany
  /** Parsed survey answers (flat { question_key: value }, value unwrapped). */
  answers: Record<string, unknown>

  pointA: AssistantPointA
  pointB: AssistantPointB
  gri: AssistantGri
  metrics: AssistantMetrics

  /** Present only after the LLM layer has run (Layer 3); null otherwise. */
  llm_analysis: LlmAnalysis | null
}
