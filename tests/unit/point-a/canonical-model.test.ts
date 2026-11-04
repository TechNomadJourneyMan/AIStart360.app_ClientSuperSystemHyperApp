import { describe, expect, it } from 'vitest'
import {
  buildPointAPeriod,
  normalizePointAValue,
  normalizedValuesEqual,
} from '@/lib/point-a/model/normalization'
import {
  pointAFieldKeyForDocument,
  pointAFieldKeysForSurvey,
} from '@/lib/point-a/model/mapping'
import {
  pointASourcePriority,
  resolvePointACandidates,
} from '@/lib/point-a/model/resolution'
import type {
  PointAExtractionKind,
  PointAScenario,
  PointAValueRow,
  PointAValueStatus,
} from '@/lib/point-a/model/types'

function candidate(
  overrides: Partial<PointAValueRow> & Pick<PointAValueRow, 'id'>,
): PointAValueRow {
  const { id, ...rest } = overrides
  return {
    id,
    user_id: 'user-1',
    company_id: 'company-1',
    source_id: `source-${id}`,
    candidate_key: `candidate-${id}`,
    field_key: 'biz.finansy.vyruchka_god',
    raw_value: 100,
    normalized_value: 100,
    value_type: 'number',
    unit: '₸',
    currency: 'KZT',
    period_key: '2025',
    period_start: null,
    period_end: null,
    period_year: 2025,
    period_quarter: null,
    period_month: null,
    scenario: 'fact',
    extraction_kind: 'table',
    source_fragment: null,
    source_locator: null,
    confidence: 0.9,
    status: 'detected',
    confirmed_by: null,
    confirmed_at: null,
    created_at: '2026-07-25T10:00:00.000Z',
    updated_at: '2026-07-25T10:00:00.000Z',
    point_a_sources: null,
    ...rest,
  }
}

describe('canonical Point A normalization', () => {
  it('normalizes localized survey money and preserves aggregation metadata', () => {
    const value = normalizePointAValue('84,2 млн ₸', {
      period: '2025-Q1',
      context: 'Выручка факт',
    })

    expect(value).toMatchObject({
      rawValue: '84,2 млн ₸',
      normalizedValue: 84_200_000,
      valueType: 'number',
      currency: 'KZT',
      scenario: 'fact',
      validForAggregation: true,
      period: {
        key: '2025-Q1',
        year: 2025,
        quarter: 'Q1',
        month: null,
      },
    })
  })

  it('keeps percentage points as percentages rather than fractions', () => {
    expect(
      normalizePointAValue('52,3%', {
        periodYear: 2025,
      }),
    ).toMatchObject({
      normalizedValue: 52.3,
      valueType: 'number',
      unit: '%',
      validForAggregation: true,
    })
  })

  it.each([
    ['not-a-number', 'text', 'not-a-number'],
    [Number.NaN, 'text', Number.NaN],
    [Number.POSITIVE_INFINITY, 'text', Number.POSITIVE_INFINITY],
  ] as const)(
    'marks invalid numeric input %s as non-aggregatable',
    (raw, expectedType, normalized) => {
      const value = normalizePointAValue(raw, { unit: '₸' })

      expect(value.valueType).toBe(expectedType)
      expect(value.normalizedValue).toEqual(normalized)
      expect(value.validForAggregation).toBe(false)
    },
  )

  it('builds stable, distinct keys for year, quarter, month and date range periods', () => {
    expect(buildPointAPeriod({ period: '2025' }).key).toBe('2025')
    expect(buildPointAPeriod({ period: '2025-Q2' })).toMatchObject({
      key: '2025-Q2',
      year: 2025,
      quarter: 'Q2',
    })
    expect(buildPointAPeriod({ period: '2025-05' })).toMatchObject({
      key: '2025-05',
      year: 2025,
      quarter: 'Q2',
      month: 5,
    })
    expect(
      buildPointAPeriod({
        start: '2025-01-01',
        end: '2025-03-31',
      }).key,
    ).toBe('2025-01-01/2025-03-31')
  })

  it('keeps fact, plan and forecast as explicit independent dimensions', () => {
    const contexts: Array<[string, PointAScenario]> = [
      ['Фактическая выручка', 'fact'],
      ['План выручки', 'plan'],
      ['Revenue forecast', 'forecast'],
    ]

    const dimensions = contexts.map(([context, expectedScenario]) => {
      const value = normalizePointAValue(100, {
        context,
        period: '2025-Q4',
      })
      expect(value.scenario).toBe(expectedScenario)
      return `${value.period.key}:${value.scenario}`
    })

    expect(new Set(dimensions)).toEqual(
      new Set(['2025-Q4:fact', '2025-Q4:plan', '2025-Q4:forecast']),
    )
  })

  it('does not create false conflicts for insignificant numeric rounding noise', () => {
    expect(normalizedValuesEqual(1_000_000, 1_000_050)).toBe(true)
    expect(normalizedValuesEqual(1_000_000, 1_001_000)).toBe(false)
  })
})

