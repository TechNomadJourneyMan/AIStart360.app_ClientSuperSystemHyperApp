/**
 * lib/assistant/mascot/server-hints.ts — data-driven hint candidates.
 *
 * Pure derivation of proactive hint candidates from the deterministic
 * completion/validation snapshot (ТЗ §7 scenarios 2/4/5/6, §9 priorities).
 * NO LLM here by design — bubbles are scripted; the ids map to copy in the
 * client catalog (lib/assistant/mascot/hints.ts), so the server ships only
 * {id, priority, params}.
 *
 * Priorities (§9): 1 errors/incomplete · 2 next step · 3 insight.
 */

import type { CompletionReport } from '../types'
import type { HintCandidate } from './types'

export interface ServerHintInput {
  completion: CompletionReport
  /** Count of severity==='error' validation issues (layers 1–2). */
  errorCount: number
  hasDiagnostic: boolean
  griIndex: number | null
  /** Title of the top GRI limit, when assessed. */
  topLimit: string | null
  // ── Проблемные сигналы (Батч D) ──────────────────────────────────────────
  // Все опциональны: старые вызовы и юнит-тесты продолжают работать без них.
  // Пороги считает вызывающая сторона (route) под сессией пользователя.
  /** На /metrics пусто (нет диагностики) — предложить заполнить данные. */
  metricsEmpty?: boolean
  /** В диагностике есть красная зона (critical-блок или GRI < 5). */
  redZone?: boolean
  /** Название красного блока для текста совета (RU-лейбл), если известно. */
  redZoneBlock?: string | null
  /** Клиентов CRM в зоне высокого риска (просроченные напоминания + churn=high). */
  clientsAtRisk?: number
  /** Чт–вс, недельный пульс ещё не снят (при наличии GRI-базлайна). */
  pulseMissed?: boolean
}

export function computeServerHints(input: ServerHintInput): HintCandidate[] {
  const { completion, errorCount, hasDiagnostic, griIndex, topLimit } = input
  const hints: HintCandidate[] = []

  const sections = [...completion.sections].sort((a, b) => a.step - b.step)
  const unfinished = sections.filter((s) => s.pct < 100)
  const completedSections = sections.length - unfinished.length

  // 1. Contradictory/blocking data — the strongest nudge (scenario 4 tail).
  if (errorCount > 0) {
    hints.push({ id: 'fix_errors', priority: 1, params: { count: errorCount } })
  }

  // 2. A section already started but not finished (scenario «незавершённое»).
  //    Pick the most-complete unfinished one — the cheapest win for the user.
  const started = unfinished
    .filter((s) => s.pct > 0)
    .sort((a, b) => b.pct - a.pct)[0]
  if (started) {
    hints.push({
      id: 'finish_section',
      priority: 1,
      params: {
        sectionLabel: started.label,
        missing: started.missing_required.length,
        step: started.step,
      },
    })
  }

  // 3. Diagnostics in progress → offer to continue (scenario 2).
  if (completion.status === 'in_progress' && unfinished.length > 0) {
    hints.push({
      id: 'continue_diagnostic',
      priority: 2,
      params: { left: unfinished.length, done: completedSections },
    })
  }

  // 4. Everything required is in → offer to run the analysis (scenario 5→6 bridge).
  if (completion.status === 'ready_for_analysis') {
    hints.push({ id: 'run_analysis', priority: 2 })
  }

  // 5. Fresh results exist → offer to interpret them (scenario 6).
  if (hasDiagnostic && griIndex != null) {
    hints.push({
      id: 'results_ready',
      priority: 3,
      params: { gri: griIndex, topLimit },
    })
  }

  // 6. Проблемные советы (Батч D) — кнопка ведёт на экран, где чинят проблему.
  //    Тип 'problem' (см. hints.ts) — особые правила показа в triggers.ts.
  if (input.redZone) {
    hints.push({ id: 'red_zone', priority: 2, params: { block: input.redZoneBlock ?? null } })
  }
  if (input.clientsAtRisk && input.clientsAtRisk > 0) {
    hints.push({ id: 'clients_at_risk', priority: 2, params: { count: input.clientsAtRisk } })
  }
  if (input.pulseMissed) {
    hints.push({ id: 'pulse_missed', priority: 3 })
  }
  if (input.metricsEmpty) {
    hints.push({ id: 'empty_metrics', priority: 3 })
  }

  return hints
}
