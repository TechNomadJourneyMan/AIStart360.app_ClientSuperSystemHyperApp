/**
 * Pace profiles and the scenario solver (Point B plan Ф2, Task 5).
 *
 * GOLDEN (e-commerce funnel), derived by hand — not a snapshot:
 *   base A = 60 000 000, goal T = 120 000 000 in 12 months, 300 leads × 12% × 140 000 ₸, no repeat.
 *   Funnel in a steady state: 12 · 300·0.12 · 140 000 = 60 480 000, so the fact is explained to
 *   99.2% and «other revenue» = (60 000 000 − 60 480 000)/12 = −40 000 a month.
 *   Gm = (T − 12·other)/60 480 000 = 120 480 000/60 480 000 = 1.992063, ln Gm = 0.689171.
 *   Without repeat the e-commerce mix 0.35/0.25/0.15 is re-normalised over the three levers:
 *   w = 0.4667 / 0.3333 / 0.2, so leads × exp(0.4667·0.689171) = ×1.3794 → 413.8, conversion
 *   × exp(0.3333·0.689171) = ×1.2583 → 15.10%, check × exp(0.2·0.689171) = ×1.1478 → 160 690 ₸.
 *   Their product is Gm, so at the plateau 12·(10 040 000 − 40 000) = 120 000 000 = T exactly.
 *   The levers reach that plateau at month r (ramp 6 / 12 / 18). The goal counts as reached in the
 *   first month t whose monthly run-rate (revenue of the month × 12, seasonality removed) is at least
 *   T — no averaging over three months, which used to add two artificial months. With no repeat the
 *   month's revenue is just L_t·c_t·p_t + other, and the levers move linearly, u(t) = min(1, t/r'),
 *   r' = r/pace, so the run-rate is below T until t = r' and equals T from then on:
 *   time = ceil(r'). Base (pace 1): 18 / 12 / 6. The pace band (default ±20%, no history) moves the
 *   plateau month to r/0.8 and r/1.2:
 *     cautious   r=18: low 18/0.8 = 22.5 → 23, high 18/1.2 = 15 → 15
 *     moderate   r=12: low 12/0.8 = 15,        high 12/1.2 = 10
 *     aggressive r=6:  low  6/0.8 = 7.5 → 8,   high  6/1.2 = 5
 *   Revenue at the deadline (month 12, the run-rate of that month): on or past the plateau it is the
 *   goal exactly (moderate base, aggressive base/low/high, moderate high); otherwise the lever
 *   product at u = 12/r', e.g. cautious base u = 2/3: leads 300 + 113.8·2/3 = 375.9, conversion
 *   12% + 3.10 pp·2/3 = 14.07%, check 140 000 + 20 690·2/3 = 153 793 ₸ → 12·(375.9·0.14067·153 793
 *   − 40 000) = 97.09M; cautious low (u = 12/22.5) 88.77M, cautious high and moderate low
 *   (u = 12/15 = 0.8) 105.89M. The same figures come from an independent month-by-month
 *   calculation.
 *   With repeat purchases the revenue reaches T only when the whole active base has been built at
 *   the target levels: the base of month t−1 is the new customers of months t−12 … t−1 (plus the
 *   fading opening base), so it is complete at t = r' + 12 and not earlier (a strict lag), i.e. the
 *   time is exactly ceil(r') + 12: 30 / 24 / 18 for the services golden and for the repeat case.
 */
import { describe, expect, it } from 'vitest'
import { calibrate, simulateFunnel } from '@/lib/point-b/model/funnel'
import { bandText, volatilityBand } from '@/lib/point-b/model/bands'
import { defaultProfiles, normalizeProfiles } from '@/lib/point-b/model/profiles'
import { LEVER_CAPS, solveFunnelScenario, solveGrowthScenario } from '@/lib/point-b/model/scenarios'
import { ModelInputError, type ModelInputs, type ScenarioProfile, type ScenarioResult } from '@/lib/point-b/model/types'
import { modelInputs, monthly, src } from './_model'

const ONES = Array(12).fill(1) as number[]
const [CAUTIOUS, MODERATE, AGGRESSIVE] = defaultProfiles('ecommerce')

/** Base 60M, check 140 000 → the funnel explains 99.2% of the fact. */
const golden = (over: Parameters<typeof modelInputs>[0] = {}) => modelInputs({ ...over, levers: { avgCheck: src(140_000), ...over.levers } })
const OTHER = -40_000

const solve = (i: ModelInputs, p: ScenarioProfile, other = OTHER) => solveFunnelScenario(i, p, ONES, other)
const trio = (i: ModelInputs, other = OTHER) => [CAUTIOUS, MODERATE, AGGRESSIVE].map((p) => solve(i, p, other))
const uplift = (r: ScenarioResult, lever: string) => r.requiredUplift.find((u) => u.lever === lever)!

