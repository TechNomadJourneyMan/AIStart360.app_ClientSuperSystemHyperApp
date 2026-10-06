/**
 * diagnostics.ai_analysis vs ai_narrative (lib/point-a/ai-analysis.ts,
 * migration 091): the two shapes are told apart, legacy rows stay readable,
 * and a rewrite of the analysis keeps keys other writers own.
 */
import { describe, expect, it } from 'vitest'
import {
  foreignAnalysisKeys, isAIAnalysis, isPointANarrative, mergeAiAnalysis, readAiAnalysis, readNarrative, withReadableAiAnalysis,
} from '@/lib/point-a/ai-analysis'
import type { AIAnalysis } from '@/types/onboarding'

const ANALYSIS: AIAnalysis = {
  executive_summary: 'Бизнес растёт, продажи держатся на собственнике.',
  blocks: { sales: { diagnosis: 'Нет CRM', benchmark_comparison: 'ниже рынка', key_risk: 'зависимость', top_recommendation: 'CRM' } },
  strategic_priorities: [{ title: 'CRM', rationale: 'учёт', expected_impact: '+10%' }],
  growth_roadmap: [{ horizon: '30_days', actions: ['Внедрить CRM'] }],
  industry_context: 'Розница',
  model_used: 'anthropic/claude-sonnet-4.5',
  generated_at: '2026-10-05T12:00:00.000Z',
}

const NARRATIVE = {
  executive_summary: 'Кратко о бизнесе',
  strengths_text: 'Сильные стороны',
  weaknesses_text: 'Слабые стороны',
  risks_text: 'Риски',
  opportunities_text: 'Возможности',
  next_steps: ['Шаг 1', 'Шаг 2', 'Шаг 3'],
  model_used: 'anthropic/claude-sonnet-4.5',
  generated_at: '2026-10-05T12:00:00.000Z',
}

describe('shape guards', () => {
  it('tells an analysis from a narrative (both have executive_summary)', () => {
    expect(isAIAnalysis(ANALYSIS)).toBe(true)
    expect(isPointANarrative(ANALYSIS)).toBe(false)
    expect(isPointANarrative(NARRATIVE)).toBe(true)
    expect(isAIAnalysis(NARRATIVE)).toBe(false)
    for (const v of [null, undefined, 'x', 1, [], {}]) {
      expect(isAIAnalysis(v)).toBe(false)
      expect(isPointANarrative(v)).toBe(false)
    }
  })

  it('an analysis with foreign keys is still an analysis; foreign keys alone are not', () => {
    expect(isAIAnalysis({ ...ANALYSIS, gri: { overall: 6 } })).toBe(true)
    expect(isAIAnalysis({ gri: { overall: 6 }, pulse: { avgCheck: 1 } })).toBe(false)
  })
})

describe('readers keep old rows readable', () => {
  it('readAiAnalysis drops a narrative written into ai_analysis before 091', () => {
    expect(readAiAnalysis(ANALYSIS)).toBe(ANALYSIS)
    expect(readAiAnalysis(NARRATIVE)).toBeNull()
    expect(readAiAnalysis(null)).toBeNull()
    expect(withReadableAiAnalysis({ id: 'd', ai_analysis: NARRATIVE })).toEqual({ id: 'd', ai_analysis: null })
  })

  it('readNarrative prefers the own column and falls back to a legacy narrative in ai_analysis', () => {
    const own = { ...NARRATIVE, executive_summary: 'из колонки' }
    expect(readNarrative({ ai_narrative: own, ai_analysis: NARRATIVE })).toBe(own)
    expect(readNarrative({ ai_narrative: null, ai_analysis: NARRATIVE })).toBe(NARRATIVE)
    expect(readNarrative({ ai_analysis: ANALYSIS })).toBeNull() // an analysis is never served as a narrative
    expect(readNarrative(null)).toBeNull()
  })
})

describe('mergeAiAnalysis', () => {
  it('keeps keys other writers own (gri, pulse) and replaces the analysis', () => {
    const existing = { executive_summary: 'старое', blocks: {}, gri: { overall: 6.4, categoryScores: { Team: 7 } }, pulse: { avgCheck: 12000 } }
    const merged = mergeAiAnalysis(existing, ANALYSIS)
    expect(merged).toEqual({ ...ANALYSIS, gri: existing.gri, pulse: existing.pulse })
    expect(foreignAnalysisKeys(existing)).toEqual({ gri: existing.gri, pulse: existing.pulse })
  })

  it('does not carry a legacy narrative into the analysis', () => {
    const merged = mergeAiAnalysis(NARRATIVE, ANALYSIS)
    expect(merged).toEqual(ANALYSIS)
    expect(isAIAnalysis(merged)).toBe(true)
  })

  it('works on an empty row', () => {
    expect(mergeAiAnalysis(null, ANALYSIS)).toEqual(ANALYSIS)
  })
})
