/**
 * lib/point-a/v4/check-inputs.ts — was a check of Point A answered at all?
 *
 * v1 scores an unanswered question as 0 («тихий ноль»): a yes/no toggle
 * that was never touched reads as «нет», an empty budget as 0 %. v4 separates
 * «answered badly» from «not answered»:
 *
 *   • a check with `missing` set is not answered;
 *   • a check listed below is answered when one of its keys was answered —
 *     or, for a form toggle (`toggle`), when the owner saved the step it is
 *     on (an untouched toggle on a saved step is a deliberate «нет»);
 *   • any other check is answered when it earned points or found an issue.
 */
import { present, type PointACheck, type PointAResolvedInputs } from '@/lib/point-a-engine'
import { stepForQuestionKey } from '@/lib/survey/steps'
import type { BlockKey } from './config'

import { CHECK_INPUTS } from './check-input-keys'

export { CHECK_INPUTS, type CheckInput } from './check-input-keys'

/** Steps (1..12) the owner saved at least one answer of. */
export function answeredSteps(answers: Record<string, unknown>): Set<number> {
  const steps = new Set<number>()
  for (const [k, v] of Object.entries(answers)) {
    if (!present(v)) continue
    const s = stepForQuestionKey(k)
    if (s !== null) steps.add(s)
  }
  return steps
}

export function isAnswered(
  block: BlockKey,
  check: PointACheck,
  answers: Record<string, unknown>,
  steps: ReadonlySet<number>,
  resolved: PointAResolvedInputs = {},
): boolean {
  if (check.excluded) return false
  if (check.missing) return false
  const input = CHECK_INPUTS[block]?.[check.id]
  if (!input) return check.earned > 0 || Boolean(check.issue)
  if (input.resolved?.some((k) => resolved[k] !== null && resolved[k] !== undefined)) return true
  const positive = new Set(input.positive ?? [])
  const answered = (k: string) => {
    if (!present(answers[k])) return false
    if (!positive.has(k)) return true
    const n = Number(answers[k])
    return !Number.isFinite(n) || n > 0
  }
  if (input.keys.some(answered)) return true
  if (input.toggle) return input.keys.some((k) => {
    const s = stepForQuestionKey(k)
    return s !== null && steps.has(s)
  })
  // revenue_trend and the like: answered when the check found something.
  return input.keys.length === 0 && (check.earned > 0 || Boolean(check.issue))
}

export { CHECK_LABELS } from './check-labels'
