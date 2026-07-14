import { describe, expect, it } from 'vitest'
import { preserveUserWidgetState } from '@/components/journey/widget-state'
import { createEmptyJourneyState, deterministicOrchestrator } from '@/lib/journey/demo'
import { journeyStateSchema } from '@/lib/journey/schema'

function insuranceTransition() {
  const generic = deterministicOrchestrator(
    createEmptyJourneyState('journey-widget-state-test'),
    'Мы продаём консультации компаниям',
    'test fallback',
  )
  const confirmed = journeyStateSchema.parse({
    ...generic,
    facts: generic.facts.map((fact) => ({ ...fact, status: 'confirmed' })),
  })
  return {
    generic: confirmed,
    insurance: deterministicOrchestrator(
      confirmed,
      'Хочу увеличить renewal rate до 75% за 12 месяцев',
      'test fallback',
    ),
  }
}

describe('Journey client widget lifecycle reconciliation', () => {
  it('keeps an explicit AI retirement after applying user layout state', () => {
    const { generic, insurance } = insuranceTransition()
    const reconciled = preserveUserWidgetState(insurance, generic)

    expect(reconciled.widgets.find((widget) => widget.kind === 'crm_readiness')?.hidden).toBe(true)
  })

  it('does not retire a manually positioned widget and preserves user-hidden modules', () => {
    const { generic, insurance } = insuranceTransition()
    const crm = generic.widgets.find((widget) => widget.kind === 'crm_readiness')
    expect(crm).toBeDefined()

    const manual = journeyStateSchema.parse({ ...generic, manualWidgetIds: [crm!.id] })
    expect(
      preserveUserWidgetState(insurance, manual).widgets.find(
        (widget) => widget.kind === 'crm_readiness',
      )?.hidden,
    ).toBe(false)

    const userHidden = journeyStateSchema.parse({
      ...generic,
      widgets: generic.widgets.map((widget) =>
        widget.kind === 'business_passport' ? { ...widget, hidden: true } : widget,
      ),
    })
    expect(
      preserveUserWidgetState(insurance, userHidden).widgets.find(
        (widget) => widget.kind === 'business_passport',
      )?.hidden,
    ).toBe(true)
  })
})
