/**
 * lib/point-b/plan/status.ts — the state machine of a plan version and the
 * approval conditions. Pure functions, no IO: the store (store.ts) applies them
 * and writes with conditional UPDATEs.
 *
 *   draft ──submit──▶ in_review ──approve──▶ approved ──supersede──▶ superseded
 *     ▲                   │
 *     └──────reject───────┘   (the reason stays on the row; there is no «rejected» status)
 */
import type { GoalReviewStatus, PlanGoalsSnapshot, PlanVersionStatus } from './types'

export type Transition = 'submit' | 'approve' | 'reject' | 'supersede'

const NEXT: Readonly<Record<PlanVersionStatus, Partial<Record<Transition, PlanVersionStatus>>>> = {
  draft: { submit: 'in_review' },
  in_review: { approve: 'approved', reject: 'draft' },
  approved: { supersede: 'superseded' },
  superseded: {},
}

export function canTransition(from: PlanVersionStatus, t: Transition): boolean {
  return NEXT[from]?.[t] !== undefined
}

/** The status a transition leads to, or null when it is not allowed. */
export function nextStatus(from: PlanVersionStatus, t: Transition): PlanVersionStatus | null {
  return NEXT[from]?.[t] ?? null
}

/** Only a draft can be edited; in_review, approved and superseded are frozen. */
export function isEditable(status: PlanVersionStatus): boolean {
  return status === 'draft'
}

export const EXCEPTION_REASON_MIN = 10

export type ApprovalCheck = { ok: true; exception: boolean } | { ok: false; reasons: string[] }

export const REASON_NO_PRIMARY_GOAL = 'Не задана главная цель'
export const REASON_PRIMARY_NOT_VERIFIED = 'Главная цель не проверена экспертом'
export const REASON_NO_CHANGE_REASON = 'Не указана причина изменений'
export const REASON_EXCEPTION_TOO_SHORT = `Причина исключения должна быть не короче ${EXCEPTION_REASON_MIN} символов`
/** R3 (решение PO): план без рассчитанных сценариев и выбранного темпа не публикуется — исключением это не обходится. */
export const REASON_NO_SCENARIOS = 'Сценарии не рассчитаны — рассчитайте их в черновике'
export const REASON_NO_PACE = 'Не выбран темп плана — выберите один из рассчитанных сценариев'

const SCENARIO_KEYS: readonly string[] = ['cautious', 'moderate', 'aggressive']

/** The keys of the scenarios stored in a version (ScenarioResult objects with a known key). */
export function calculatedScenarioKeys(scenarios: unknown): string[] {
  if (!Array.isArray(scenarios)) return []
  return scenarios
    .map((s) => (s && typeof s === 'object' ? (s as { key?: unknown }).key : null))
    .filter((k): k is string => typeof k === 'string' && SCENARIO_KEYS.includes(k))
}

const PASSING: readonly GoalReviewStatus[] = ['verified', 'agreed']

/** Normalised exception reason, or null when it is empty or too short. */
export function validExceptionReason(reason: string | null | undefined): string | null {
  const r = typeof reason === 'string' ? reason.trim() : ''
  return r.length >= EXCEPTION_REASON_MIN ? r : null
}

/**
 * Conditions of in_review → approved (spec §6):
 *  - the primary goal is set and verified / agreed by the owner;
 *  - the version states why it changes (changeReason);
 *  - R3 (PO): the scenarios of the model are calculated and the pace is chosen among them.
 * An Admin may approve with an exception when the GOAL condition fails: the
 * exception reason (≥ 10 characters) is stored on the version and in the audit.
 * A missing change reason, scenarios or pace cannot be waived by an exception.
 */
export function checkApprovalConditions(
  v: { goals: PlanGoalsSnapshot; changeReason: string | null; scenarios: unknown; selectedScenario: string | null },
  opts: { exceptionReason?: string | null } = {},
): ApprovalCheck {
  const reasons: string[] = []

  let goalFailure: string | null = null
  const primary = v.goals?.primary ?? null
  if (!primary) {
    goalFailure = REASON_NO_PRIMARY_GOAL
  } else {
    const item = (v.goals.items ?? []).find((i) => i.metricKey === primary.metricKey && i.periodLabel === primary.periodLabel)
    if (!item || !PASSING.includes(item.reviewStatus)) goalFailure = REASON_PRIMARY_NOT_VERIFIED
  }

  let exception = false
  if (goalFailure) {
    if (validExceptionReason(opts.exceptionReason)) exception = true
    else {
      reasons.push(goalFailure)
      if (typeof opts.exceptionReason === 'string' && opts.exceptionReason.trim()) reasons.push(REASON_EXCEPTION_TOO_SHORT)
    }
  }

  if (!v.changeReason || !v.changeReason.trim()) reasons.push(REASON_NO_CHANGE_REASON)

  const keys = calculatedScenarioKeys(v.scenarios)
  if (!keys.length) reasons.push(REASON_NO_SCENARIOS)
  else if (!v.selectedScenario || !keys.includes(v.selectedScenario)) reasons.push(REASON_NO_PACE)

  return reasons.length ? { ok: false, reasons } : { ok: true, exception }
}
