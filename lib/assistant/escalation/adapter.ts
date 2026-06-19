/**
 * lib/assistant/escalation/adapter.ts — escalation core.
 *
 * The Smart Assistant routes problems it cannot resolve on its own to a human
 * expert by opening an {@link ExpertCase}. This module owns:
 *
 *   1. {@link EscalationAdapter} — the delivery-channel contract.
 *   2. {@link EscalationDispatcher} — a registry that fans a case out to every
 *      enabled adapter with Promise.allSettled (fire-and-forget, NEVER throws —
 *      same discipline as lib/notifications.ts notifyAdmins).
 *   3. {@link createExpertCase} — builds an ExpertCase from the curated
 *      {@link AssistantContext} + detected issues and dispatches it.
 *   4. {@link shouldEscalate} — centralises the 5 escalation triggers so every
 *      call site agrees on what counts as "needs a human".
 *
 * ANTI-HALLUCINATION: this module only ever reads the curated AssistantContext
 * snapshot (built by lib/assistant/context.ts) and ValidationIssue[] — never raw
 * DB rows. The case summary repeats only values already present in the snapshot;
 * it invents no numbers.
 *
 * PRIMARY CHANNEL: the InternalAdapter (always on) persists the case via the
 * service role and notifies admins. Telegram / Email adapters are optional,
 * env-gated no-op stubs today.
 */

import type {
  AssistantContext,
  ExpertCase,
  EscalationTrigger,
  ValidationIssue,
  LlmAnalysis,
} from '../types'
import { InternalEscalationAdapter } from './internal-adapter'
import { TelegramEscalationAdapter } from './telegram-adapter'
import { EmailEscalationAdapter } from './email-adapter'

// ─── Adapter contract ───────────────────────────────────────────────────────

/**
 * A single escalation delivery channel. Implementations MUST be fire-and-forget:
 * notify() resolves even on failure (catch internally, log, never throw) so one
 * broken channel can never block the others or surface an error to the caller.
 */
export interface EscalationAdapter {
  /** Stable channel id used in logs (e.g. 'internal', 'telegram', 'email'). */
  readonly name: string
  /** Whether this adapter should run. The dispatcher skips disabled adapters. */
  isEnabled(): boolean
  /** Deliver the case. Must resolve (not reject) on failure. */
  notify(c: ExpertCase): Promise<void>
}

// ─── Dispatcher ─────────────────────────────────────────────────────────────

/**
 * Holds the adapter registry and fans a case out to every ENABLED adapter via
 * Promise.allSettled. Mirrors notifyAdmins: errors are swallowed/logged, the
 * returned promise always resolves. The InternalAdapter is the primary channel
 * and is registered by default; Telegram/Email join when their env flags are on.
 */
export class EscalationDispatcher {
  private readonly adapters: EscalationAdapter[]

  constructor(adapters: EscalationAdapter[]) {
    this.adapters = adapters
  }

  /** Adapter names that are currently enabled (for diagnostics/logging). */
  enabledAdapters(): string[] {
    return this.adapters.filter((a) => a.isEnabled()).map((a) => a.name)
  }

  /**
   * Dispatch a case to all enabled adapters. Never throws. Always resolves once
   * every adapter has settled (each adapter is itself fire-and-forget).
   */
  async dispatch(c: ExpertCase): Promise<void> {
    const enabled = this.adapters.filter((a) => a.isEnabled())
    const results = await Promise.allSettled(
      enabled.map((a) =>
        // Defensive: even though adapters promise not to throw, wrap so a
        // synchronous throw inside notify() can't escape the dispatcher.
        Promise.resolve()
          .then(() => a.notify(c))
          .catch((err) => {
            console.error(`[escalation] adapter "${a.name}" failed:`, err)
          }),
      ),
    )
    // Promise.allSettled never rejects; this loop is purely for visibility.
    for (let i = 0; i < results.length; i++) {
      const r = results[i]
      if (r.status === 'rejected') {
        console.error(`[escalation] adapter "${enabled[i]?.name}" rejected:`, r.reason)
      }
    }
  }
}

/**
 * The default dispatcher: InternalAdapter (always on) + env-gated Telegram/Email
 * stubs. Construct once and reuse — adapters read their env flags lazily in
 * isEnabled(), so a single instance respects runtime config changes per call.
 */