describe('canonical Point A survey mapping', () => {
  it('maps registered survey keys to canonical metrics', () => {
    expect(pointAFieldKeysForSurvey('s2_revenue_2025')).toContain(
      'biz.finansy.vyruchka_god',
    )
  })

  it('keeps unmapped survey answers in the survey namespace', () => {
    expect(pointAFieldKeysForSurvey('custom_unmapped_answer')).toEqual([
      'survey.custom_unmapped_answer',
    ])
  })

  it('does not reintroduce fields removed from the survey', () => {
    expect(pointAFieldKeysForSurvey('s1_business_model')).toEqual([])
    expect(pointAFieldKeysForSurvey('s6_expectations')).toEqual([])
  })

  it('maps Russian document labels to the same source-independent field as the survey', () => {
    expect(pointAFieldKeysForSurvey('s1_company_name')).toEqual(['company.name'])
    expect(pointAFieldKeyForDocument({
      key: 'company_title',
      label: 'Название компании',
    })).toBe('company.name')
    expect(pointAFieldKeyForDocument({
      key: 'business_model',
      label: 'Бизнес-модель',
    })).toBe('company.business_model')
    expect(pointAFieldKeyForDocument({
      key: 'owner_readiness',
      label: 'Готовность собственника',
    })).toBe('owner.readiness')
    expect(pointAFieldKeyForDocument({
      key: 'revenue_total',
      label: 'Total revenue',
    })).toBe('biz.finansy.vyruchka_god')
    expect(pointAFieldKeyForDocument({
      key: 'total_expenses',
      label: 'Общие расходы',
    })).toBe('finance.total_expenses')
  })
})

