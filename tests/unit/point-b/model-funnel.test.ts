/**
 * Funnel model (Point B plan Ф2, Task 3): N = L·c, B = new customers of the last 12 months,
 * Orders = N + B·R/12, Revenue = Orders·p·s + other; calibration against the fact; seasonality.
 */
import { describe, expect, it } from 'vitest'
import { calibrate, rotateSeasonality, seasonalityIndex, simulateFunnel, type FunnelParams, type FunnelPath } from '@/lib/point-b/model/funnel'
import { ModelInputError } from '@/lib/point-b/model/types'
import { monthly } from './_model'

const ONES = Array(12).fill(1) as number[]

const params = (over: Partial<FunnelParams> = {}): FunnelParams => ({
  leads: 300, conversion: 0.12, avgCheck: 185_000, repeat: 0, activeBase0: 0, seasonality: ONES, otherMonthly: 0, ...over,
})
const flat = (p: FunnelParams, months: number): FunnelPath => ({
  leads: Array(months).fill(p.leads), conversion: Array(months).fill(p.conversion),
  avgCheck: Array(months).fill(p.avgCheck), repeat: Array(months).fill(p.repeat),
})
const sum = (a: number[]) => a.reduce((x, y) => x + y, 0)

describe('simulateFunnel — golden example', () => {
  it('300 leads × 12% × 185 000 = 36 customers = 6 660 000 ₸ in month 1', () => {
    const p = params()
    const r = simulateFunnel(p, flat(p, 12), 12)
    expect(r.newCustomers[0]).toBeCloseTo(36, 9)
    expect(r.orders[0]).toBeCloseTo(36, 9)
    expect(r.revenue[0]).toBeCloseTo(6_660_000, 4)
    expect(r.revenue).toHaveLength(12)
  })

  it('repeat 0.28 on an active base of 432 gives 36 + 432·0.28/12 = 46.08 orders', () => {
    const p = params({ repeat: 0.28, activeBase0: 432 })
    const r = simulateFunnel(p, flat(p, 12), 12)
    expect(r.orders[0]).toBeCloseTo(46.08, 9)
    expect(r.revenue[0]).toBeCloseTo(46.08 * 185_000, 4)
    // 432 = 12 months × 36 new customers: the base is in steady state, so every month is the same
    for (const rev of r.revenue) expect(rev).toBeCloseTo(8_524_800, 3)
    expect(r.activeBase[11]).toBeCloseTo(432, 9)
  })

  it('the active base is the new customers of the last 12 months (the opening base fades out linearly)', () => {
    const p = params({ activeBase0: 600 }) // more than 12·36 = 432
    const r = simulateFunnel(p, flat(p, 14), 14)
    // after 1 month: 600·11/12 + 36
    expect(r.activeBase[0]).toBeCloseTo(600 * 11 / 12 + 36, 9)
    // after 12 months the opening base is gone completely
    expect(r.activeBase[11]).toBeCloseTo(432, 9)
    expect(r.activeBase[13]).toBeCloseTo(432, 9)
  })

  it('other monthly revenue is added as it is, seasonality scales only the funnel part', () => {
    const season = [...ONES]
    season[0] = 1.5
    const p = params({ otherMonthly: 1_000_000, seasonality: season })
    const r = simulateFunnel(p, flat(p, 12), 12)
    expect(r.revenue[0]).toBeCloseTo(6_660_000 * 1.5 + 1_000_000, 3)
    expect(r.revenue[1]).toBeCloseTo(6_660_000 + 1_000_000, 3)
    // the seasonal index repeats every 12 months
    const r2 = simulateFunnel(p, flat(p, 13), 13)
    expect(r2.revenue[12]).toBeCloseTo(r2.revenue[0], 3)
  })

  it('a path moves the levers month by month', () => {
    const p = params()
    const path = flat(p, 3)
    path.avgCheck = [100_000, 200_000, 300_000]
    const r = simulateFunnel(p, path, 3)
    expect(r.revenue.map((x) => Math.round(x))).toEqual([3_600_000, 7_200_000, 10_800_000])
  })
})