describe('profiles', () => {
  it('three profiles differ in ramp, reserve and growth cap, and leverMix sums to 1 for every template', () => {
    for (const template of ['default', 'ecommerce', 'services', 'production'] as const) {
      const [c, m, a] = defaultProfiles(template)
      expect([c.key, m.key, a.key]).toEqual(['cautious', 'moderate', 'aggressive'])
      expect([c.rampMonths, m.rampMonths, a.rampMonths]).toEqual([18, 12, 6])
      expect([c.reserveMonths, m.reserveMonths, a.reserveMonths]).toEqual([3, 2, 1])
      expect([c.growthCapAnnual, m.growthCapAnnual, a.growthCapAnnual]).toEqual([0.25, 0.5, 1])
      expect([c.productivityGain, m.productivityGain, a.productivityGain]).toEqual([0, 0.05, 0.1])
      for (const p of [c, m, a]) {
        const mix = p.leverMix
        expect(mix.leads + mix.conversion + mix.avgCheck + mix.repeat).toBeCloseTo(1, 12)
      }
    }
    expect(defaultProfiles('ecommerce')[0].leverMix).toEqual({ leads: 0.35, conversion: 0.25, avgCheck: 0.15, repeat: 0.25 })
    expect(defaultProfiles('services')[0].leverMix).toEqual({ leads: 0.3, conversion: 0.35, avgCheck: 0.2, repeat: 0.15 })
    expect(defaultProfiles('production')[0].leverMix).toEqual({ leads: 0.25, conversion: 0.25, avgCheck: 0.25, repeat: 0.25 })
    expect(defaultProfiles('default')[1].leverMix).toEqual({ leads: 0.25, conversion: 0.25, avgCheck: 0.25, repeat: 0.25 })
  })

  it('profiles are fresh objects: editing one does not touch the next call', () => {
    const a = defaultProfiles('ecommerce')
    a[0].leverMix.leads = 0.99
    a[0].rampMonths = 1
    expect(defaultProfiles('ecommerce')[0].leverMix.leads).toBe(0.35)
    expect(defaultProfiles('ecommerce')[0].rampMonths).toBe(18)
  })

  it('normalizeProfiles rejects rampMonths 0 or 40 and normalises leverMix', () => {
    expect(() => normalizeProfiles([{ key: 'cautious', rampMonths: 0 }], 'ecommerce')).toThrow(ModelInputError)
    expect(() => normalizeProfiles([{ key: 'cautious', rampMonths: 40 }], 'ecommerce')).toThrow(/от 1 до 36/)
    expect(() => normalizeProfiles([{ key: 'cautious', rampMonths: 7.5 }], 'ecommerce')).toThrow(/целое/)
    expect(() => normalizeProfiles([{ key: 'moderate', reserveMonths: 13 }], 'ecommerce')).toThrow(ModelInputError)
    expect(() => normalizeProfiles([{ key: 'moderate', growthCapAnnual: 0.01 }], 'ecommerce')).toThrow(ModelInputError)
    expect(() => normalizeProfiles([{ key: 'moderate', growthCapAnnual: 3.5 }], 'ecommerce')).toThrow(ModelInputError)
    expect(() => normalizeProfiles([{ key: 'moderate', productivityGain: 0.6 }], 'ecommerce')).toThrow(ModelInputError)
    expect(() => normalizeProfiles([{ key: 'moderate', rampMonths: '12' }], 'ecommerce')).toThrow(ModelInputError)
    expect(() => normalizeProfiles([{ key: 'moderate', leverMix: { leads: -1 } }], 'ecommerce')).toThrow(/отрицательн/)
    expect(() => normalizeProfiles([{ key: 'moderate', leverMix: { leads: 0, conversion: 0, avgCheck: 0, repeat: 0 } }], 'ecommerce')).toThrow(ModelInputError)
    expect(() => normalizeProfiles([{ key: 'turbo' }], 'ecommerce')).toThrow(ModelInputError)
    expect(() => normalizeProfiles([{ key: 'moderate' }, { key: 'moderate' }], 'ecommerce')).toThrow(/дважды/)
    expect(() => normalizeProfiles('moderate', 'ecommerce')).toThrow(ModelInputError)
    expect(() => normalizeProfiles([null], 'ecommerce')).toThrow(ModelInputError)

    const out = normalizeProfiles([{ key: 'moderate', rampMonths: 9, leverMix: { leads: 2, conversion: 1, avgCheck: 1, repeat: 0 } }], 'ecommerce')
    const mod = out.find((p) => p.key === 'moderate')!
    expect(mod.rampMonths).toBe(9)
    expect(mod.leverMix).toEqual({ leads: 0.5, conversion: 0.25, avgCheck: 0.25, repeat: 0 })
    // the other fields of that profile and the other profiles keep their defaults
    expect(mod.growthCapAnnual).toBe(0.5)
    expect(out.find((p) => p.key === 'cautious')).toEqual(CAUTIOUS)
    expect(out).toHaveLength(3)
  })

  it('nothing, an object keyed by profile, or the boundaries are accepted', () => {
    expect(normalizeProfiles(undefined, 'services')).toEqual(defaultProfiles('services'))
    expect(normalizeProfiles(null, 'services')).toEqual(defaultProfiles('services'))
    const byKey = normalizeProfiles({ aggressive: { rampMonths: 1, growthCapAnnual: 3, productivityGain: 0.5, reserveMonths: 0 } }, 'ecommerce')
    expect(byKey[2]).toMatchObject({ key: 'aggressive', rampMonths: 1, growthCapAnnual: 3, productivityGain: 0.5, reserveMonths: 0 })
    expect(normalizeProfiles([{ key: 'cautious', rampMonths: 36 }], 'ecommerce')[0].rampMonths).toBe(36)
    // the label is not editable
    expect(normalizeProfiles([{ key: 'cautious', label: 'что-то своё' }], 'ecommerce')[0].label).toBe('Осторожный')
  })
})

