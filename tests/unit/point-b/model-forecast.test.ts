/**
 * «At the current pace» forecast and the verdict (Point B plan Ф2, Task 5).
 *
 * Golden: a history growing 2% a month, 18 months to 2026-09. The mean of the last 6 months over the
 * mean of the previous 6 is 1.02^6, so the trend is exactly 2% a month; with base 60M and 12 months
 * to the deadline the forecast is 60M · 1.02^12 = 76 094 508 ₸.
 */
import { describe, expect, it } from 'vitest'
import { describeHistory, projectCurrentPace, verdictFor } from '@/lib/point-b/model/forecast'
import type { Forecast, ModelGoal } from '@/lib/point-b/model/types'
import { modelInputs, monthly, NOW } from './_model'

const growing = (months: number, from = '2025-04', rate = 0.02) =>
  monthly(from, Array.from({ length: months }, (_, k) => 5_000_000 * (1 + rate) ** k))

describe('projectCurrentPace', () => {
  it('projectCurrentPace is insufficient below 12 points and computed with 12 or more', () => {
    const short = projectCurrentPace(modelInputs({ history: growing(11, '2025-11') }))
    expect(short).toEqual({ atCurrentPace: { low: null, base: null, high: null }, trendMonthlyPct: null, basis: 'insufficient' })
    expect(projectCurrentPace(modelInputs({ history: [] })).basis).toBe('insufficient')

    const ok = projectCurrentPace(modelInputs({ history: growing(12, '2025-10') }))
    expect(ok.basis).toBe('history')
    expect(ok.trendMonthlyPct).toBeCloseTo(2, 9)
    expect(ok.atCurrentPace.base!).toBeCloseTo(60_000_000 * 1.02 ** 12, 0)
    expect(ok.atCurrentPace.base!).toBeCloseTo(76_094_508, -1)
    // 18 months give the same trend
    const more = projectCurrentPace(modelInputs({ history: growing(18) }))
    expect(more.trendMonthlyPct).toBeCloseTo(2, 9)
  })

  it('the range is the volatility band: ±20% by default, narrower for a calm history', () => {
    const f = projectCurrentPace(modelInputs({ history: growing(12, '2025-10') }))
    // the exponential history has no deviation → the band's lower bound, 5%
    expect(f.atCurrentPace.low!).toBeCloseTo(f.atCurrentPace.base! * 0.95, 3)
    expect(f.atCurrentPace.high!).toBeCloseTo(f.atCurrentPace.base! * 1.05, 3)
    expect(f.atCurrentPace.low!).toBeLessThan(f.atCurrentPace.base!)
    expect(f.atCurrentPace.base!).toBeLessThan(f.atCurrentPace.high!)
  })

  it('a flat or shrinking history projects a flat or shrinking forecast', () => {
    const flat = projectCurrentPace(modelInputs({ history: monthly('2025-10', Array(12).fill(5_000_000)) }))
    expect(flat.trendMonthlyPct).toBeCloseTo(0, 9)
    expect(flat.atCurrentPace.base!).toBeCloseTo(60_000_000, 3)
    const down = projectCurrentPace(modelInputs({ history: growing(12, '2025-10', -0.02) }))
    expect(down.trendMonthlyPct!).toBeLessThan(0)
    expect(down.atCurrentPace.base!).toBeLessThan(60_000_000)
  })

  it('a hole in the last 12 months is a short history: insufficient', () => {
    const h = growing(14, '2025-08').filter((_, k) => k !== 9) // one month missing → the run in a row is 4
    expect(describeHistory(h, NOW.toISOString())).toMatchObject({ points: 13, run: 4, hasGaps: true })
    expect(projectCurrentPace(modelInputs({ history: h })).basis).toBe('insufficient')
    // a hole in the distant past does not hurt a long enough tail
    const old = growing(20, '2025-02').filter((_, k) => k !== 1)
    expect(projectCurrentPace(modelInputs({ history: old })).basis).toBe('history')
  })

  it('a history that ended long ago is not «the current pace»', () => {
    const stale = growing(12, '2024-01') // ends 2024-12, now is 2026-10
    expect(describeHistory(stale, NOW.toISOString()).lagMonths).toBe(22)
    expect(projectCurrentPace(modelInputs({ history: stale })).basis).toBe('insufficient')
    // up to 4 months of delay is normal for monthly figures
    expect(projectCurrentPace(modelInputs({ history: growing(12, '2025-07') })).basis).toBe('history') // ends 2026-06: 4 months
    expect(projectCurrentPace(modelInputs({ history: growing(12, '2025-06') })).basis).toBe('insufficient') // ends 2026-05: 5 months
  })

  it('without a goal the trend is still reported, the range is not', () => {
    const f = projectCurrentPace(modelInputs({ history: growing(12, '2025-10'), goal: null }))
    expect(f.basis).toBe('history')
    expect(f.trendMonthlyPct).toBeCloseTo(2, 9)
    expect(f.atCurrentPace).toEqual({ low: null, base: null, high: null })
  })

  it('a seasonal history does not fake a trend (≥ 24 months: the season is removed first)', () => {
    const pattern = [0.8, 0.8, 0.9, 1, 1.1, 1.2, 1.2, 1.1, 1, 1, 0.95, 0.95]
    const h = monthly('2024-10', Array.from({ length: 24 }, (_, k) => 5_000_000 * pattern[(k + 9) % 12]))
    const f = projectCurrentPace(modelInputs({ history: h }))
    expect(f.basis).toBe('history')
    expect(Math.abs(f.trendMonthlyPct!)).toBeLessThan(0.01)
  })

  it('never returns NaN or Infinity, even for an absurd trend', () => {
    const wild = monthly('2025-10', [1, 1, 1, 1, 1, 1, 1e9, 1e9, 1e9, 1e9, 1e9, 1e9])
    const f = projectCurrentPace(modelInputs({ history: wild, goal: { metricKey: 'biz.finansy.vyruchka_god', targetAnnual: 1, deadline: '2031-10-18', months: 60, reviewStatus: 'verified' } }))
    expect(JSON.parse(JSON.stringify(f))).toEqual(f)
  })
})

