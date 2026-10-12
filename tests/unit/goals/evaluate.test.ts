import { describe, it, expect } from 'vitest'
import { evaluateGoal, goalDeadline, type Goal } from '@/lib/goals/evaluate'

const NOW = new Date('2026-10-12T00:00:00Z')
const goal = (over: Partial<Goal> = {}): Goal => ({
  id: 'g', metricId: 'biz.finansy.vyruchka_god', label: 'Выручка', unit: '₸', targetValue: 120_000_000,
  direction: 'higher_is_better', periodLabel: '12m', deadline: null, baselineValue: null, baselinePeriod: null,
  source: 'owner', note: null, createdAt: '2026-10-12T00:00:00Z', ...over,
})

describe('goalDeadline', () => {
  it('explicit date, months, years, quarter, year', () => {
    expect(goalDeadline(goal({ deadline: '2027-03-31' }), NOW).toISOString().slice(0, 10)).toBe('2027-03-31')
    expect(goalDeadline(goal({ periodLabel: '12m' }), NOW).toISOString().slice(0, 10)).toBe('2027-10-12')
    expect(goalDeadline(goal({ periodLabel: '3y' }), NOW).toISOString().slice(0, 10)).toBe('2029-10-12')
    expect(goalDeadline(goal({ periodLabel: '2026-Q4' }), NOW).toISOString().slice(0, 10)).toBe('2026-12-31')
    expect(goalDeadline(goal({ periodLabel: '2027' }), NOW).toISOString().slice(0, 10)).toBe('2027-12-31')
  })
})

describe('evaluateGoal', () => {
  it('money: ×2 in 12 months is aggressive (CAGR 100 %)', () => {
    const e = evaluateGoal(goal(), { value: 60_000_000, period: '2026' }, NOW)
    expect(e.requiredCagr).toBeCloseTo(100, 0)
    expect(e.realism).toBe('aggressive')
    expect(e.gap).toBe(60_000_000)
    expect(e.gapPct).toBe(100)
    expect(e.realismText).toMatch(/^Агрессивно: рост ×2 за 12 мес/)
  })

  it('money: +15 % in a year is realistic', () => {
    expect(evaluateGoal(goal({ targetValue: 69_000_000 }), { value: 60_000_000 }, NOW).realism).toBe('realistic')
  })

  it('percent: margin 20 → 40 % in a year is aggressive in points', () => {
    const e = evaluateGoal(goal({ metricId: 'biz.finansy.valovaya_marzha', unit: '%', targetValue: 40 }), { value: 20 }, NOW)
    expect(e.requiredPointsPerYear).toBeCloseTo(20, 0)
    expect(e.requiredCagr).toBeNull()
    expect(e.realism).toBe('aggressive')
  })

  it('lower is better: CAC 20k → 15k', () => {
    const e = evaluateGoal(goal({ metricId: 'biz.marketing.cac', direction: 'lower_is_better', targetValue: 15_000 }), { value: 20_000 }, NOW)
    expect(e.requiredCagr).toBeGreaterThan(30)
    expect(e.realismText).toMatch(/снижение/)
  })

  it('achieved / no data / overdue', () => {
    expect(evaluateGoal(goal(), { value: 130_000_000 }, NOW).status).toBe('achieved')
    expect(evaluateGoal(goal(), { value: null }, NOW)).toMatchObject({ status: 'no_data', realism: 'unknown' })
    expect(evaluateGoal(goal({ deadline: '2026-06-30' }), { value: 60_000_000 }, NOW).status).toBe('overdue')
  })

  it('progress since the baseline against the time elapsed', () => {
    const g = goal({ baselineValue: 60_000_000, createdAt: '2026-04-12T00:00:00Z', deadline: '2027-04-12' })
    // half the time passed, half the way done
    expect(evaluateGoal(g, { value: 90_000_000 }, NOW)).toMatchObject({ status: 'on_track', progress: 50 })
    // half the time passed, 10 % done
    expect(evaluateGoal(g, { value: 66_000_000 }, NOW).status).toBe('behind')
    expect(evaluateGoal(g, { value: 78_000_000 }, NOW).status).toBe('at_risk')
  })
})
