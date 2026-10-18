/**
 * Goal horizons (Point B plan Ф2, Task 1): a period label or a deadline → whole months from `now`
 * (rounded up, never negative), the presets of the goal wizard, and the main revenue goal.
 */
import { describe, expect, it } from 'vitest'
import { HORIZON_PRESETS, horizonDeadline, horizonMonths, isValidPeriodLabel, pickPrimaryRevenueGoal } from '@/lib/point-b/horizons'
import type { PlanGoalItem } from '@/lib/point-b/plan/types'

const REVENUE = 'biz.finansy.vyruchka_god'
const NOW = new Date('2026-10-18T09:00:00Z')

const item = (over: Partial<PlanGoalItem> = {}): PlanGoalItem => ({
  metricKey: REVENUE, periodLabel: '12m', label: null, baselineValue: null, baselinePeriod: null,
  targetValue: 120, deadline: null, reviewStatus: 'owner_draft', ...over,
})

describe('horizonMonths', () => {
  it('1m, 3m, 12m, 3y, 2025-Q2, 2027 convert to months from a fixed now', () => {
    const m = (periodLabel: string, now = NOW) => horizonMonths({ deadline: null, periodLabel }, now)
    expect(m('1m')).toBe(1)
    expect(m('3m')).toBe(3)
    expect(m('12m')).toBe(12)
    expect(m('3y')).toBe(36)
    // 2025-Q2 ends 2025-06-30: from 2025-01-15 that is 5.5 months → rounded up to 6.
    expect(m('2025-Q2', new Date('2025-01-15T00:00:00Z'))).toBe(6)
    // 2027 ends 2027-12-31: from 2026-10-18 that is 14.4 months → 15.
    expect(m('2027')).toBe(15)
  })

  it('a horizon counts from the start of the goal when it has one', () => {
    // «12m» set on 2026-04-18 ends 2027-04-18: 6 months from 2026-10-18.
    expect(horizonMonths({ deadline: null, periodLabel: '12m', baselineAt: '2026-04-18T09:00:00Z' }, NOW)).toBe(6)
    expect(horizonMonths({ deadline: null, periodLabel: '12m', createdAt: '2026-04-18T09:00:00Z' }, NOW)).toBe(6)
  })

  it('an explicit deadline overrides the label', () => {
    // 2027-04-18 is the END of that day: 6 months and a few hours → 7.
    expect(horizonMonths({ deadline: '2027-04-18', periodLabel: '3y' }, NOW)).toBe(7)
    expect(horizonMonths({ deadline: '2026-12-31', periodLabel: '3y' }, NOW)).toBe(3)
  })

  it('a deadline in the past gives 0', () => {
    expect(horizonMonths({ deadline: '2026-01-01', periodLabel: '12m' }, NOW)).toBe(0)
    expect(horizonMonths({ deadline: null, periodLabel: '2025' }, NOW)).toBe(0)
  })
})

describe('horizonDeadline', () => {
  it('is the deadline as YYYY-MM-DD: explicit date, else from the label', () => {
    expect(horizonDeadline({ deadline: '2027-04-18', periodLabel: '3y' }, NOW)).toBe('2027-04-18')
    expect(horizonDeadline({ deadline: null, periodLabel: '12m' }, NOW)).toBe('2027-10-18')
    expect(horizonDeadline({ deadline: null, periodLabel: '2027-Q2' }, NOW)).toBe('2027-06-30')
  })
})

describe('pickPrimaryRevenueGoal', () => {
  it('prefers the plan primary, then revenue 12m, then the nearest deadline', () => {
    const y3 = item({ periodLabel: '3y', targetValue: 600 })
    const y1 = item({ periodLabel: '12m', targetValue: 120 })
    const q = item({ periodLabel: '3m', targetValue: 70 })
    const other = item({ metricKey: 'biz.marketing.cac', periodLabel: '12m', targetValue: 5 })
    const all = [other, y3, y1, q]

    // the plan primary wins even if it is not the nearest
    expect(pickPrimaryRevenueGoal(all, { primary: { metricKey: REVENUE, periodLabel: '3y' }, now: NOW })).toBe(y3)
    // no primary → revenue 12m
    expect(pickPrimaryRevenueGoal(all, { now: NOW })).toBe(y1)
    // no 12m → the nearest revenue goal by deadline
    expect(pickPrimaryRevenueGoal([other, y3, q], { now: NOW })).toBe(q)
    expect(pickPrimaryRevenueGoal([y3, item({ periodLabel: '6m' })], { now: NOW })?.periodLabel).toBe('6m')
    // a primary that is not a revenue goal is ignored (the model solves revenue only)
    expect(pickPrimaryRevenueGoal(all, { primary: { metricKey: 'biz.marketing.cac', periodLabel: '12m' }, now: NOW })).toBe(y1)
    // a primary that does not exist falls through
    expect(pickPrimaryRevenueGoal(all, { primary: { metricKey: REVENUE, periodLabel: '2y' }, now: NOW })).toBe(y1)
    // no revenue goal at all
    expect(pickPrimaryRevenueGoal([other], { now: NOW })).toBeNull()
    expect(pickPrimaryRevenueGoal([])).toBeNull()
  })

  it('the nearest deadline uses explicit deadlines too', () => {
    const late = item({ periodLabel: '2y', deadline: '2028-10-18' })
    const soon = item({ periodLabel: '2y', deadline: '2027-01-31' })
    expect(pickPrimaryRevenueGoal([late, soon], { now: NOW })).toBe(soon)
  })
})

describe('isValidPeriodLabel', () => {
  it('accepts 6m, 2y, 2026-Q4 and rejects abc, 0m, 61m', () => {
    for (const ok of ['6m', '2y', '2026-Q4', '1m', '60m', '5y', '2027', '12M', '3Y']) expect(isValidPeriodLabel(ok), ok).toBe(true)
    for (const bad of ['abc', '0m', '61m', '6y', '0y', '', '2026-Q5', '2026-Q0', '12', 'm', '-3m', '1.5y', '99999']) expect(isValidPeriodLabel(bad), bad).toBe(false)
  })
})

describe('HORIZON_PRESETS', () => {
  it('lists month, quarter, year and 3 years with valid labels', () => {
    expect(HORIZON_PRESETS.map((p) => p.periodLabel)).toEqual(['1m', '3m', '12m', '3y'])
    expect(HORIZON_PRESETS.map((p) => p.label)).toEqual(['Месяц', 'Квартал', 'Год', '3 года'])
    for (const p of HORIZON_PRESETS) expect(isValidPeriodLabel(p.periodLabel)).toBe(true)
  })
})
