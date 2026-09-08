import { describe, it, expect } from 'vitest'
import { formatSurveyValue, getStepFromKey } from '@/lib/survey-labels'

describe('formatSurveyValue', () => {
  it('renders table rows (Карта влияния) as text, not [object Object]', () => {
    const rows = [
      { category: 'Клиенты', name_or_link: 'ТОО Ромашка', status: 'есть контакт' },
      { category: 'Партнёры', name_or_link: '', status: '' }, // prefilled template row
      { category: 'СМИ / PR', name_or_link: 'Forbes KZ', status: 'в работе' },
    ]
    const out = formatSurveyValue('s11_influence_map', rows)
    expect(out).not.toContain('[object Object]')
    expect(out).toBe('Клиенты — ТОО Ромашка — есть контакт; СМИ / PR — Forbes KZ — в работе')
  })

  it('shows a dash when no table row was filled', () => {
    expect(formatSurveyValue('s11_influence_map', [{ category: 'Клиенты', name_or_link: '', status: '' }])).toBe('—')
    expect(formatSurveyValue('s11_influence_map', [])).toBe('—')
  })

  it('keeps simple arrays and {value} wrappers working', () => {
    expect(formatSurveyValue('s1_regions', ['Астана', 'Алматы'])).toBe('Астана, Алматы')
    expect(formatSurveyValue('s1_regions', { value: ['Астана'] })).toBe('Астана')
  })
})

describe('getStepFromKey', () => {
  it('maps current-generation keys and cross-prefix keys to the owning step', () => {
    expect(getStepFromKey('s2n_goal_12m_what')).toBe(2) // old regex returned 0 for s2n_
    expect(getStepFromKey('s3_deals_2024')).toBe(5)
    expect(getStepFromKey('s99_unknown')).toBe(99)
  })
})