describe('funnel scenarios — golden', () => {
  it('the calibration of the golden client leaves −40 000 ₸ a month of «other revenue»', () => {
    const cal = calibrate({ revenueYear: 60_000_000, params: { leads: 300, conversion: 0.12, avgCheck: 140_000, repeat: 0, activeBase0: 432, seasonality: ONES } })
    expect(cal.ok).toBe(true)
    expect(cal.otherMonthly).toBeCloseTo(OTHER, 6)
    expect(cal.residualShare).toBeCloseTo(-0.008, 9)
  })

  it('cautious reaches the goal later than moderate, moderate later than aggressive (funnel golden: base 60M, goal 120M, 12 months)', () => {
    const [c, m, a] = trio(golden())
    // by hand: the levers reach their target level in month r = 18 / 12 / 6, and that month's run-rate is the goal
    expect([c.timeToGoalMonths.base, m.timeToGoalMonths.base, a.timeToGoalMonths.base]).toEqual([18, 12, 6])
    expect(c.timeToGoalMonths.base!).toBeGreaterThan(m.timeToGoalMonths.base!)
    expect(m.timeToGoalMonths.base!).toBeGreaterThan(a.timeToGoalMonths.base!)
    // the band: the unfavourable case is LATER (low), the favourable EARLIER (high)
    expect([c.timeToGoalMonths.low, m.timeToGoalMonths.low, a.timeToGoalMonths.low]).toEqual([23, 15, 8])
    expect([c.timeToGoalMonths.high, m.timeToGoalMonths.high, a.timeToGoalMonths.high]).toEqual([15, 10, 5])
    for (const r of [c, m, a]) {
      expect(r.timeToGoalMonths.low!).toBeGreaterThanOrEqual(r.timeToGoalMonths.base!)
      expect(r.timeToGoalMonths.base!).toBeGreaterThanOrEqual(r.timeToGoalMonths.high!)
      expect(r.feasible).toBe(true)
      expect(r.infeasibleReason).toBeNull()
    }
  })

  it('the levers needed are the same for every pace and match the hand calculation', () => {
    const [c, m, a] = trio(golden())
    const leads = uplift(a, 'leads')
    expect(leads.current).toBe(300)
    expect(leads.target!).toBeCloseTo(300 * Math.exp((0.35 / 0.75) * Math.log(120_480_000 / 60_480_000)), 6)
    expect(leads.target!).toBeGreaterThan(413.7)
    expect(leads.target!).toBeLessThan(413.9)
    expect(uplift(a, 'conversion').target!).toBeCloseTo(0.151, 3)
    expect(uplift(a, 'avgCheck').target!).toBeCloseTo(160_690, -1)
    expect(uplift(a, 'leads').upliftPct!).toBeCloseTo(37.9, 1)
    expect(uplift(a, 'conversion').upliftPct!).toBeCloseTo(25.8, 1)
    expect(uplift(a, 'avgCheck').upliftPct!).toBeCloseTo(14.8, 1)
    // no repeat in the data → no repeat lever in the list
    expect(a.requiredUplift.map((u) => u.lever)).toEqual(['leads', 'conversion', 'avgCheck'])
    expect(m.requiredUplift).toEqual(a.requiredUplift)
    expect(c.requiredUplift).toEqual(a.requiredUplift)
    // the uplifts share the growth in the proportions of the mix: ln(m_i) / ln(Gm) = w_i
    const lnG = Math.log(120_480_000 / 60_480_000)
    expect(Math.log(leads.target! / 300) / lnG).toBeCloseTo(0.35 / 0.75, 9)
    expect(Math.log(uplift(a, 'conversion').target! / 0.12) / lnG).toBeCloseTo(0.25 / 0.75, 9)
    expect(Math.log(uplift(a, 'avgCheck').target! / 140_000) / lnG).toBeCloseTo(0.15 / 0.75, 9)
  })

  it('the funnel at the target levers really produces the goal (identity against simulateFunnel)', () => {
    const a = solve(golden(), AGGRESSIVE)
    const t = (lever: string) => uplift(a, lever).target!
    const p = { leads: t('leads'), conversion: t('conversion'), avgCheck: t('avgCheck'), repeat: 0, activeBase0: 12 * t('leads') * t('conversion'), seasonality: ONES, otherMonthly: OTHER }
    const plateau = simulateFunnel(p, { leads: [], conversion: [], avgCheck: [], repeat: [] }, 12).revenue
    expect(plateau.reduce((x, y) => x + y, 0)).toBeCloseTo(120_000_000, 0)
  })

  it('revenue at the deadline: by the deadline the fast pace is at the goal, the slow one is not', () => {
    const [c, m, a] = trio(golden())
    // aggressive reaches the plateau (= the goal) in month 6, moderate exactly at month 12: both are on it at the deadline
    expect(a.revenueAtDeadline.base!).toBeCloseTo(120_000_000, 0)
    expect(m.revenueAtDeadline.base!).toBeCloseTo(120_000_000, 0)
    // cautious is late (18 > 12): by hand 12·(375.9·0.14067·153 793 − 40 000) = 97.09M at u = 12/18
    expect(c.revenueAtDeadline.base!).toBeLessThan(120_000_000)
    expect(c.revenueAtDeadline.base!).toBeCloseTo(97_092_564, -4)
    // and more than the base (the levers have started working)
    expect(c.revenueAtDeadline.base!).toBeGreaterThan(60_000_000)
    // the band at the deadline: cautious low u = 12/22.5, cautious high and moderate low u = 0.8; faster paces are on the plateau
    expect(c.revenueAtDeadline.low!).toBeCloseTo(88_772_730, -4)
    expect(c.revenueAtDeadline.high!).toBeCloseTo(105_887_966, -4)
    expect(m.revenueAtDeadline.low!).toBeCloseTo(105_887_966, -4)
    expect(m.revenueAtDeadline.high!).toBeCloseTo(120_000_000, 0)
    expect(a.revenueAtDeadline.low!).toBeCloseTo(120_000_000, 0)
    // identity: a scenario that is late reaches less than the goal at the deadline; one that is not late has reached it
    for (const r of [c, m, a]) {
      if (r.timeToGoalMonths.base! > 12) expect(r.revenueAtDeadline.base!).toBeLessThan(120_000_000 * (1 - 1e-9))
      else expect(r.revenueAtDeadline.base!).toBeGreaterThanOrEqual(120_000_000 * (1 - 1e-9))
      expect(r.revenueAtDeadline.low!).toBeLessThanOrEqual(r.revenueAtDeadline.base!)
      expect(r.revenueAtDeadline.base!).toBeLessThanOrEqual(r.revenueAtDeadline.high!)
    }
  })

  it('every scenario trajectory is non-decreasing and low ≤ base ≤ high at every month', () => {
    for (const r of trio(golden())) {
      expect(r.trajectory[0]).toEqual({ month: 0, low: 60_000_000, base: 60_000_000, high: 60_000_000 })
      r.trajectory.forEach((p, idx) => {
        expect(p.month).toBe(idx)
        expect(p.low).toBeLessThanOrEqual(p.base)
        expect(p.base).toBeLessThanOrEqual(p.high)
        if (idx > 0) {
          const prev = r.trajectory[idx - 1]
          expect(p.low).toBeGreaterThanOrEqual(prev.low)
          expect(p.base).toBeGreaterThanOrEqual(prev.base)
          expect(p.high).toBeGreaterThanOrEqual(prev.high)
        }
      })
      // it covers the goal's deadline and ends on the plateau (the goal, within the rounding of the month)
      expect(r.trajectory.length - 1).toBeGreaterThanOrEqual(12)
      expect(r.trajectory[r.trajectory.length - 1].base).toBeCloseTo(120_000_000, -2)
    }
  })

  it('seasonality changes nothing in the run-rate: it is seasonally adjusted', () => {
    const season = [...ONES]
    season[0] = 1.4
    season[6] = 0.6
    const flat = solve(golden(), MODERATE)
    const seasonal = solveFunnelScenario(golden(), MODERATE, season, OTHER)
    expect(seasonal.timeToGoalMonths).toEqual(flat.timeToGoalMonths)
    expect(seasonal.revenueAtDeadline).toEqual(flat.revenueAtDeadline)
    expect(seasonal.assumptions.join(' ')).toMatch(/Сезонность учтена/)
    expect(flat.assumptions.join(' ')).toMatch(/Сезонность не учтена/)
  })

  it('identical inputs give identical results (determinism)', () => {
    const run = () => JSON.stringify([...trio(golden()), solveGrowthScenario(modelInputs({ template: 'production' }), MODERATE)])
    expect(run()).toBe(run())
  })
})

