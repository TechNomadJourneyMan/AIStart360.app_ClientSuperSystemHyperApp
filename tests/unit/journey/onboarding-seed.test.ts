import { describe, expect, it } from 'vitest'
import profile from '@/lib/demo/myhonor-public-profile.json'
import {
  buildJourneyStateFromOnboarding,
  type JourneyOnboardingSurveyRow,
} from '@/lib/journey/onboarding-seed'
import { journeyStateSchema } from '@/lib/journey/schema'

const NOW = '2026-07-29T00:00:00.000Z'

function honorRows(): JourneyOnboardingSurveyRow[] {
  return profile.surveyAnswers.map((item) => ({
    question_key: item.key,
    answer: {
      value: item.value,
      provenance: 'public_web',
      source: profile.website,
    },
  }))
}

describe('authenticated Journey onboarding seed', () => {
  it('imports MyHonor public facts without importing the demo goal', () => {
    const state = buildJourneyStateFromOnboarding({
      workspaceId: 'journey-user-honor-test',
      company: {
        name: profile.companyName,
        industry: 'Ритейл / E-commerce',
        business_model: 'Собственное производство + D2C + офлайн-розница + B2B',
      },
      surveyRows: honorRows(),
      now: NOW,
    })

    expect(journeyStateSchema.safeParse(state).success).toBe(true)
    expect(state.companyName).toBe('HONOR GROUP')
    expect(state.facts).toHaveLength(11)
    expect(state.facts).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'fact:survey:ec_total_sku',
        label: 'Товаров в каталоге',
        value: '88',
        status: 'confirmed',
      }),
    ]))
    expect(state.goals).toEqual([])
    expect(state.roadmap).toEqual([])
    expect(JSON.stringify(state)).not.toContain(profile.testGoal)
    expect(JSON.stringify(state)).not.toContain('20%')
  })

  it('keeps private commerce KPIs explicitly unknown', () => {
    const state = buildJourneyStateFromOnboarding({
      workspaceId: 'journey-user-honor-metrics',
      surveyRows: honorRows(),
      now: NOW,
    })
    const widget = state.widgets.find((item) => item.kind === 'domain_metrics')
    expect(widget?.kind).toBe('domain_metrics')
    if (!widget || widget.kind !== 'domain_metrics') throw new Error('domain widget missing')
    expect(widget.data.metrics.map((metric) => metric.label)).toEqual([
      'Выручка',
      'Валовая маржа',
      'Средний чек',
      'Конверсия заказа',
      'Доля отсутствующих товаров',
      'Оборачиваемость запасов',
    ])
    expect(widget.data.metrics.every((metric) => (
      metric.status === 'unknown' && metric.value === undefined
    ))).toBe(true)
  })

  it('uses stable fact identifiers and skips unapproved personal fields', () => {
    const input = {
      workspaceId: 'journey-user-stable-seed',
      surveyRows: [
        ...honorRows(),
        { question_key: 's1_contact_phone', answer: { value: '+7 700 000 00 00' } },
        { question_key: 's10_owner_fears', answer: { value: 'private' } },
      ],
      now: NOW,
    }
    const first = buildJourneyStateFromOnboarding(input)
    const second = buildJourneyStateFromOnboarding(input)
    expect(first.facts.map((fact) => fact.id)).toEqual(second.facts.map((fact) => fact.id))
    expect(JSON.stringify(first)).not.toContain('+7 700')
    expect(JSON.stringify(first)).not.toContain('private')
  })
})
