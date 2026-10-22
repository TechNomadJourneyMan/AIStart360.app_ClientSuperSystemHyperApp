/**
 * lib/survey/point-a-minimum.ts — «Минимум для Точки А: X из N» (survey audit
 * 2026-10-22, MVP item 5).
 *
 * Derived from the Point A v4 engine's own table of check inputs
 * (lib/point-a/v4/check-input-keys.ts), not from a hand-written list: N = the
 * checks that have at least one key of the current wizard. A check is closed
 * by the same rules as `isAnswered` (lib/point-a/v4/check-inputs.ts):
 *  • one of its keys is answered (`positive` keys only when > 0);
 *  • a form toggle check is closed once its step has any answer (an untouched
 *    toggle on a saved step is a deliberate «нет»).
 * One difference, on purpose: «Не знаю» closes the question here (the owner
 * cannot do better; it is listed as a blind spot), while the engine itself
 * scores it as «нет данных».
 *
 * Pure, browser-safe. The step lookup is passed in (lib/survey/steps.ts uses
 * this module, so it cannot be imported here).
 */
import { CHECK_INPUTS, type CheckInput } from '@/lib/point-a/v4/check-input-keys'
import { CHECK_LABELS } from '@/lib/point-a/v4/check-labels'
import { isUnknownAnswer, unwrapAnswer } from './answer-value'
import { isAnswerFilled } from './answer-filled'

export type StepOf = (key: string) => number | null

export interface MinimumCheck {
  block: string
  check: string
  label: string
  /** Wizard keys of the check (legacy keys dropped). */
  keys: string[]
  /** The step to open to answer it (its first wizard key). */
  step: number
  input: CheckInput
}

export interface PointAMinimum {
  answered: number
  total: number
  missing: Array<{ block: string; check: string; label: string; step: number }>
}

export function minimumChecks(stepOf: StepOf): MinimumCheck[] {
  const out: MinimumCheck[] = []
  for (const [block, checks] of Object.entries(CHECK_INPUTS)) {
    for (const [check, input] of Object.entries(checks ?? {})) {
      const keys = input.keys.filter((k) => stepOf(k) !== null)
      if (keys.length === 0) continue
      out.push({ block, check, label: CHECK_LABELS[check] ?? check, keys, step: stepOf(keys[0]) as number, input })
    }
  }
  return out
}

function keyAnswered(input: CheckInput, key: string, v: unknown): boolean {
  if (isUnknownAnswer(v)) return true
  if (!isAnswerFilled(v)) return false
  if (!(input.positive ?? []).includes(key)) return true
  const n = Number(unwrapAnswer(v))
  return !Number.isFinite(n) || n > 0
}

/** `answers` = flat question_key → value (marks kept). */
export function computePointAMinimum(answers: Readonly<Record<string, unknown>>, stepOf: StepOf): PointAMinimum {
  // Steps with a real answer (not «не знаю»): they close their toggle checks.
  const saved = new Set<number>()
  for (const [k, v] of Object.entries(answers)) {
    if (isUnknownAnswer(v) || !isAnswerFilled(v)) continue
    const s = stepOf(k)
    if (s !== null) saved.add(s)
  }
  const checks = minimumChecks(stepOf)
  const missing: PointAMinimum['missing'] = []
  let answered = 0
  for (const c of checks) {
    const done = c.keys.some((k) => keyAnswered(c.input, k, answers[k]))
      || (c.input.toggle === true && c.keys.some((k) => saved.has(stepOf(k) as number)))
    if (done) answered += 1
    else missing.push({ block: c.block, check: c.check, label: c.label, step: c.step })
  }
  return { answered, total: checks.length, missing }
}