describe('simulateFunnel — properties', () => {
  it('steady state: constant path gives constant revenue after the first 12 months', () => {
    const p = params({ repeat: 0.28, activeBase0: 0 })
    const r = simulateFunnel(p, flat(p, 30), 30)
    // while the base fills up, revenue grows
    expect(r.revenue[1]).toBeGreaterThan(r.revenue[0])
    // from the 13th month on (the base of month 12 is complete) it does not move
    for (let t = 12; t < 30; t++) expect(r.revenue[t]).toBeCloseTo(r.revenue[12], 3)
    // and equals the closed form N·(1+R)·p
    expect(r.revenue[20]).toBeCloseTo(36 * 1.28 * 185_000, 2)
  })

  it('monotonic: raising leads never lowers revenue', () => {
    const p = params({ repeat: 0.3, activeBase0: 200 })
    const base = flat(p, 24)
    const ref = simulateFunnel(p, base, 24).revenue
    for (const bump of [1, 10, 100]) {
      const path = flat(p, 24)
      path.leads = path.leads.map((l, i) => (i >= 5 ? l + bump * (i - 4) : l))
      const r = simulateFunnel(p, path, 24).revenue
      r.forEach((v, i) => expect(v).toBeGreaterThanOrEqual(ref[i] - 1e-6))
      expect(r[23]).toBeGreaterThan(ref[23])
    }
  })

  it('zero path values give zero, never NaN', () => {
    const p = params()
    const zeros = { leads: Array(12).fill(0), conversion: Array(12).fill(0), avgCheck: Array(12).fill(0), repeat: Array(12).fill(0) }
    const r = simulateFunnel(p, zeros, 12)
    for (const series of [r.revenue, r.orders, r.newCustomers, r.activeBase]) {
      expect(series.every((v) => v === 0)).toBe(true)
    }
    // zero months
    expect(simulateFunnel(p, flat(p, 0), 0).revenue).toEqual([])
  })

  it('revenue never goes below zero even with a negative «other revenue»', () => {
    const p = params({ otherMonthly: -10_000_000 })
    const r = simulateFunnel(p, flat(p, 6), 6)
    expect(r.revenue.every((v) => v === 0)).toBe(true)
  })

  it('a month beyond the path keeps the base value of the lever', () => {
    const p = params()
    const r = simulateFunnel(p, { leads: [], conversion: [], avgCheck: [], repeat: [] }, 3)
    expect(r.revenue[2]).toBeCloseTo(6_660_000, 3)
  })

  it('rejects inputs the model cannot work with, with a text for the user', () => {
    const run = (over: Partial<FunnelParams>) => () => simulateFunnel(params(over), flat(params(over), 3), 3)
    expect(run({ avgCheck: 0 })).toThrow(ModelInputError)
    expect(run({ avgCheck: -5 })).toThrow(/чек/i)
    expect(run({ conversion: 1.2 })).toThrow(/конверси/i)
    expect(run({ conversion: -0.1 })).toThrow(ModelInputError)
    expect(run({ leads: -1 })).toThrow(/лид/i)
    expect(run({ repeat: 1.5 })).toThrow(/повтор/i)
    expect(run({ activeBase0: -1 })).toThrow(ModelInputError)
    expect(run({ leads: NaN })).toThrow(ModelInputError)
    expect(run({ seasonality: [1, 1] })).toThrow(/сезонност/i)
    // a path with a bad month
    const p = params()
    const bad = flat(p, 3)
    bad.conversion[1] = 1.5
    expect(() => simulateFunnel(p, bad, 3)).toThrow(ModelInputError)
    bad.conversion[1] = 0.1
    bad.leads[2] = -3
    expect(() => simulateFunnel(p, bad, 3)).toThrow(ModelInputError)
  })
})

describe('calibrate', () => {
  const { otherMonthly: _o, ...cal } = params()
  void _o
  const model12 = 12 * 6_660_000 // 79 920 000

  it('calibrate: model equal to fact gives otherMonthly 0 and ok', () => {
    const r = calibrate({ revenueYear: model12, params: cal })
    expect(r.ok).toBe(true)
    expect(r.otherMonthly).toBeCloseTo(0, 6)
    expect(r.residualShare).toBeCloseTo(0, 9)
  })

  it('residual 10% is absorbed into otherMonthly, 20% gives ok false', () => {
    // fact 88.8M: the model explains 90% of it, the other 10% = 8.88M = 740 000 a month
    const r = calibrate({ revenueYear: 88_800_000, params: cal })
    expect(r.residualShare).toBeCloseTo(0.1, 9)
    expect(r.otherMonthly).toBeCloseTo(740_000, 4)
    expect(r.ok).toBe(true)
    // the calibrated model reproduces the fact exactly
    const p = { ...cal, otherMonthly: r.otherMonthly }
    expect(sum(simulateFunnel(p, flat(p, 12), 12).revenue)).toBeCloseTo(88_800_000, 3)

    // fact 99.9M: the model explains only 80% → does not match
    const bad = calibrate({ revenueYear: 99_900_000, params: cal })
    expect(bad.residualShare).toBeCloseTo(0.2, 9)
    expect(bad.ok).toBe(false)
    expect(bad.otherMonthly).toBe(0)
  })

  it('the model above the fact is calibrated with a negative «other revenue» (within 15%)', () => {
    const r = calibrate({ revenueYear: 72_000_000, params: cal }) // model 79.92M is 11% above
    expect(r.residualShare).toBeLessThan(0)
    expect(r.otherMonthly).toBeLessThan(0)
    expect(r.ok).toBe(true)
    expect(calibrate({ revenueYear: 60_000_000, params: cal }).ok).toBe(false) // 33% above
  })

  it('the 15% border is inclusive and a fact of zero is an input error', () => {
    expect(calibrate({ revenueYear: model12 / 0.85, params: cal }).ok).toBe(true)
    expect(calibrate({ revenueYear: model12 / 0.84, params: cal }).ok).toBe(false)
    expect(() => calibrate({ revenueYear: 0, params: cal })).toThrow(ModelInputError)
    expect(() => calibrate({ revenueYear: NaN, params: cal })).toThrow(ModelInputError)
  })

  it('with a repeat base the calibration counts the repeat orders', () => {
    const rep = { ...cal, repeat: 0.28, activeBase0: 432 }
    const r = calibrate({ revenueYear: 12 * 8_524_800, params: rep })
    expect(r.ok).toBe(true)
    expect(Math.abs(r.otherMonthly)).toBeLessThan(1e-3)
  })
})