export const defaultEscalationDispatcher = new EscalationDispatcher([
  new InternalEscalationAdapter(),
  new TelegramEscalationAdapter(),
  new EmailEscalationAdapter(),
])

// ─── Case construction + dispatch ───────────────────────────────────────────

/** Default human-readable title per trigger (Russian) when none supplied. */
const TRIGGER_TITLE_RU: Record<EscalationTrigger, string> = {
  user_requested_help: 'Клиент запросил помощь эксперта',
  validation_issue: 'Обнаружены критичные ошибки в данных',
  llm_recommendation: 'AI рекомендует подключить эксперта',
  critical_risk: 'Критический риск в диагностике',
  incomplete_data: 'Недостаточно данных для анализа',
  manual: 'Обращение к эксперту',
}

/** Pick the default priority for a trigger when the caller does not force one. */
function defaultPriority(trigger: EscalationTrigger): ExpertCase['priority'] {
  switch (trigger) {
    case 'critical_risk':
      return 'critical'
    case 'user_requested_help':
    case 'llm_recommendation':
      return 'high'
    case 'validation_issue':
      return 'medium'
    case 'incomplete_data':
    case 'manual':
    default:
      return 'low'
  }
}

export interface CreateExpertCaseInput {
  triggerType: EscalationTrigger
  /** Optional override; falls back to a Russian per-trigger default. */
  title?: string
  /** Optional override; falls back to a snapshot-derived summary. */
  summary?: string
  /** Issues that motivated the escalation (carried into the case verbatim). */
  detectedIssues?: ValidationIssue[]
  /** Free-text message the client typed when asking for help. */
  userMessage?: string
  /** What the assistant suggested before escalating (no fabricated numbers). */
  assistantRecommendation?: string
  /** Optional priority override; falls back to a per-trigger default. */
  priority?: ExpertCase['priority']
}

/**
 * Build an {@link ExpertCase} from the curated context + detected issues and
 * dispatch it through `dispatcher` (defaults to {@link defaultEscalationDispatcher}).
 *
 * The returned object is the in-memory case (its `id` is a client-side temp id;
 * the InternalAdapter writes the authoritative row and the DB assigns the real
 * UUID). Persistence + admin notification happen inside the InternalAdapter so
 * this function never touches the DB directly and never throws.
 */
export async function createExpertCase(
  ctx: AssistantContext,
  input: CreateExpertCaseInput,
  dispatcher: EscalationDispatcher = defaultEscalationDispatcher,
): Promise<ExpertCase> {
  const now = new Date().toISOString()
  const detectedIssues = input.detectedIssues ?? []
  const priority = input.priority ?? defaultPriority(input.triggerType)

  const expertCase: ExpertCase = {
    // Temp client-side id — the InternalAdapter's service-role INSERT returns the
    // canonical UUID; downstream consumers should rely on the persisted row.
    id: `tmp_${ctx.userId}_${Date.now()}`,
    userId: ctx.userId,
    companyId: ctx.company.id ?? undefined,
    diagnosticId: ctx.diagnosticId ?? undefined,
    status: 'new',
    priority,
    triggerType: input.triggerType,
    title: input.title?.trim() || TRIGGER_TITLE_RU[input.triggerType],
    summary: input.summary?.trim() || buildSummary(ctx, input.triggerType, detectedIssues),
    detectedIssues,
    userMessage: input.userMessage,
    assistantRecommendation: input.assistantRecommendation,
    createdAt: now,
    updatedAt: now,
  }

  await dispatcher.dispatch(expertCase)
  return expertCase
}

/**
 * Compose a Russian, snapshot-only summary. Uses ONLY values already present in
 * the curated context (no DB access, no invented numbers); missing values are
 * simply omitted rather than guessed.
 */