describe('funnel scenarios — repeat purchases', () => {
  // 432 = 12 × 36: the base is in a steady state; 36 · 1.28 · 108 500 · 12 = 59 996 160 ≈ 60M
  const withRepeat = () => modelInputs({ levers: { avgCheck: src(108_500), repeat: src(0.28) } })
  const other = (60_000_000 - 59_996_160) / 12

  it('the repeat lever takes its share and the plateau still equals the goal', () => {
    const i = withRepeat()
    const a = solve(i, AGGRESSIVE, other)
    expect(a.requiredUplift.map((u) => u.lever)).toEqual(['leads', 'conversion', 'avgCheck', 'repeat'])
    const r = uplift(a, 'repeat')
    expect(r.current).toBe(0.28)
    expect(r.target!).toBeGreaterThan(0.28)
    expect(r.target!).toBeLessThanOrEqual(0.9)
    // (1 + R1)/(1 + R0) = Gm^0.25 with the e-commerce mix
    const gm = (120_000_000 - 12 * other) / (12 * 36 * 1.28 * 108_500)
    expect((1 + r.target!) / 1.28).toBeCloseTo(gm ** 0.25, 9)
    // identity against the simulation: the plateau of the target levers is the goal
    const t = (lever: string) => uplift(a, lever).target!
    const p = { leads: t('leads'), conversion: t('conversion'), avgCheck: t('avgCheck'), repeat: t('repeat'), activeBase0: 12 * t('leads') * t('conversion'), seasonality: ONES, otherMonthly: other }
    const plateau = simulateFunnel(p, { leads: [], conversion: [], avgCheck: [], repeat: [] }, 12).revenue
    expect(plateau.reduce((x, y) => x + y, 0)).toBeCloseTo(120_000_000, 0)
  })

  it('the repeat base catches up with a lag: exactly 12 months after the levers reach the target level (ramp + 12)', () => {
    const rep = trio(withRepeat(), other)
    const none = trio(golden())
    expect(rep.map((r) => r.timeToGoalMonths.base)).toEqual(rep.map((r) => r.timeToGoalMonths.base).sort((x, y) => y! - x!))
    // by hand: the base of month t−1 covers the new customers of months t−12 … t−1, so it is built at the target
    // levels only from t = ramp + 12 (and the opening base is gone by then): 30 / 24 / 18; the band: ceil(ramp/0.8 | ramp/1.2) + 12
    expect(rep.map((r) => r.timeToGoalMonths.base)).toEqual([30, 24, 18])
    expect(rep.map((r) => r.timeToGoalMonths.low)).toEqual([35, 27, 20])
    expect(rep.map((r) => r.timeToGoalMonths.high)).toEqual([27, 22, 17])
    rep.forEach((r, k) => {
      const ramp = [18, 12, 6][k]
      expect(r.timeToGoalMonths.base!).toBeGreaterThan(ramp)
      expect(r.timeToGoalMonths.base!).toBeLessThanOrEqual(ramp + 12)
      expect(r.timeToGoalMonths.base!).toBeGreaterThan(none[k].timeToGoalMonths.base!)
    })
    expect(rep[2].timeToGoalMonths.base!).toBeGreaterThan(none[2].timeToGoalMonths.base!)
  })

  it('without a stated repeat its share goes to the other levers, and the assumption says so', () => {
    const a = solve(golden(), AGGRESSIVE)
    expect(a.assumptions.join(' ')).toMatch(/Повторные продажи не заданы: учтены как 0%/)
    expect(a.assumptions.join(' ')).toMatch(/перераспределена/)
    expect(a.assumptions.join(' ')).toMatch(/выведена: лиды × конверсия × 12/)
  })

  it('a profile with all its weight on repeat but no repeat data falls back to equal shares', () => {
    const p: ScenarioProfile = { ...AGGRESSIVE, leverMix: { leads: 0, conversion: 0, avgCheck: 0, repeat: 1 } }
    const r = solve(golden(), p)
    expect(r.requiredUplift).toHaveLength(3)
    const lnG = Math.log(120_480_000 / 60_480_000)
    expect(Math.log(uplift(r, 'leads').target! / 300) / lnG).toBeCloseTo(1 / 3, 9)
  })
})

