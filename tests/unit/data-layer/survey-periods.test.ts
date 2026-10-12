import { describe, it, expect } from 'vitest'
import { surveyKeyPeriod, tableColumnPeriod } from '@/lib/data-layer/survey-periods'

const NOW = new Date('2026-10-12T00:00:00Z')
const y = (year: number) => ({ year, quarter: null, month: null })

describe('surveyKeyPeriod', () => {
  it('reads the year from the key', () => {
    expect(surveyKeyPeriod('s9n_revenue_2024', null, NOW)).toEqual({ period: y(2024), basis: 'key' })
    expect(surveyKeyPeriod('s2_revenue_2025', null, NOW)).toEqual({ period: y(2025), basis: 'key' })
    expect(surveyKeyPeriod('s2_new_clients_2024', null, NOW)).toEqual({ period: y(2024), basis: 'key' })
  })

  it('treats «vs YYYY» as the year after the compared one', () => {
    expect(surveyKeyPeriod('s9n_change_vs_2023', null, NOW)).toEqual({ period: y(2024), basis: 'key' })
  })

  it('places an answer without a year in the year it was given', () => {
    expect(surveyKeyPeriod('s9n_net_profit', '2026-03-05T10:00:00Z', NOW)).toEqual({ period: y(2026), basis: 'answered' })
    expect(surveyKeyPeriod('s9n_net_profit', '2025-12-31T10:00:00Z', NOW)).toEqual({ period: y(2025), basis: 'answered' })
    expect(surveyKeyPeriod('s9n_net_profit', null, NOW)).toEqual({ period: y(2026), basis: 'answered' })
    expect(surveyKeyPeriod('s8n_metrics_table', null, NOW).basis).toBe('answered')
  })

  it('does not take other numbers for years', () => {
    expect(surveyKeyPeriod('s7_repeat_freq_days', null, NOW).basis).toBe('answered')
    expect(surveyKeyPeriod('s1_goal_9999', null, NOW).basis).toBe('answered')
    expect(surveyKeyPeriod('s1_goal_1999', null, NOW).basis).toBe('answered')
  })
})

describe('tableColumnPeriod', () => {
  it('maps metrics-table columns', () => {
    expect(tableColumnPeriod('y2023')).toEqual(y(2023))
    expect(tableColumnPeriod('fact_2026')).toEqual({ ...y(2026), ytd: true })
    expect(tableColumnPeriod('plan_2026')).toBeNull()
    expect(tableColumnPeriod('completion_pct')).toBeNull()
  })
})