describe('verdictFor', () => {
  const goal: ModelGoal = { metricKey: 'biz.finansy.vyruchka_god', targetAnnual: 100_000_000, deadline: '2027-10-18', months: 12, reviewStatus: 'verified' }
  const forecast = (base: number | null): Forecast => ({
    atCurrentPace: base === null ? { low: null, base: null, high: null } : { low: base * 0.9, base, high: base * 1.1 },
    trendMonthlyPct: base === null ? null : 1,
    basis: base === null ? 'insufficient' : 'history',
  })
  const verdict = (base: number | null, g: ModelGoal | null = goal) => verdictFor({ goal: g, forecast: forecast(base), baseAnnual: 60_000_000 })

  it('verdict thresholds 0.95 / 0.8 and no_data without forecast or goal', () => {
    expect(verdict(100_000_000).key).toBe('on_track')
    expect(verdict(95_000_000).key).toBe('on_track') // exactly 0.95
    expect(verdict(94_999_999).key).toBe('at_risk')
    expect(verdict(80_000_000).key).toBe('at_risk') // exactly 0.8
    expect(verdict(79_999_999).key).toBe('behind')
    expect(verdict(10_000_000).key).toBe('behind')
    expect(verdict(150_000_000).key).toBe('on_track') // ahead of the plan is still on track
    expect(verdict(null).key).toBe('no_data')
    expect(verdict(90_000_000, null).key).toBe('no_data')
  })

  it('the reason names the numbers of the forecast and the goal', () => {
    const v = verdict(88_000_000)
    expect(v.key).toBe('at_risk')
    expect(v.headline).toBe('Есть риск не дойти до цели')
    expect(v.reason).toContain('88 млн ₸')
    expect(v.reason).toContain('100 млн ₸')
    expect(v.reason).toContain('88%')
    expect(v.reason).toContain('2027-10-18')
    expect(v.reason).toContain('60 млн ₸')
    expect(verdict(100_000_000).headline).toBe('На курсе')
    expect(verdict(10_000_000).headline).toBe('Отстаём от цели')
  })

  it('no_data explains what is missing instead of guessing', () => {
    expect(verdict(null).reason).toMatch(/12 месяцев подряд/)
    expect(verdict(90_000_000, null).reason).toMatch(/не задана/)
    expect(verdict(90_000_000, { ...goal, months: 0 }).key).toBe('no_data')
    expect(verdict(90_000_000, { ...goal, months: 0 }).reason).toMatch(/срок цели/i)
    // a forecast "base" that is null although the basis says history (no goal horizon) is no_data too
    expect(verdictFor({ goal, forecast: { atCurrentPace: { low: null, base: null, high: null }, trendMonthlyPct: 1, basis: 'history' }, baseAnnual: null }).key).toBe('no_data')
    for (const v of [verdict(null), verdict(90_000_000, null), verdict(88_000_000)]) expect(v.reason).not.toMatch(/NaN|undefined|null/)
  })
})
