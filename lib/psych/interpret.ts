/**
 * lib/psych/interpret.ts — base founder-profile interpretation from Step 10.
 *
 * Deterministic reading of the existing Step-10 questionnaire (s10_* survey
 * answers) into personalization tags + a recommended ГРИ persona, tone and
 * AI warnings. This is the MVP psych profile (spec 07 §1): a business/leadership
 * read, never a clinical one — it only surfaces behavioural signals the user
 * already stated. The richer mechanics (M1–M5) layer on later.
 *
 * Pure; the API layer persists the result (migration 047) with consent.
 */

const HIGH_OPS_HOURS = 50
const LOW_DELEGATION = 3

export interface Step10Signals {
  /** s10_delegation_ready, 1..10, or null. */
  delegationReadiness: number | null
  /** s10_hours_on_ops, hours/week, or null. */
  hoursOnOps: number | null
  hasMotivation: boolean
  hasVision: boolean
}

export interface PsychTags {
  tags: string[]
  /** Recommended persona id (always a real one from the registry). */
  recommendedAgent: string
  tone: 'supportive' | 'neutral' | 'direct'
  warningsForAi: string[]
}

function num(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string') {
    const n = Number(v.replace(/[^\d.-]/g, ''))
    return Number.isFinite(n) && v.trim() !== '' ? n : null
  }
  return null
}

function nonEmpty(v: unknown): boolean {
  return typeof v === 'string' && v.trim() !== ''
}

export function readStep10Signals(answers: Record<string, unknown>): Step10Signals {
  return {
    delegationReadiness: num(answers.s10_delegation_ready),
    hoursOnOps: num(answers.s10_hours_on_ops),
    hasMotivation: nonEmpty(answers.s10_why_opened),
    hasVision:
      nonEmpty(answers.s10_company_vision_2y) ||
      nonEmpty(answers.s10_company_vision_5y) ||
      nonEmpty(answers.s10_company_vision_10y),
  }
}

export function interpretStep10(answers: Record<string, unknown>): PsychTags {
  const s = readStep10Signals(answers)
  const tags: string[] = []
  const warningsForAi: string[] = []

  const highOps = s.hoursOnOps != null && s.hoursOnOps >= HIGH_OPS_HOURS
  const lowDelegation = s.delegationReadiness != null && s.delegationReadiness <= LOW_DELEGATION

  if (highOps) {
    tags.push('high_ops_load')
    warningsForAi.push('Высокая операционная нагрузка: избегать давления сроками, предлагать разгрузку.')
  }
  if (lowDelegation) {
    tags.push('low_delegation')
    warningsForAi.push('Есть сопротивление делегированию — советовать делегировать осторожно, маленькими шагами.')
  }
  if (s.hasMotivation && s.hasVision) tags.push('reflective')

  let recommendedAgent = 'gri_base'
  let tone: PsychTags['tone'] = 'neutral'

  if (highOps || lowDelegation) {
    recommendedAgent = 'empathic_coach'
    tone = 'supportive'
  } else if (s.hasVision) {
    recommendedAgent = 'growth_strategist'
  }

  return { tags, recommendedAgent, tone, warningsForAi }
}
