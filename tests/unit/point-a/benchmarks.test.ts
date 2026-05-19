import { describe, it, expect } from 'vitest'
import {
  BENCHMARKS,
  findBenchmark,
  percentileAgainstBenchmark,
  ratingLabel,
} from '@/lib/point-a/benchmarks'

describe('findBenchmark', () => {
  it('returns the stage-specific row for a known industry/stage pair', () => {
    const row = findBenchmark('B2B SaaS', 'growth')
    expect(row).not.toBeNull()
    expect(row!.industry).toBe('B2B SaaS')
    expect(row!.stage).toBe('growth')
    expect(row!.blocks.sales).toBeGreaterThan(0)
  })

  it('matches industry case-insensitively', () => {
    const row = findBenchmark('розничная торговля', 'growth')
    expect(row).not.toBeNull()
    expect(row!.industry).toBe('Розничная торговля')
    expect(row!.stage).toBe('growth')
  })

  it('falls back to the all-stage row when the stage is unknown', () => {
    const row = findBenchmark('Услуги', 'totally-fake-stage')
    expect(row).not.toBeNull()
    expect(row!.stage).toBe('all')
    expect(row!.industry).toBe('Услуги')
  })

  it('falls back to the all-stage row when stage is null', () => {
    const row = findBenchmark('Производство', null)
    expect(row).not.toBeNull()
    expect(row!.stage).toBe('all')
  })

  it('returns null for an unknown industry regardless of stage', () => {
    expect(findBenchmark('Космические грузоперевозки', 'growth')).toBeNull()
    expect(findBenchmark('Космические грузоперевозки', null)).toBeNull()
    expect(findBenchmark(null, 'growth')).toBeNull()
  })
})

describe('percentileAgainstBenchmark', () => {
  it('returns 50 when score equals the benchmark', () => {
    expect(percentileAgainstBenchmark(60, 60)).toBe(50)
    expect(percentileAgainstBenchmark(0, 0)).toBe(50)
    expect(percentileAgainstBenchmark(100, 100)).toBe(50)
  })

  it('returns a high percentile when the score is far above the benchmark', () => {
    const p = percentileAgainstBenchmark(95, 50)
    expect(p).toBeGreaterThan(80)
    expect(p).toBeLessThanOrEqual(100)
  })

  it('returns a low percentile when the score is far below the benchmark', () => {
    const p = percentileAgainstBenchmark(10, 60)
    expect(p).toBeLessThan(20)
    expect(p).toBeGreaterThanOrEqual(0)
  })

  it('reaches 100 at score=100 and 0 at score=0', () => {
    expect(percentileAgainstBenchmark(100, 50)).toBe(100)
    expect(percentileAgainstBenchmark(0, 50)).toBe(0)
  })

  it('clamps out-of-range inputs', () => {
    expect(percentileAgainstBenchmark(150, 60)).toBeLessThanOrEqual(100)
    expect(percentileAgainstBenchmark(-20, 60)).toBeGreaterThanOrEqual(0)
  })
})

describe('ratingLabel', () => {
  it('classifies 75 as strong (boundary)', () => {
    expect(ratingLabel(75).tone).toBe('strong')
    expect(ratingLabel(75).label).toBe('Выше среднего')
  })

  it('classifies 74 as average (just below the strong boundary)', () => {
    expect(ratingLabel(74).tone).toBe('average')
    expect(ratingLabel(74).label).toBe('На уровне')
  })

  it('classifies 40 as average (boundary)', () => {
    expect(ratingLabel(40).tone).toBe('average')
    expect(ratingLabel(40).label).toBe('На уровне')
  })

  it('classifies 39 as weak (just below the average boundary)', () => {
    expect(ratingLabel(39).tone).toBe('weak')
    expect(ratingLabel(39).label).toBe('Ниже среднего')
  })

  it('clamps and classifies extreme values', () => {
    expect(ratingLabel(0).tone).toBe('weak')
    expect(ratingLabel(100).tone).toBe('strong')
    expect(ratingLabel(-50).tone).toBe('weak')
    expect(ratingLabel(150).tone).toBe('strong')
  })
})

describe('BENCHMARKS dataset', () => {
  it('contains at least 8 distinct industries', () => {
    const industries = new Set(BENCHMARKS.map((row) => row.industry))
    expect(industries.size).toBeGreaterThanOrEqual(8)
  })

  it('provides an "all"-stage row for every industry', () => {
    const industries = new Set(BENCHMARKS.map((row) => row.industry))
    for (const industry of industries) {
      const hasAll = BENCHMARKS.some(
        (row) => row.industry === industry && row.stage === 'all',
      )
      expect(hasAll, `missing "all"-stage row for "${industry}"`).toBe(true)
    }
  })

  it('provides at least one stage-specific override per industry', () => {
    const industries = new Set(BENCHMARKS.map((row) => row.industry))
    for (const industry of industries) {
      const stageSpecific = BENCHMARKS.filter(
        (row) => row.industry === industry && row.stage !== 'all',
      )
      expect(
        stageSpecific.length,
        `missing stage-specific row for "${industry}"`,
      ).toBeGreaterThanOrEqual(1)
    }
  })

  it('keeps all block and overall scores within 0..100', () => {
    for (const row of BENCHMARKS) {
      for (const value of Object.values(row.blocks)) {
        expect(value).toBeGreaterThanOrEqual(0)
        expect(value).toBeLessThanOrEqual(100)
      }
      expect(row.overall).toBeGreaterThanOrEqual(0)
      expect(row.overall).toBeLessThanOrEqual(100)
      expect(row.sampleSize).toBeGreaterThan(0)
    }
  })
})
