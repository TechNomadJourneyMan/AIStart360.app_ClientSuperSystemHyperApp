import { describe, it, expect } from 'vitest'
import { findBenchmark } from '@/lib/point-a/benchmarks'
import { INDUSTRIES } from '@/components/onboarding/constants/options'

// The questionnaire names industries differently from the benchmark table:
// before 2026-11-02 only 2 of its 13 options found a benchmark.
const EXPECTED: Record<(typeof INDUSTRIES)[number], string | null> = {
  'IT / Технологии': 'B2B SaaS',
  'Ритейл / E-commerce': 'Розничная торговля',
  'Производство': 'Производство',
  'Строительство': null,
  'Финансы / Банкинг': null,
  'Образование': 'Образование',
  'Медицина / Здравоохранение': 'Медицина / клиники',
  'Логистика / Транспорт': null,
  'HoReCa / Рестораны': 'Общепит / HoReCa',
  'Агробизнес': null,
  'Консалтинг / Услуги B2B': 'Услуги',
  'Медиа / Реклама': null,
  'Другое': null,
}

describe('findBenchmark — industries of the questionnaire', () => {
  it.each(INDUSTRIES.map((i) => [i, EXPECTED[i]] as const))('%s → %s', (industry, expected) => {
    expect(findBenchmark(industry, null)?.industry ?? null).toBe(expected)
  })
  it('benchmark names themselves still match, case and spaces aside', () => {
    expect(findBenchmark('  электронная коммерция ', null)?.industry).toBe('Электронная коммерция')
  })
})