function buildSummary(
  ctx: AssistantContext,
  trigger: EscalationTrigger,
  issues: ValidationIssue[],
): string {
  const parts: string[] = []

  const companyName = ctx.company.name?.trim()
  parts.push(companyName ? `Компания: ${companyName}.` : 'Компания: не указана.')

  if (ctx.pointA.has_diagnostic && ctx.pointA.overall_score != null) {
    parts.push(`Общий балл диагностики: ${ctx.pointA.overall_score}.`)
  }
  if (ctx.pointB.realism.level) {
    parts.push(`Реалистичность цели: ${ctx.pointB.realism.level}.`)
  }

  const errorCount = issues.filter((i) => i.severity === 'error').length
  if (errorCount > 0) parts.push(`Критичных ошибок в данных: ${errorCount}.`)

  parts.push(`Триггер эскалации: ${trigger}.`)
  return parts.join(' ')
}

// ─── Trigger logic ──────────────────────────────────────────────────────────

/** What {@link shouldEscalate} decided, and why. */
export interface EscalationDecision {
  escalate: boolean
  triggerType: EscalationTrigger | null
  priority: ExpertCase['priority']
  reason: string
}

export interface ShouldEscalateOptions {
  /** True when the client explicitly clicked the "request expert help" button. */
  userRequestedHelp?: boolean
  /**
   * True when the assistant exhausted its prompts and still cannot reach
   * ready_for_analysis (caller derives this from CompletionReport.status).
   */
  cannotReachAnalysis?: boolean
}

/**
 * Centralise the FIVE escalation triggers (design §escalation). Evaluated in
 * priority order; the first match wins so a case carries the most urgent reason.
 *
 *   1. user_requested_help — explicit client button.
 *   2. critical_risk       — Point A risk level 'critical' OR realism 'unrealistic'.
 *   3. validation_issue    — >= 1 error-severity inconsistency.
 *   4. llm_recommendation  — LlmAnalysis.expert_escalation.recommended === true.
 *   5. incomplete_data     — cannot reach ready_for_analysis after prompts.
 *
 * 'manual' is intentionally NOT produced here — it is reserved for admin/expert
 * hand-created cases that bypass this gate.
 */
export function shouldEscalate(
  ctx: AssistantContext,
  issues: ValidationIssue[],
  llm: LlmAnalysis | null,
  opts: ShouldEscalateOptions = {},
): EscalationDecision {
  // 1. Explicit user request — highest signal of intent.
  if (opts.userRequestedHelp) {
    return {
      escalate: true,
      triggerType: 'user_requested_help',
      priority: 'high',
      reason: 'Клиент явно запросил помощь эксперта.',
    }
  }

  // 2. Critical risk — Point A critical risk OR an unrealistic Point B goal.
  const hasCriticalRisk = ctx.pointA.risks.some(
    (r) => String(r.level).toLowerCase() === 'critical',
  )
  const realismLevel = String(ctx.pointB.realism.level ?? '').toLowerCase()
  const unrealistic = realismLevel === 'unrealistic' || realismLevel === 'нереалистично'
  if (hasCriticalRisk || unrealistic) {
    return {
      escalate: true,
      triggerType: 'critical_risk',
      priority: 'critical',
      reason: hasCriticalRisk
        ? 'В диагностике обнаружен критический риск.'
        : 'Цель оценена как нереалистичная.',
    }
  }

  // 3. Validation issue — at least one error-severity inconsistency.
  const errorCount = issues.filter((i) => i.severity === 'error').length
  if (errorCount >= 1) {
    return {
      escalate: true,
      triggerType: 'validation_issue',
      priority: 'medium',
      reason: `Найдено критичных ошибок в данных: ${errorCount}.`,
    }
  }

  // 4. LLM recommendation — the semantic layer asked for a human.
  if (llm && !llm.insufficient_data && llm.expert_escalation?.recommended) {
    const p = llm.expert_escalation.priority ?? 'medium'
    return {
      escalate: true,
      triggerType: 'llm_recommendation',
      priority: p,
      reason: llm.expert_escalation.reason?.trim() || 'AI рекомендует подключить эксперта.',
    }
  }

  // 5. Incomplete data — assistant cannot advance to analysis after prompting.
  if (opts.cannotReachAnalysis) {
    return {
      escalate: true,
      triggerType: 'incomplete_data',
      priority: 'low',
      reason: 'Недостаточно данных для перехода к анализу даже после подсказок.',
    }
  }

  return {
    escalate: false,
    triggerType: null,
    priority: 'low',
    reason: 'Эскалация не требуется.',
  }
}
