import { describe, it, expect } from 'vitest'
import {
  getPersona,
  listPersonas,
  listAvailablePersonas,
  personaBlock,
  DEFAULT_PERSONA_ID,
  PERSONA_IDS,
} from '@/lib/ai/personas/registry'

describe('persona registry — integrity', () => {
  it('defines all 8 personas with unique ids', () => {
    expect(PERSONA_IDS).toHaveLength(8)
    expect(new Set(PERSONA_IDS).size).toBe(8)
    expect(PERSONA_IDS).toContain('gri_base')
  })

  it('every persona is fully specified (no empty load-bearing fields)', () => {
    for (const p of listPersonas()) {
      expect(p.id).toBeTruthy()
      expect(p.name.length).toBeGreaterThan(0)
      expect(p.shortDescription.length).toBeGreaterThan(0)
      expect(p.promptBlock.length).toBeGreaterThan(40)
      expect(p.strengths.length).toBeGreaterThan(0)
      expect(p.safetyRules.length).toBeGreaterThan(0)
      expect(p.intakeRules.length).toBeGreaterThan(0)
      expect(['low', 'medium', 'high']).toContain(p.riskAppetite)
      expect(['low', 'medium', 'high']).toContain(p.empathy)
      expect(['free', 'pro']).toContain(p.tier)
    }
  })
})

describe('persona registry — lookup & fallback', () => {
  it('returns the requested persona', () => {
    expect(getPersona('growth_strategist').id).toBe('growth_strategist')
  })

  it('falls back to the base persona for an unknown id (test #2)', () => {
    expect(getPersona('nope_not_real').id).toBe(DEFAULT_PERSONA_ID)
    expect(DEFAULT_PERSONA_ID).toBe('gri_base')
  })

  it('falls back to base for undefined/empty', () => {
    expect(getPersona(undefined).id).toBe('gri_base')
    expect(getPersona('').id).toBe('gri_base')
  })
})

describe('persona registry — tariff gating', () => {
  it('free tier exposes exactly the 3 MVP personas, including the base', () => {
    const free = listAvailablePersonas('free').map((p) => p.id)
    expect(free).toContain('gri_base')
    expect(free).toContain('careful_analyst')
    expect(free).toContain('growth_strategist')
    expect(free).toHaveLength(3)
  })

  it('pro tier exposes all 8', () => {
    expect(listAvailablePersonas('pro')).toHaveLength(8)
  })
})

describe('persona registry — prompt block', () => {
  it('personaBlock returns the persona system-prompt fragment', () => {
    const block = personaBlock('crisis_operator')
    expect(block).toContain('Режим')
    expect(block.length).toBeGreaterThan(40)
  })

  it('personaBlock for an unknown id yields the base persona block', () => {
    expect(personaBlock('bogus')).toBe(personaBlock('gri_base'))
  })
})
