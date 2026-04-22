import { describe, expect, it } from 'vitest'

import {
  coerceNumber,
  excerpt,
  makeEntity,
  matchColumn,
  parsePeriod,
  DEFAULT_CONFIDENCE,
  SOURCE_PRIORITY,
} from '@/lib/ai/extractors/base'

describe('coerceNumber', () => {
  it('passes through plain numbers', () => {
    expect(coerceNumber(42)).toBe(42)
    expect(coerceNumber(0)).toBe(0)
    expect(coerceNumber(-100)).toBe(-100)
  })

  it('returns NaN for non-numeric strings', () => {
    expect(coerceNumber('abc')).toBeNaN()
    expect(coerceNumber('')).toBeNaN()
    expect(coerceNumber(null)).toBeNaN()
  })

  it('parses Russian suffixes', () => {
    expect(coerceNumber('10.5 млн')).toBe(10_500_000)
    expect(coerceNumber('2 млрд')).toBe(2_000_000_000)
    expect(coerceNumber('50 тыс')).toBe(50_000)
  })

  it('parses English suffixes', () => {
    expect(coerceNumber('2.4M')).toBe(2_400_000)
    expect(coerceNumber('10k')).toBe(10_000)
  })

  it('handles thousands separators', () => {
    expect(coerceNumber('10 500 000')).toBe(10_500_000)
    expect(coerceNumber('10,500,000')).toBe(10_500_000)
  })

  it('parses EU decimal (comma) convention', () => {
    expect(coerceNumber('10,5')).toBe(10.5)
  })

  it('handles dot-and-comma mix (comma=thousand)', () => {
    expect(coerceNumber('10,500.25')).toBe(10_500.25)
  })
})

describe('parsePeriod', () => {
  it('extracts year only', () => {
    expect(parsePeriod('2024')).toEqual({ year: 2024, quarter: undefined })
  })

  it('extracts year + quarter', () => {
    expect(parsePeriod('2024 Q3')).toEqual({ year: 2024, quarter: 'Q3' })
    expect(parsePeriod('Q1 2025')).toEqual({ year: 2025, quarter: 'Q1' })
  })

  it('handles quarter only', () => {
    expect(parsePeriod('Q4')).toEqual({ year: undefined, quarter: 'Q4' })
  })

  it('returns undefined for non-matches', () => {
    expect(parsePeriod('hello')).toEqual({ year: undefined, quarter: undefined })
  })
})

describe('matchColumn', () => {
  it('returns 1 for exact match', () => {
    expect(matchColumn('phone', ['phone'])).toBe(1)
  })

  it('matches case-insensitively with underscores', () => {
    expect(matchColumn('Phone Number', ['phone_number'])).toBe(1)
  })

  it('returns partial match score', () => {
    expect(matchColumn('customer_phone', ['phone'])).toBeGreaterThan(0.3)
  })

  it('returns 0 for no match', () => {
    expect(matchColumn('foo', ['bar'])).toBe(0)
  })
})

describe('excerpt', () => {
  it('returns short strings as-is', () => {
    expect(excerpt('hello')).toBe('hello')
  })

  it('collapses whitespace', () => {
    expect(excerpt('a   b\n\nc')).toBe('a b c')
  })

  it('truncates at maxLen and appends ellipsis', () => {
    const long = 'a'.repeat(300)
    const result = excerpt(long, 100)
    expect(result.length).toBe(101) // 100 chars + ellipsis
    expect(result.endsWith('…')).toBe(true)
  })
})

describe('makeEntity', () => {
  it('clamps confidence to [0,1]', () => {
    const e1 = makeEntity({
      entity_type: 'metric.x',
      value: 1,
      confidence: 1.5,
      source_type: 'survey',
      extractor_name: 'test',
      extractor_version: '1',
    })
    expect(e1.confidence).toBe(1)

    const e2 = makeEntity({
      entity_type: 'metric.x',
      value: 1,
      confidence: -0.3,
      source_type: 'survey',
      extractor_name: 'test',
      extractor_version: '1',
    })
    expect(e2.confidence).toBe(0)
  })

  it('preserves optional fields', () => {
    const e = makeEntity({
      entity_type: 'metric.revenue',
      value: 100,
      confidence: 0.8,
      source_type: 'document',
      extractor_name: 'test',
      extractor_version: '1',
      period_year: 2024,
      period_quarter: 'Q3',
      source_doc_id: 'doc-1',
      unit: 'KZT',
    })
    expect(e.period_year).toBe(2024)
    expect(e.period_quarter).toBe('Q3')
    expect(e.source_doc_id).toBe('doc-1')
    expect(e.unit).toBe('KZT')
  })
})

describe('priority constants', () => {
  it('document > survey > calculated', () => {
    expect(SOURCE_PRIORITY.document).toBeGreaterThan(SOURCE_PRIORITY.survey)
    expect(SOURCE_PRIORITY.survey).toBeGreaterThan(SOURCE_PRIORITY.calculated)
  })

  it('document default confidence > survey', () => {
    expect(DEFAULT_CONFIDENCE.document).toBeGreaterThan(DEFAULT_CONFIDENCE.survey)
  })
})
