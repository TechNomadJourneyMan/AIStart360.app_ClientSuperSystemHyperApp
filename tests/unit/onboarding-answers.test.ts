import { describe, expect, it } from 'vitest'
import {
  mergeSurveyAnswerSources,
  normalizeSurveyAnswers,
} from '@/components/onboarding/utils/answers'
import { SECTION_FIELD_MAP } from '@/lib/assistant/sections'
import { getStepFromKey, SURVEY_LABELS } from '@/lib/survey-labels'

describe('normalizeSurveyAnswers', () => {
  it('accepts flat and wrapped backend values', () => {
    expect(normalizeSurveyAnswers({
      s1_company_name: 'Acme',
      s2n_goal_12m_what: { value: 'Вырасти вдвое' },
      s9n_revenue_2024: { value: { value: 42_000_000 } },
    })).toEqual({
      s1_company_name: 'Acme',
      s2n_goal_12m_what: 'Вырасти вдвое',
      s9n_revenue_2024: 42_000_000,
    })
  })

  it('removes retired questions from old drafts and backend snapshots', () => {
    expect(normalizeSurveyAnswers({
      s1_business_model: 'b2b',
      s6_expectations: 'Автоматизация',
      s10_delegation_ready: 8,
    })).toEqual({
      s10_delegation_ready: 8,
    })
  })

  it('keeps manual local values while adding new backend-prefilled fields', () => {
    expect(mergeSurveyAnswerSources(
      {
        s1_company_name: 'Backend name',
        s9n_revenue_2024: { value: 42_000_000 },
      },
      {
        s1_company_name: 'Manual name',
      },
    )).toEqual({
      s1_company_name: 'Manual name',
      s9n_revenue_2024: 42_000_000,
    })
  })
})

describe('getStepFromKey', () => {
  it('recognizes current survey key variants', () => {
    expect(getStepFromKey('s2n_goal_12m_what')).toBe(2)
    expect(getStepFromKey('s4m_delegation_readiness')).toBe(4)
    expect(getStepFromKey('s10_delegation_ready')).toBe(10)
  })
})

describe('survey configuration', () => {
  it('does not expose retired questions', () => {
    expect(SURVEY_LABELS).not.toHaveProperty('s1_business_model')
    expect(SURVEY_LABELS).not.toHaveProperty('s6_expectations')

    const progressKeys = SECTION_FIELD_MAP.flatMap((section) => [
      ...section.required,
      ...section.recommended,
    ]).map((field) => field.key)

    expect(progressKeys).not.toContain('s1_business_model')
    expect(progressKeys).not.toContain('s6_expectations')
    expect(SECTION_FIELD_MAP.find((section) => section.step === 10)?.label)
      .toBe('Готовность собственника')
  })
})
