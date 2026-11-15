/**
 * Ревью R3-PA M3: the model stages of the diagnostic pipeline («Гипотезы ИИ»,
 * «Рекомендации») on an AUTOMATIC run (after every written Point A since the
 * B2 fix) call the model only for an owner whose Точка А is open, only with an
 * official score, at most every 6 h per company. A manual run by staff — as before.
 */
import { describe, expect, it } from 'vitest'
import { AUTO_LLM_MIN_INTERVAL_MS, llmGateDecision } from '@/lib/diagnostics/llm-gate'
import { pipelineTriggerOf } from '@/lib/point-a/diagnostic-row'

const now = new Date('2026-11-15T12:00:00Z')
const base = { trigger: 'event', officialState: 'scored', ownerPaid: true, lastModelRunAt: null, now }

describe('llmGateDecision', () => {
  it('automatic: Free → no; preliminary / no score → no; a model call < 6 h ago → no; otherwise yes', () => {
    expect(llmGateDecision(base)).toEqual({ allowed: true })
    expect(llmGateDecision({ ...base, ownerPaid: false })).toEqual({ allowed: false, reason: 'free' })
    expect(llmGateDecision({ ...base, officialState: 'preliminary' })).toEqual({ allowed: false, reason: 'no_score' })
    expect(llmGateDecision({ ...base, officialState: null })).toEqual({ allowed: false, reason: 'no_score' })
    expect(llmGateDecision({ ...base, lastModelRunAt: new Date(now.getTime() - 60 * 60_000) })).toEqual({ allowed: false, reason: 'interval' })
    expect(llmGateDecision({ ...base, lastModelRunAt: new Date(now.getTime() - AUTO_LLM_MIN_INTERVAL_MS - 1) })).toEqual({ allowed: true })
    for (const trigger of ['schedule', 'agent']) expect(llmGateDecision({ ...base, trigger, ownerPaid: false }).allowed).toBe(false)
  })

  it('a manual run by staff: as before, whatever the plan / score / interval', () => {
    expect(llmGateDecision({ ...base, trigger: 'manual', ownerPaid: false, officialState: null, lastModelRunAt: now })).toEqual({ allowed: true })
  })

  it('which recalculation is «manual» for the pipeline: only staff in GIGA (expert); the owner\'s «Обновить» is automatic', () => {
    expect(pipelineTriggerOf('expert')).toBe('manual')
    expect(pipelineTriggerOf('manual')).toBe('event')
    expect(pipelineTriggerOf('event')).toBe('event')
    expect(pipelineTriggerOf('schedule')).toBe('schedule')
  })
})
