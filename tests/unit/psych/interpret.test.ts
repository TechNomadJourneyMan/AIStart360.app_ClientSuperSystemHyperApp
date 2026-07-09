import { describe, it, expect } from 'vitest'
import { readStep10Signals, interpretStep10 } from '@/lib/psych/interpret'
import { PERSONA_IDS } from '@/lib/ai/personas/registry'

describe('readStep10Signals', () => {
  it('extracts delegation, hours, motivation and vision from s10_* answers', () => {
    const s = readStep10Signals({
      s10_delegation_ready: 3,
      s10_hours_on_ops: 55,
      s10_why_opened: 'Хочу свободы и дохода',
      s10_company_vision_2y: 'Лидер ниши',
    })
    expect(s.delegationReadiness).toBe(3)
    expect(s.hoursOnOps).toBe(55)
    expect(s.hasMotivation).toBe(true)
    expect(s.hasVision).toBe(true)
  })

  it('returns nulls / false for missing answers (never fabricates)', () => {
    const s = readStep10Signals({})
    expect(s.delegationReadiness).toBeNull()
    expect(s.hoursOnOps).toBeNull()
    expect(s.hasMotivation).toBe(false)
    expect(s.hasVision).toBe(false)
  })
})

describe('interpretStep10 — personalization from Step 10', () => {
  it('reads a high operational load as high stress → supportive coach + AI warning', () => {
    const p = interpretStep10({ s10_hours_on_ops: 60 })
    expect(p.tags).toContain('high_ops_load')
    expect(p.tone).toBe('supportive')
    expect(p.recommendedAgent).toBe('empathic_coach')
    expect(p.warningsForAi.join(' ')).toMatch(/нагруз|давлен/i)
  })

  it('reads low delegation readiness as resistance to delegating', () => {
    const p = interpretStep10({ s10_delegation_ready: 2 })
    expect(p.tags).toContain('low_delegation')
    expect(p.recommendedAgent).toBe('empathic_coach')
  })

  it('routes a healthy visionary to the growth strategist', () => {
    const p = interpretStep10({
      s10_delegation_ready: 8,
      s10_hours_on_ops: 20,
      s10_company_vision_5y: 'Выйти на 3 страны',
    })
    expect(p.recommendedAgent).toBe('growth_strategist')
    expect(p.tone).toBe('neutral')
  })

  it('defaults to the base persona and no warnings for an empty profile', () => {
    const p = interpretStep10({})
    expect(p.tags).toHaveLength(0)
    expect(p.recommendedAgent).toBe('gri_base')
    expect(p.tone).toBe('neutral')
    expect(p.warningsForAi).toHaveLength(0)
  })

  it('always recommends a real persona id', () => {
    for (const answers of [{}, { s10_hours_on_ops: 70 }, { s10_delegation_ready: 1 }, { s10_company_vision_2y: 'x' }]) {
      expect(PERSONA_IDS).toContain(interpretStep10(answers).recommendedAgent)
    }
  })
})
