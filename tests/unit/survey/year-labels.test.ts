import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { relativeYearWord, yearLabel, yearOfKey, yearPhrase } from '@/lib/survey/year-labels'
import { surveyKeyPeriod } from '@/lib/data-layer/survey-periods'
import Step5 from '@/components/onboarding/steps/Step5ClientBaseForm'
import { Step9FinanceForm } from '@/components/onboarding/steps/Step9FinanceForm'

const OCT_2026 = new Date('2026-10-22T10:00:00')

describe('relative years', () => {
  it('names the year relative to today', () => {
    expect(relativeYearWord(2026, OCT_2026)).toBe('текущий год')
    expect(relativeYearWord(2025, OCT_2026)).toBe('последний полный год')
    expect(relativeYearWord(2024, OCT_2026)).toBe('позапрошлый год')
    expect(relativeYearWord(2023, OCT_2026)).toBe('3 года назад')
    expect(relativeYearWord(2021, OCT_2026)).toBe('5 лет назад')
    expect(relativeYearWord(2027, OCT_2026)).toBe('следующий год')
    // A year later the same key reads differently.
    expect(relativeYearWord(2025, new Date('2027-03-01'))).toBe('позапрошлый год')
    expect(yearPhrase(2025, OCT_2026)).toBe('последний полный год (2025)')
  })

  it('takes the year from the key, or the data layer\'s stated year — the same year the metrics use', () => {
    expect(yearOfKey('s3_deals_2025')).toBe(2025)
    expect(yearOfKey('s9n_revenue_2024')).toBe(2024)
    expect(yearOfKey('s9n_net_profit')).toBe(2024)
    expect(yearOfKey('s1_company_name')).toBeNull()
    for (const key of ['s9n_revenue_2024', 's9n_net_profit', 's3_deals_2023']) {
      expect(yearOfKey(key)).toBe(surveyKeyPeriod(key, null, OCT_2026).period.year)
    }
    expect(yearLabel('Сделок', 's3_deals_2025', OCT_2026)).toBe('Сделок — последний полный год (2025)')
    expect(yearLabel('Название', 's1_company_name', OCT_2026)).toBe('Название')
  })
})

describe('labels in the forms', () => {
  it('step 5 and step 9 no longer hard-code «2024» / «Сделок 2023»', () => {
    const s5 = renderToStaticMarkup(createElement(Step5, { data: {}, onChange: () => {} }))
    expect(s5).not.toContain('>Сделок 2023<')
    expect(s5).toMatch(/Сделок — (последний полный год|позапрошлый год|\d+ (год|года|лет) назад|текущий год) \(2025\)/)
    const s9 = renderToStaticMarkup(createElement(Step9FinanceForm, { data: {}, onChange: () => {} }))
    expect(s9).not.toContain('Годовая выручка 2024')
    expect(s9).toContain('(2024)')
  })
})
