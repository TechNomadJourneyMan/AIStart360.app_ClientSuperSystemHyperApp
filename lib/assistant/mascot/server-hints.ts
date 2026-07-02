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

  return hints
}
