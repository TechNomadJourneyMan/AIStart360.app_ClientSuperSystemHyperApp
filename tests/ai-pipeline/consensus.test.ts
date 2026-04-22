import { describe, expect, it } from 'vitest'

import {
  resolveConsensus,
  winnersToMetrics,
  type PersistedExtraction,
} from '@/lib/ai/consensus'

function mkExtraction(
  overrides: Partial<PersistedExtraction> = {}
): PersistedExtraction {
  return {
    id: crypto.randomUUID(),
    entity_type: 'metric.revenue',
    value: 10_000_000,
    unit: 'KZT',
    period_year: 2024,
    period_quarter: null,
    confidence: 0.7,
    source_type: 'survey',
    source_doc_id: null,
    source_field: 'survey.s2_revenue_2024',
    extractor_name: 'survey',
    extractor_version: '1.0.0',
    extracted_at: new Date().toISOString(),
    superseded_by: null,
    ...overrides,
  }
}

describe('resolveConsensus', () => {
  it('returns single winner when only one extraction per group', () => {
    const input = [mkExtraction()]
    const result = resolveConsensus(input)
    expect(result.winners).toHaveLength(1)
    expect(result.winners[0].id).toBe(input[0].id)
    expect(result.conflicts).toHaveLength(0)
    expect(Object.keys(result.supersededBy)).toHaveLength(0)
  })

  it('document beats survey at equal confidence', () => {
    const survey = mkExtraction({ value: 10_000_000, source_type: 'survey', confidence: 0.7 })
    const doc = mkExtraction({
      value: 12_000_000,
      source_type: 'document',
      confidence: 0.7,
      source_field: 'sales_q3.pdf#revenue',
    })
    const result = resolveConsensus([survey, doc])

    expect(result.winners).toHaveLength(1)
    expect(result.winners[0].id).toBe(doc.id)
    expect(result.supersededBy[survey.id]).toBe(doc.id)
  })

  it('higher confidence wins when same source tier', () => {
    const low = mkExtraction({ value: 100, source_type: 'document', confidence: 0.5 })
    const high = mkExtraction({ value: 200, source_type: 'document', confidence: 0.95 })
    const result = resolveConsensus([low, high])

    expect(result.winners[0].id).toBe(high.id)
  })

  it('marks >20% numeric gap as pending conflict', () => {
    // document-survey gap 20% uses doc.9 × 0.85 = 0.765 vs survey.7 × 0.7 = 0.49 → doc wins
    const doc = mkExtraction({ value: 12_000_000, source_type: 'document', confidence: 0.85 })
    const survey = mkExtraction({ value: 8_000_000, source_type: 'survey', confidence: 0.7 })
    const result = resolveConsensus([doc, survey])

    expect(result.winners[0].id).toBe(doc.id)
    expect(result.conflicts).toHaveLength(1)
    expect(result.conflicts[0].resolution).toBe('pending')
    expect(result.conflicts[0].gap).toBeGreaterThan(0.2)
  })

  it('marks <=20% gap as auto-resolved conflict', () => {
    const doc = mkExtraction({ value: 10_000_000, source_type: 'document', confidence: 0.85 })
    const survey = mkExtraction({ value: 9_500_000, source_type: 'survey', confidence: 0.7 })
    const result = resolveConsensus([doc, survey])

    expect(result.conflicts).toHaveLength(1)
    expect(result.conflicts[0].resolution).toBe('auto')
  })

  it('groups by (entity_type, period_year, period_quarter)', () => {
    const r2023 = mkExtraction({ period_year: 2023, value: 5_000_000 })
    const r2024 = mkExtraction({ period_year: 2024, value: 10_000_000 })
    const r2024Q3 = mkExtraction({ period_year: 2024, period_quarter: 'Q3', value: 3_000_000 })
    const result = resolveConsensus([r2023, r2024, r2024Q3])

    expect(result.winners).toHaveLength(3)
    expect(result.conflicts).toHaveLength(0)
  })

  it('ties broken by extracted_at desc', () => {
    const older = mkExtraction({
      value: 100,
      extracted_at: '2024-01-01T00:00:00.000Z',
    })
    const newer = mkExtraction({
      value: 200,
      extracted_at: '2025-01-01T00:00:00.000Z',
    })
    const result = resolveConsensus([older, newer])
    expect(result.winners[0].id).toBe(newer.id)
  })
})

describe('winnersToMetrics', () => {
  it('projects numeric metric.* entities into metrics rows', () => {
    const winners: PersistedExtraction[] = [
      mkExtraction({ entity_type: 'metric.revenue', value: 10_000_000, period_year: 2024 }),
      mkExtraction({ entity_type: 'metric.cac', value: 15_000, period_year: null }),
      mkExtraction({ entity_type: 'attribute.company_name', value: 'Test Co' }),
      mkExtraction({ entity_type: 'metric.foo', value: 'not a number' as unknown }),
    ]
    const rows = winnersToMetrics(winners, 'company-uuid')
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({
      company_id: 'company-uuid',
      metric_key: 'revenue',
      metric_value: 10_000_000,
      source: 'calculated',
    })
    expect(rows[1].metric_key).toBe('cac')
  })

  it('skips non-metric and non-numeric values', () => {
    const winners: PersistedExtraction[] = [
      mkExtraction({ entity_type: 'asset.palette', value: ['#000'] }),
      mkExtraction({ entity_type: 'metric.revenue', value: NaN }),
    ]
    expect(winnersToMetrics(winners, 'c')).toHaveLength(0)
  })
})