describe('funnel scenarios — limits and edges', () => {
  it('goal below the base revenue gives time 0 and no uplift', () => {
    const i = golden({ goal: { metricKey: 'biz.finansy.vyruchka_god', targetAnnual: 50_000_000, deadline: '2027-10-18', months: 12, reviewStatus: 'verified' } })
    for (const r of trio(i)) {
      expect(r.timeToGoalMonths).toEqual({ low: 0, base: 0, high: 0 })
      expect(r.requiredUplift).toEqual([])
      expect(r.feasible).toBe(true)
      expect(r.revenueAtDeadline).toEqual({ low: 60_000_000, base: 60_000_000, high: 60_000_000 })
      expect(r.trajectory.every((p) => p.base === 60_000_000)).toBe(true)
      expect(r.risks.join(' ')).toMatch(/потерять текущий уровень/)
    }
  })

  it('an uplift above a lever cap makes the scenario infeasible with a reason', () => {
    // ×10: conversion would have to be ×2.15, the cap is ×2 (and 60%)
    const i = golden({ goal: { metricKey: 'biz.finansy.vyruchka_god', targetAnnual: 600_000_000, deadline: '2027-10-18', months: 12, reviewStatus: 'verified' } })
    for (const r of trio(i)) {
      expect(r.feasible).toBe(false)
      expect(r.infeasibleReason).toMatch(/Конверсия/)
      expect(r.infeasibleReason).toMatch(/потолок реализуемости/)
      // it is not shown as reachable: the capped levers cannot produce the goal
      expect(r.timeToGoalMonths.base).toBeNull()
      expect(r.revenueAtDeadline.base!).toBeLessThan(600_000_000)
      // the requirement itself is still shown
      expect(uplift(r, 'conversion').target!).toBeGreaterThan(0.12 * LEVER_CAPS.conversionTimes)
    }
    // an absurd goal breaks several caps at once and the reason lists them
    const absurd = golden({ goal: { metricKey: 'biz.finansy.vyruchka_god', targetAnnual: 6_000_000_000, deadline: '2027-10-18', months: 12, reviewStatus: 'verified' } })
    const reason = solve(absurd, AGGRESSIVE).infeasibleReason!
    expect(reason).toMatch(/Лиды/)
    expect(reason).toMatch(/Средний чек/)
  })

  it('a conversion already above the 60% ceiling cannot be raised further', () => {
    const i = golden({ levers: { conversion: src(0.7), leads: src(30), avgCheck: src(140_000), activeBase: src(null) } })
    const base = 12 * 21 * 140_000
    const cal = calibrate({ revenueYear: base, params: { leads: 30, conversion: 0.7, avgCheck: 140_000, repeat: 0, activeBase0: 12 * 21, seasonality: ONES } })
    const r = solve({ ...i, base: { ...i.base, revenueYear: src(base) }, goal: { ...i.goal!, targetAnnual: base * 1.5 } }, MODERATE, cal.otherMonthly)
    expect(r.feasible).toBe(false)
    expect(r.infeasibleReason).toMatch(/Конверсия/)
  })

  it('no CAC gives marketingMonthlyIncrease null and the note asks for CAC', () => {
    const r = solve(golden(), MODERATE)
    expect(r.investments.marketingMonthlyIncrease).toBeNull()
    expect(r.investments.totalOverRamp).toBeNull()
    expect(r.investments.note).toMatch(/CAC/)
    expect(r.investments.note).toMatch(/уровня 2/)
  })

  it('with CAC the extra marketing is Δleads × conversion × CAC, and the total over the ramp is its linear build-up', () => {
    const i = golden({ levers: { cac: src(50_000) } })
    const m = solve(i, MODERATE)
    const dLeads = uplift(m, 'leads').target! - 300
    const c1 = uplift(m, 'conversion').target!
    expect(m.investments.marketingMonthlyIncrease!).toBeCloseTo(dLeads * c1 * 50_000, -1)
    // 12 months of a linear build-up: Δ · (1 + 2 + … + 12)/12 = Δ · 6.5
    expect(m.investments.totalOverRamp!).toBeCloseTo(m.investments.marketingMonthlyIncrease! * 6.5, -2)
    const [c, , a] = trio(i)
    // a longer ramp spends more in total but less per month at the start; the monthly plateau is the same
    expect(c.investments.marketingMonthlyIncrease).toBe(a.investments.marketingMonthlyIncrease)
    expect(c.investments.totalOverRamp!).toBeGreaterThan(a.investments.totalOverRamp!)
    expect(c.investments.totalOverRamp!).toBeCloseTo(c.investments.marketingMonthlyIncrease! * 9.5, -2)
    expect(a.investments.totalOverRamp!).toBeCloseTo(a.investments.marketingMonthlyIncrease! * 3.5, -2)
    expect(m.investments.note).not.toMatch(/Нужен CAC/)
  })

  it('no headcount gives staffNeed null; with headcount it follows revenue per employee and productivity', () => {
    expect(solve(golden(), MODERATE).investments.staffNeed).toBeNull()
    expect(solve(golden(), MODERATE).investments.note).toMatch(/число сотрудников/)
    const i = golden({ levers: { headcount: src(14) } })
    const [c, m, a] = trio(i)
    // 14 people for 60M; the goal doubles revenue: 28 people at the same productivity
    expect(c.investments.staffNeed).toBe(14) // gain 0 → 28 − 14
    expect(m.investments.staffNeed).toBe(13) // ceil(28/1.05) = 27
    expect(a.investments.staffNeed).toBe(12) // ceil(28/1.10) = 26
    // a goal below the base needs nobody
    expect(solve(golden({ levers: { headcount: src(14) }, goal: { metricKey: 'biz.finansy.vyruchka_god', targetAnnual: 50_000_000, deadline: '2027-10-18', months: 12, reviewStatus: 'verified' } }), MODERATE).investments.staffNeed).toBe(0)
  })

  it('the pace band is the volatility of the history when there is enough of it', () => {
    const noisy = Array.from({ length: 18 }, (_, k) => 5_000_000 * (1 + (k % 2 === 0 ? 0.04 : -0.03)) * 1.01 ** k)
    const i = golden({ history: monthly('2025-04', noisy) })
    const band = volatilityBand(i.history)
    expect(band.source).toBe('history')
    const r = solve(i, AGGRESSIVE)
    expect(r.assumptions.join(' ')).toMatch(/волатильности выручки/)
    // a calmer history gives a narrower pace band than the 20% default: the range is tighter
    const calm = solve(golden(), AGGRESSIVE)
    expect(calm.assumptions.join(' ')).toMatch(/источник — по умолчанию \(±20%\): мало данных, диапазон широкий/)
    expect(r.timeToGoalMonths.low! - r.timeToGoalMonths.high!).toBeLessThanOrEqual(calm.timeToGoalMonths.low! - calm.timeToGoalMonths.high!)
  })

  it('the texts exist, are in Russian and carry no NaN / undefined / doubled full stops', () => {
    const results = [...trio(golden({ levers: { cac: src(50_000), headcount: src(14) } })), ...[CAUTIOUS, MODERATE, AGGRESSIVE].map((p) => solveGrowthScenario(modelInputs({ template: 'production' }), p))]
    for (const r of results) {
      const texts = [r.downside, r.investments.note, r.infeasibleReason ?? '', ...r.constraints, ...r.risks, ...r.conditions, ...r.reviewPoints, ...r.signsToChangePace, ...r.assumptions]
      expect(r.downside.length).toBeGreaterThan(20)
      expect(r.risks.length).toBeGreaterThan(0)
      expect(r.conditions.length).toBeGreaterThan(0)
      expect(r.reviewPoints.length).toBeGreaterThan(0)
      expect(r.signsToChangePace.length).toBeGreaterThan(0)
      expect(r.assumptions.length).toBeGreaterThan(2)
      for (const t of texts) expect(t, t).not.toMatch(/NaN|undefined|Infinity|null|\.\./)
      // the money risk is always flagged as not estimated
      expect(r.risks.join(' ')).toMatch(/Кассовый разрыв не оценён: нет данных о деньгах \(уровень 2\)/)
      expect(r.assumptions.join(' ')).toMatch(/Вероятность достижения цели не вычисляется/)
    }
  })

  it('refuses a funnel without leads, conversion or a check, and a model without a goal', () => {
    expect(() => solve(golden({ levers: { leads: src(null) } }), MODERATE)).toThrow(ModelInputError)
    expect(() => solve(golden({ levers: { conversion: src(1.2) } }), MODERATE)).toThrow(ModelInputError)
    expect(() => solve(golden({ goal: null }), MODERATE)).toThrow(/цели/)
    expect(() => solve(golden({ base: { revenueYear: src(null), ageMonths: null, stale: false } }), MODERATE)).toThrow(/базов/)
    expect(() => solveGrowthScenario(modelInputs({ goal: null }), MODERATE)).toThrow(ModelInputError)
  })
})

