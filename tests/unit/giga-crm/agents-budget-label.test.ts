/**
 * «Стоимость ИИ» budget labels (review findings #43, #67).
 */
import { describe, expect, it } from 'vitest'
import { budgetLimitLabel, platformSpendToday, type DayPoint } from '@/components/giga-panel/agents/model'

describe('budget labels', () => {
  it('a budget of 0 forbids model calls — it is not "no limit" (#67)', () => {
    expect(budgetLimitLabel(0)).toBe('$0 (LLM запрещён)')
    expect(budgetLimitLabel(0)).not.toMatch(/без лимита/)
    expect(budgetLimitLabel(5)).toBe('$5.00')
  })

  it("today's platform spend comes from the enforced figure, not agent runs only (#43)", () => {
    const today = new Date().toISOString().slice(0, 10)
    const series: DayPoint[] = [{ day: today, label: '', cost: 10, runs: 3, tokensIn: 0, tokensOut: 0 }]
    expect(platformSpendToday({ platformSpendTodayUsd: 55 }, series)).toBe(55)
    expect(platformSpendToday({}, series)).toBe(10)
  })
})
