import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createEmptyJourneyState, deterministicOrchestrator } from '@/lib/journey/demo'

const structuredAi = vi.hoisted(() => ({
  generate: vi.fn(),
}))

vi.mock('@/lib/ai/structured', () => ({
  hasOpenRouterKey: () => true,
  generateObjectViaOpenRouter: structuredAi.generate,
}))

import { orchestrateJourneyTurn } from '@/lib/journey/orchestrator'

describe('Journey live-orchestrator safety fallback', () => {
  beforeEach(() => {
    structuredAi.generate.mockReset()
  })

  it('falls back deterministically when an otherwise valid AI update cites missing evidence', async () => {
    const current = deterministicOrchestrator(
      createEmptyJourneyState('journey-invalid-live-evidence'),
      'Мы продаём консультации компаниям',
      'test fixture',
    )
    const crm = current.widgets.find((widget) => widget.kind === 'crm_readiness')
    if (!crm || crm.kind !== 'crm_readiness') throw new Error('CRM fixture missing')

    structuredAi.generate.mockResolvedValue({
      phase: 'partial',
      assistantMessage: 'Обновил приоритеты.',
      facts: [],
      goals: [],
      roadmap: [],
      widgets: [crm],
      widgetDecisions: [{
        widgetId: crm.id,
        kind: crm.kind,
        action: 'keep',
        reason: 'Уверенное объяснение без реального подтверждения.',
        evidenceFactIds: ['fact-that-does-not-exist'],
      }],
      suggestions: [],
    })

    const result = await orchestrateJourneyTurn(current, 'Что делать дальше?')

    expect(result.mode).toBe('demo')
    expect(result.fallbackReason).toBe('invalid_ai_response')
    expect(result.state.provider.mode).toBe('demo')
    expect(
      result.state.widgetDecisions?.some((decision) =>
        decision.evidenceFactIds.includes('fact-that-does-not-exist'),
      ) ?? false,
    ).toBe(false)
  })
})