describe('growth model scenarios', () => {
  const growthInputs = (over: Parameters<typeof modelInputs>[0] = {}) => modelInputs({ template: 'production', ...over })
  const [c, m, a] = ['cautious', 'moderate', 'aggressive'].map((k) => defaultProfiles('production').find((p) => p.key === k)!)

  it('growth model: cap 25% annual cannot reach ×2 in 12 months, time-to-goal ≈ 37 months, revenueAtDeadline = base·1.25', () => {
    const r = solveGrowthScenario(growthInputs(), c)
    // 12·ln2/ln1.25 = 37.27 months → the first whole month at or above the goal is 38
    expect(r.timeToGoalMonths.base).toBe(38)
    expect(r.timeToGoalMonths.base!).toBeGreaterThanOrEqual(37)
    expect(r.revenueAtDeadline.base!).toBeCloseTo(75_000_000, 3)
    expect(r.feasible).toBe(false)
    expect(r.infeasibleReason).toMatch(/потолок этого сценария — 25%/)
    expect(r.requiredUplift).toEqual([{ lever: 'growth', label: 'Годовой рост выручки', current: null, target: 0.25, upliftPct: null }])
    expect(r.investments.marketingMonthlyIncrease).toBeNull()
    expect(r.investments.note).toMatch(/Упрощённая модель/)
  })

  it('three paces: the faster the cap, the earlier the goal; only the one whose cap covers the requirement is feasible', () => {
    const [rc, rm, ra] = [c, m, a].map((p) => solveGrowthScenario(growthInputs(), p))
    expect([rc.timeToGoalMonths.base, rm.timeToGoalMonths.base, ra.timeToGoalMonths.base]).toEqual([38, 21, 12])
    expect([rc.feasible, rm.feasible, ra.feasible]).toEqual([false, false, true])
    expect(ra.revenueAtDeadline.base!).toBeCloseTo(120_000_000, 3)
    expect(rm.revenueAtDeadline.base!).toBeCloseTo(90_000_000, 3)
    expect(ra.requiredUplift[0].target!).toBeCloseTo(1, 9)
    for (const r of [rc, rm, ra]) {
      expect(r.timeToGoalMonths.low!).toBeGreaterThanOrEqual(r.timeToGoalMonths.base!)
      expect(r.timeToGoalMonths.base!).toBeGreaterThanOrEqual(r.timeToGoalMonths.high!)
      expect(r.revenueAtDeadline.low!).toBeLessThanOrEqual(r.revenueAtDeadline.base!)
      expect(r.revenueAtDeadline.base!).toBeLessThanOrEqual(r.revenueAtDeadline.high!)
      // the band is on growth: 20% slower than 100% a year is 80%
      r.trajectory.forEach((p) => {
        expect(p.low).toBeLessThanOrEqual(p.base)
        expect(p.base).toBeLessThanOrEqual(p.high)
      })
    }
    // 80% a year: 12·ln2/ln1.8 = 14.15 → 15
    expect(ra.timeToGoalMonths.low).toBe(15)
    // the cap also limits the favourable case
    expect(ra.timeToGoalMonths.high).toBe(12)
  })

  it('a modest goal is reached by the deadline at the growth it needs, not at the cap', () => {
    const i = growthInputs({ goal: { metricKey: 'biz.finansy.vyruchka_god', targetAnnual: 66_000_000, deadline: '2027-10-18', months: 12, reviewStatus: 'verified' } })
    for (const p of [c, m, a]) {
      const r = solveGrowthScenario(i, p)
      expect(r.feasible).toBe(true)
      expect(r.requiredUplift[0].target!).toBeCloseTo(0.1, 9)
      expect(r.timeToGoalMonths.base).toBe(12)
      expect(r.revenueAtDeadline.base!).toBeCloseTo(66_000_000, 3)
    }
  })

  it('goal below the base: time 0, no uplift; no headcount gives staffNeed null', () => {
    const r = solveGrowthScenario(growthInputs({ goal: { metricKey: 'biz.finansy.vyruchka_god', targetAnnual: 50_000_000, deadline: '2027-10-18', months: 12, reviewStatus: 'verified' } }), m)
    expect(r.timeToGoalMonths).toEqual({ low: 0, base: 0, high: 0 })
    expect(r.requiredUplift).toEqual([])
    expect(r.investments.staffNeed).toBeNull()
    expect(r.feasible).toBe(true)
  })

  it('staff need in the growth model follows the same rule as in the funnel', () => {
    const r = solveGrowthScenario(growthInputs({ levers: { headcount: src(10) } }), a)
    expect(r.investments.staffNeed).toBe(9) // ceil(20/1.1) = 19
  })

  it('a deadline beyond the model horizon is clamped to 60 months in the solver (the orchestrator refuses it earlier)', () => {
    const r = solveGrowthScenario(growthInputs({ goal: { metricKey: 'biz.finansy.vyruchka_god', targetAnnual: 120_000_000, deadline: '2033-10-18', months: 84, reviewStatus: 'verified' } }), m)
    expect(r.trajectory.length - 1).toBeLessThanOrEqual(60)
    expect(r.trajectory.every((p) => Number.isFinite(p.base))).toBe(true)
  })
})