describe('seasonalityIndex', () => {
  it('seasonalityIndex with < 24 months defaults to ones and flags defaulted', () => {
    const none = seasonalityIndex([])
    expect(none).toEqual({ index: ONES, defaulted: true })
    const short = seasonalityIndex(monthly('2025-01', Array(23).fill(100)))
    expect(short.defaulted).toBe(true)
    expect(short.index).toEqual(ONES)
  })

  const PATTERN = [0.8, 0.8, 0.9, 1, 1.1, 1.2, 1.2, 1.1, 1, 1, 0.95, 0.95]

  it('with 24 months of a seasonal pattern the index averages 1', () => {
    const history = monthly('2024-01', Array.from({ length: 24 }, (_, i) => 100 * PATTERN[i % 12]))
    const { index, defaulted } = seasonalityIndex(history)
    expect(defaulted).toBe(false)
    expect(index).toHaveLength(12)
    expect(sum(index) / 12).toBeCloseTo(1, 12)
    // the pattern is recovered (the trend fit removes only a tiny slope)
    index.forEach((v, m) => expect(Math.abs(v - PATTERN[m])).toBeLessThan(0.03))
    // calendar order: index[0] is January even if the history starts in March
    const shifted = seasonalityIndex(monthly('2024-03', Array.from({ length: 24 }, (_, i) => 100 * PATTERN[(i + 2) % 12])))
    shifted.index.forEach((v, m) => expect(Math.abs(v - PATTERN[m])).toBeLessThan(0.03))
  })

  it('a growing business without seasonality does not get a seasonal index from its growth', () => {
    const history = monthly('2024-01', Array.from({ length: 36 }, (_, i) => 50 * 1.03 ** i))
    const { index, defaulted } = seasonalityIndex(history)
    expect(defaulted).toBe(false)
    index.forEach((v) => expect(v).toBeCloseTo(1, 6))
  })

  it('growth on top of a seasonal pattern still shows the pattern', () => {
    const history = monthly('2024-01', Array.from({ length: 36 }, (_, i) => 50 * 1.02 ** i * PATTERN[i % 12]))
    const { index } = seasonalityIndex(history)
    index.forEach((v, m) => expect(Math.abs(v - PATTERN[m])).toBeLessThan(0.03))
  })

  it('gaps in the history are tolerated; a calendar month without any data stays neutral', () => {
    const full = monthly('2024-01', Array.from({ length: 30 }, (_, i) => 100 * PATTERN[i % 12]))
    const gappy = full.filter((_, i) => i % 12 !== 5) // June is missing in all three years
    const { index, defaulted } = seasonalityIndex(gappy)
    expect(defaulted).toBe(false)
    expect(sum(index) / 12).toBeCloseTo(1, 12)
    expect(index.every((v) => Number.isFinite(v) && v > 0)).toBe(true)
    // the other months keep their shape (June is near 1 before the other months are normalised)
    expect(index[6]).toBeGreaterThan(index[0])
  })

  it('rotateSeasonality starts the index at the month after now', () => {
    const idx = Array.from({ length: 12 }, (_, m) => m + 1)
    expect(rotateSeasonality(idx, '2026-10-18T09:00:00Z')[0]).toBe(11) // November
    expect(rotateSeasonality(idx, '2026-12-31T09:00:00Z')[0]).toBe(1) // January
    expect(rotateSeasonality(idx, '2026-10-18T09:00:00Z')).toHaveLength(12)
  })
})
