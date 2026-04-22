import { describe, expect, it } from 'vitest'

import {
  surveyExtractor,
  extractQuarter,
  type SurveyAnswerRow,
} from '@/lib/ai/extractors/survey/survey-extractor'
import type { ExtractorContext } from '@/lib/ai/extractors/types'

const ctx: ExtractorContext = {
  userId: 'user-1',
  companyId: 'company-1',
  runId: 'run-1',
  vertical: 'generic',
}

function row(key: string, value: unknown, step = 2): SurveyAnswerRow {
  return { question_key: key, answer: { value }, step }
}

describe('surveyExtractor', () => {
  it('extracts revenue with period from s2_revenue_2024', async () => {
    const entities = await surveyExtractor.extract(
      [row('s2_revenue_2024', 10_000_000)],
      ctx
    )
    expect(entities).toHaveLength(1)
    expect(entities[0]).toMatchObject({
      entity_type: 'metric.revenue',
      value: 10_000_000,
      unit: 'KZT',
      period_year: 2024,
      source_type: 'survey',
    })
  })

  it('extracts multiple years as separate entities', async () => {
    const entities = await surveyExtractor.extract(
      [
        row('s2_revenue_2023', 5_000_000),
        row('s2_revenue_2024', 10_000_000),
        row('s2_revenue_2025', 15_000_000),
      ],
      ctx
    )
    expect(entities).toHaveLength(3)
    expect(entities.map((e) => e.period_year).sort()).toEqual([2023, 2024, 2025])
  })

  it('coerces string numbers (millions suffix)', async () => {
    const entities = await surveyExtractor.extract(
      [row('s2_revenue_2024', '10.5 млн')],
      ctx
    )
    expect(entities[0].value).toBe(10_500_000)
  })

  it('skips unknown question keys silently', async () => {
    const entities = await surveyExtractor.extract(
      [row('s99_unknown', 42)],
      ctx
    )
    expect(entities).toHaveLength(0)
  })

  it('skips empty/null values', async () => {
    const entities = await surveyExtractor.extract(
      [
        row('s2_revenue_2024', null),
        row('s2_avg_check', ''),
        row('s2_cac', undefined),
      ],
      ctx
    )
    expect(entities).toHaveLength(0)
  })

  it('emits attribute for non-numeric fields', async () => {
    const entities = await surveyExtractor.extract(
      [row('s1_company_name', 'Sau Zhurek', 1)],
      ctx
    )
    expect(entities[0]).toMatchObject({
      entity_type: 'attribute.company_name',
      value: 'Sau Zhurek',
      source_type: 'survey',
    })
  })

  it('handles medical intake fields', async () => {
    const entities = await surveyExtractor.extract(
      [
        row('s1_clinic_name', 'Sau Zhurek', 1),
        row('s1_current_revenue', 10_000_000, 1),
        row('s1_target_revenue', 18_000_000, 1),
      ],
      ctx
    )
    expect(entities).toHaveLength(3)
    const revenues = entities.filter((e) => e.entity_type === 'metric.revenue_monthly')
    expect(revenues).toHaveLength(1)
    expect(revenues[0].value).toBe(10_000_000)
  })

  it('stamps extractor_name + version on every entity', async () => {
    const entities = await surveyExtractor.extract(
      [row('s2_avg_check', 50_000)],
      ctx
    )
    expect(entities[0].extractor_name).toBe('survey')
    expect(entities[0].extractor_version).toBe('1.0.0')
  })
})

describe('extractQuarter', () => {
  it('extracts quarter from key', () => {
    expect(extractQuarter('s2_revenue_2024_q3')).toBe('Q3')
    expect(extractQuarter('foo_Q1')).toBe('Q1')
  })

  it('returns undefined when absent', () => {
    expect(extractQuarter('s2_revenue_2024')).toBeUndefined()
  })
})