describe('bands', () => {
  it('volatilityBand defaults to 0.2 with fewer than 12 monthly points', () => {
    expect(volatilityBand([])).toEqual({ delta: 0.2, source: 'default' })
    expect(volatilityBand(monthly('2026-01', Array(11).fill(100)))).toEqual({ delta: 0.2, source: 'default' })
    // 12 points with a hole are not 12 in a row
    const gappy = monthly('2025-01', Array(13).fill(100)).filter((_, k) => k !== 6)
    expect(volatilityBand(gappy).source).toBe('default')
  })

  it('with 12 months in a row it is the standard deviation of the monthly growth, kept within 5–50%', () => {
    const calm = volatilityBand(monthly('2025-10', Array.from({ length: 12 }, (_, k) => 100 * 1.02 ** k)))
    expect(calm).toEqual({ delta: 0.05, source: 'history' }) // no deviation at all → the lower bound
    const wild = volatilityBand(monthly('2025-10', [100, 300, 90, 350, 80, 400, 70, 420, 60, 450, 50, 500]))
    expect(wild).toEqual({ delta: 0.5, source: 'history' })
    const mid = volatilityBand(monthly('2025-10', Array.from({ length: 12 }, (_, k) => 100 * (k % 2 === 0 ? 1.15 : 1))))
    expect(mid.source).toBe('history')
    expect(mid.delta).toBeGreaterThan(0.05)
    expect(mid.delta).toBeLessThan(0.5)
  })

  it('the text of the band names its source', () => {
    expect(bandText({ delta: 0.2, source: 'default' })).toMatch(/мало данных/)
    expect(bandText({ delta: 0.1, source: 'history' })).toMatch(/волатильности/)
  })
})