describe('canonical Point A candidate resolution', () => {
  it('resolves a single survey candidate', () => {
    const survey = candidate({
      id: 'survey',
      extraction_kind: 'survey',
      normalized_value: 84_200_000,
      confidence: 0.9,
    })

    expect(resolvePointACandidates([survey])).toEqual({
      selected: survey,
      status: 'resolved',
      candidates: [survey],
      conflictValueIds: [],
    })
  })

  it('selects manual input over a higher-confidence survey value', () => {
    const survey = candidate({
      id: 'survey',
      extraction_kind: 'survey',
      normalized_value: 84_200_000,
      confidence: 0.99,
    })
    const manual = candidate({
      id: 'manual',
      extraction_kind: 'manual',
      normalized_value: 85_000_000,
      confidence: 0.7,
    })

    const decision = resolvePointACandidates([survey, manual])

    expect(decision.selected?.id).toBe('manual')
    expect(decision.status).toBe('conflict')
    expect(decision.conflictValueIds).toEqual(['survey'])
  })

  it('surfaces two disagreeing documents as a conflict with both candidates', () => {
    const firstDocument = candidate({
      id: 'document-a',
      source_id: 'source-document-a',
      normalized_value: 84_200_000,
      extraction_kind: 'table',
      confidence: 0.93,
      source_fragment: 'Выручка: 84 200 000',
    })
    const secondDocument = candidate({
      id: 'document-b',
      source_id: 'source-document-b',
      normalized_value: 79_000_000,
      extraction_kind: 'table',
      confidence: 0.88,
      source_fragment: 'Выручка: 79 000 000',
    })

    const decision = resolvePointACandidates([
      secondDocument,
      firstDocument,
    ])

    expect(decision.status).toBe('conflict')
    expect(decision.selected?.id).toBe('document-a')
    expect(decision.candidates.map((row) => row.id)).toEqual([
      'document-a',
      'document-b',
    ])
    expect(decision.conflictValueIds).toEqual(['document-b'])
  })

  it.each([
    ['confirmed extraction', 'confirmed', 'detected'],
    ['confirmed status', 'table', 'confirmed'],
  ] as Array<[string, PointAExtractionKind, PointAValueStatus]>)(
    'treats %s as an explicit decision that resolves disagreement',
    (_label, extractionKind, status) => {
      const confirmed = candidate({
        id: 'confirmed',
        extraction_kind: extractionKind,
        status,
        normalized_value: 79_000_000,
        confidence: 0.5,
        confirmed_by: 'expert-1',
        confirmed_at: '2026-07-25T11:00:00.000Z',
      })
      const automatic = candidate({
        id: 'automatic',
        extraction_kind: 'table',
        normalized_value: 84_200_000,
        confidence: 0.99,
      })

      const decision = resolvePointACandidates([automatic, confirmed])

      expect(decision.selected?.id).toBe('confirmed')
      expect(decision.status).toBe('resolved')
      expect(decision.conflictValueIds).toEqual(['automatic'])
    },
  )

  it('requires confirmation for a lone low-confidence automatic value', () => {
    const lowConfidence = candidate({
      id: 'low-confidence',
      extraction_kind: 'ocr',
      confidence: 0.64,
    })

    const decision = resolvePointACandidates([lowConfidence])

    expect(decision.selected?.id).toBe('low-confidence')
    expect(decision.status).toBe('needs_confirmation')
  })

  it('requires confirmation when status says so even above the confidence threshold', () => {
    const candidateNeedingConfirmation = candidate({
      id: 'needs-confirmation',
      confidence: 0.99,
      status: 'needs_confirmation',
    })

    expect(
      resolvePointACandidates([candidateNeedingConfirmation]).status,
    ).toBe('needs_confirmation')
  })

  it('orders extraction kinds according to the canonical source priority', () => {
    expect(pointASourcePriority('confirmed')).toBeGreaterThan(
      pointASourcePriority('manual'),
    )
    expect(pointASourcePriority('manual')).toBeGreaterThan(
      pointASourcePriority('survey'),
    )
    expect(pointASourcePriority('survey')).toBeGreaterThan(
      pointASourcePriority('table'),
    )
    expect(pointASourcePriority('table')).toBeGreaterThan(
      pointASourcePriority('text'),
    )
    expect(pointASourcePriority('text')).toBeGreaterThan(
      pointASourcePriority('ocr'),
    )
    expect(pointASourcePriority('ocr')).toBeGreaterThan(
      pointASourcePriority('inferred'),
    )
  })

  it('does not let rejected, superseded or retracted candidates participate', () => {
    const activeSurvey = candidate({
      id: 'active',
      extraction_kind: 'survey',
      normalized_value: 100,
    })
    const inactive = (['rejected', 'superseded', 'retracted'] as const).map(
      (status, index) =>
        candidate({
          id: status,
          extraction_kind: 'confirmed',
          normalized_value: 200 + index,
          status,
        }),
    )

    const decision = resolvePointACandidates([...inactive, activeSurvey])

    expect(decision.selected?.id).toBe('active')
    expect(decision.candidates.map((row) => row.id)).toEqual(['active'])
    expect(decision.conflictValueIds).toEqual([])
  })
})
