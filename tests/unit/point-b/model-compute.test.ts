/**
 * computeModel — the orchestrator (Point B plan Ф2, Task 6): golden results per template and the
 * edge cases of the review focus. Golden numbers are derived by hand (see model-scenarios.test.ts for
 * the e-commerce derivation); the tests also pin ordering and bounds, so they are not snapshots.
 */
import { describe, expect, it } from 'vitest'
import { computeModel } from '@/lib/point-b/model/compute'
import { simulateFunnel } from '@/lib/point-b/model/funnel'
import { defaultProfiles } from '@/lib/point-b/model/profiles'
import { MODEL_VERSION, type ModelGoal, type ModelInputs, type ModelResult } from '@/lib/point-b/model/types'
import { modelInputs, monthly, NOW, src } from './_model'

const ONES = Array(12).fill(1) as number[]
const goal = (over: Partial<ModelGoal> = {}): ModelGoal => ({ metricKey: 'biz.finansy.vyruchka_god', targetAnnual: 120_000_000, deadline: '2027-10-18', months: 12, reviewStatus: 'verified', ...over })
/** Base 60M and a check of 140 000 → the funnel explains 99.2% of the fact (see model-scenarios.test.ts). */
const ecommerce = (over: Parameters<typeof modelInputs>[0] = {}) => modelInputs({ ...over, levers: { avgCheck: src(140_000), ...over.levers } })
const times = (r: ModelResult) => r.scenarios.map((s) => s.timeToGoalMonths.base)
const hasWarning = (r: ModelResult, re: RegExp) => r.warnings.some((w) => re.test(w))
const jsonSafe = (r: ModelResult) => expect(JSON.parse(JSON.stringify(r))).toEqual(r)

function expectCleanResult(r: ModelResult) {
  jsonSafe(r)
  const texts = [
    ...r.warnings, r.verdict.headline, r.verdict.reason,
    ...r.missing.flatMap((m) => [m.label, m.unlocks]),
    ...r.scenarios.flatMap((s) => [s.downside, s.infeasibleReason ?? '', s.investments.note, ...s.constraints, ...s.risks, ...s.conditions, ...s.reviewPoints, ...s.signsToChangePace, ...s.assumptions]),
  ]
  for (const t of texts) expect(t, t).not.toMatch(/NaN|undefined|Infinity|\[object|\.\./)
}

describe('level 0', () => {
  it('level 0 for no goal: gap null, scenarios [], missing lists goal', () => {
    const r = computeModel(modelInputs({ goal: null }))
    expect(r.level).toBe(0)
    expect(r.kind).toBe('none')
    expect(r.scenarios).toEqual([])
    expect(r.gap).toEqual({ baseAnnual: 60_000_000, targetAnnual: null, absolute: null, multiplier: null, requiredCagrPct: null, months: null })
    expect(r.missing.map((m) => m.key)).toEqual(['goal'])
    expect(r.missing[0].actions).toEqual(['survey', 'expert'])
    expect(r.forecast).toEqual({ atCurrentPace: { low: null, base: null, high: null }, trendMonthlyPct: null, basis: 'insufficient' })
    expect(r.verdict.key).toBe('no_data')
    expect(r.modelVersion).toBe(MODEL_VERSION)
    expect(r.modelVersion).toBe('pb-model-2')
    expectCleanResult(r)
  })

  it('no base revenue: the gap is empty, the base is listed as missing', () => {
    const r = computeModel(modelInputs({ base: { revenueYear: src(null), ageMonths: null, stale: false } }))
    expect(r.level).toBe(0)
    expect(r.gap.baseAnnual).toBeNull()
    expect(r.gap.targetAnnual).toBe(120_000_000)
    expect(r.gap.absolute).toBeNull()
    expect(r.missing.map((m) => m.key)).toEqual(['revenue_base'])
    expect(r.scenarios).toEqual([])
    expectCleanResult(r)
  })

  it('goal and base are given: the gap is exact even when the level is higher', () => {
    const r = computeModel(ecommerce())
    expect(r.gap).toMatchObject({ baseAnnual: 60_000_000, targetAnnual: 120_000_000, absolute: 60_000_000, multiplier: 2, months: 12 })
    expect(r.gap.requiredCagrPct).toBeCloseTo(100, 9)
    // 24 months: sqrt(2) − 1
    expect(computeModel(ecommerce({ goal: goal({ months: 24 }) })).gap.requiredCagrPct).toBeCloseTo((Math.SQRT2 - 1) * 100, 9)
  })
})

describe('golden — one per template', () => {
  it('e-commerce golden: base 60M, goal 120M/12m, 300 leads, conv 12%, check 140k gives level 1 funnel, 3 scenarios with strictly increasing speed', () => {
    const r = computeModel(ecommerce())
    expect(r).toMatchObject({ level: 1, kind: 'funnel', template: 'ecommerce' })
    expect(r.scenarios.map((s) => s.key)).toEqual(['cautious', 'moderate', 'aggressive'])
    // by hand: the levers reach their target level in month 18 / 12 / 6 and that month's run-rate is the goal
    expect(times(r)).toEqual([18, 12, 6])
    for (let k = 1; k < 3; k++) expect(times(r)[k]!).toBeLessThan(times(r)[k - 1]!)
    expect(r.scenarios.every((s) => s.feasible)).toBe(true)
    // bounds, not only values
    for (const s of r.scenarios) {
      expect(s.revenueAtDeadline.base!).toBeGreaterThan(60_000_000)
      expect(s.revenueAtDeadline.base!).toBeLessThanOrEqual(120_000_000 * (1 + 1e-9))
      if (s.timeToGoalMonths.base! > 12) expect(s.revenueAtDeadline.base!).toBeLessThan(120_000_000)
    }
    expect(r.scenarios[2].revenueAtDeadline.base!).toBeCloseTo(120_000_000, 0)
    expect(r.missing.map((m) => m.key)).toEqual(['repeat', 'cac', 'headcount'])
    expect(r.warnings).toEqual([
      'Истории выручки по месяцам нет: прогноз «при текущем ходе» не строится.',
      'Сезонность не учтена: в истории выручки меньше 24 месяцев, использован индекс 1,0.',
    ])
    expect(r.verdict.key).toBe('no_data') // no history
    expect(r.computedAt).toBe(NOW.toISOString())
    expectCleanResult(r)
  })

  it('services golden: 40 leads × 25% × 250 000 ₸ with 20% repeat; base 36M → goal 54M (×1.5)', () => {
    // 10 new customers a month, an active base of 120: the funnel is 12·10·1.2·250 000 = 36 000 000 = the fact, so «other revenue» is 0.
    const i = modelInputs({
      template: 'services',
      base: { revenueYear: src(36_000_000), ageMonths: 0, stale: false },
      levers: { leads: src(40), conversion: src(0.25), avgCheck: src(250_000), repeat: src(0.2), activeBase: src(120, 'derived') },
      goal: goal({ targetAnnual: 54_000_000 }),
    })
    const r = computeModel(i)
    expect(r).toMatchObject({ level: 1, kind: 'funnel', template: 'services' })
    const up = (lever: string) => r.scenarios[0].requiredUplift.find((u) => u.lever === lever)!
    // Gm = 1.5; the services mix is 0.30 / 0.35 / 0.20 / 0.15 → by hand ln m_i = w_i·ln 1.5
    expect(up('leads').target!).toBeCloseTo(45.17, 2) // 40·1.5^0.30
    expect(up('conversion').target!).toBeCloseTo(0.2881, 4) // 0.25·1.5^0.35
    expect(up('avgCheck').target!).toBeCloseTo(271_117, -1) // 250 000·1.5^0.20
    expect(up('repeat').target!).toBeCloseTo(0.27525, 4) // 1.2·1.5^0.15 − 1
    // the levers at their targets keep 12 months at the goal (identity against the simulation)
    const t = (lever: string) => up(lever).target!
    const p = { leads: t('leads'), conversion: t('conversion'), avgCheck: t('avgCheck'), repeat: t('repeat'), activeBase0: 12 * t('leads') * t('conversion'), seasonality: ONES, otherMonthly: 0 }
    const plateau = simulateFunnel(p, { leads: [], conversion: [], avgCheck: [], repeat: [] }, 12).revenue.reduce((a, b) => a + b, 0)
    expect(plateau).toBeCloseTo(54_000_000, 0)
    // ordering and the lag: the repeat base is built at the target levels 12 months after the levers reach them,
    // so (by hand, see model-scenarios.test.ts) the goal is reached in month ramp + 12: 30 / 24 / 18
    const ts = times(r)
    expect(ts).toEqual([30, 24, 18])
    expect(ts[0]!).toBeGreaterThan(ts[1]!)
    expect(ts[1]!).toBeGreaterThan(ts[2]!)
    ;[18, 12, 6].forEach((ramp, k) => {
      expect(ts[k]!).toBeGreaterThan(ramp)
      expect(ts[k]!).toBeLessThanOrEqual(ramp + 12)
    })
    expect(r.missing.map((m) => m.key)).toEqual(['cac', 'headcount'])
    expectCleanResult(r)
  })

  it('production golden: no funnel in the template → the growth model, 25% / 50% / 100% caps', () => {
    const r = computeModel(modelInputs({ template: 'production' }))
    expect(r).toMatchObject({ level: 1, kind: 'growth', template: 'production' })
    expect(times(r)).toEqual([38, 21, 12]) // 12·ln2/ln(1+cap), rounded up
    expect(r.scenarios.map((s) => s.feasible)).toEqual([false, false, true])
    expect(r.scenarios[0].revenueAtDeadline.base!).toBeCloseTo(75_000_000, 3)
    expect(r.scenarios[1].revenueAtDeadline.base!).toBeCloseTo(90_000_000, 3)
    expect(r.scenarios[2].revenueAtDeadline.base!).toBeCloseTo(120_000_000, 3)
    // the funnel levers are there but not used, and are not asked for
    expect(r.missing.map((m) => m.key)).toEqual(['headcount'])
    expect(hasWarning(r, /не сходится/)).toBe(false)
    expectCleanResult(r)
  })

  it('default golden: base 100M → 130M in 24 months needs 14.0% a year; every pace has the room for it', () => {
    const r = computeModel(modelInputs({
      template: 'default',
      base: { revenueYear: src(100_000_000), ageMonths: 0, stale: false },
      levers: { leads: src(null), conversion: src(null), avgCheck: src(null), activeBase: src(null) },
      goal: goal({ targetAnnual: 130_000_000, months: 24, deadline: '2028-10-18' }),
    }))
    expect(r).toMatchObject({ level: 1, kind: 'growth', template: 'default' })
    expect(r.gap.requiredCagrPct!).toBeCloseTo((Math.sqrt(1.3) - 1) * 100, 9) // 14.02%
    expect(times(r)).toEqual([24, 24, 24])
    for (const s of r.scenarios) {
      expect(s.feasible).toBe(true)
      expect(s.revenueAtDeadline.base!).toBeCloseTo(130_000_000, 2)
      expect(s.requiredUplift[0].target!).toBeCloseTo(Math.sqrt(1.3) - 1, 9)
    }
    // the missing funnel inputs are listed with what they unlock
    expect(r.missing.map((m) => m.key)).toEqual(['leads', 'conversion', 'avgCheck', 'headcount'])
    expectCleanResult(r)
  })
})

describe('the funnel against the fact', () => {
  it('a funnel not matching the fact by 25% falls back to growth with a warning', () => {
    // 300·0.12·185 000·12 = 79.92M against a fact of 64M: the funnel overshoots by 25%
    const r = computeModel(modelInputs({ base: { revenueYear: src(64_000_000), ageMonths: 0, stale: false } }))
    expect(r.level).toBe(1)
    expect(r.kind).toBe('growth')
    expect(r.scenarios).toHaveLength(3)
    expect(r.scenarios[0].assumptions.join(' ')).toMatch(/упрощённая/)
    expect(r.warnings.find((w) => /не сходится с фактом на 25%/.test(w))).toBeTruthy()
    expect(r.missing.map((m) => m.key)).not.toContain('cac')
    expectCleanResult(r)
  })

  it('a funnel that explains less than 85% of the fact falls back too', () => {
    // 300·0.12·100 000·12 = 43.2M against 60M: the funnel explains 72%
    const r = computeModel(modelInputs({ levers: { avgCheck: src(100_000) } }))
    expect(r.kind).toBe('growth')
    expect(r.warnings.find((w) => /не сходится с фактом на 28%/.test(w))).toBeTruthy()
  })

  it('custom profiles are used; an unusable profile is a warning at level 0, not a throw', () => {
    const profiles = defaultProfiles('ecommerce')
    profiles[1] = { ...profiles[1], rampMonths: 3 }
    const r = computeModel(ecommerce(), profiles)
    expect(r.scenarios[1].timeToGoalMonths.base).toBe(3) // the levers reach the plateau in month 3 and that month's run-rate is the goal
    const bad = computeModel(ecommerce(), [{ ...profiles[0], rampMonths: 0 }, profiles[1], profiles[2]])
    expect(bad.level).toBe(0)
    expect(bad.scenarios).toEqual([])
    expect(bad.warnings.join(' ')).toMatch(/Срок выхода рычагов/)
  })
})

describe('aberrant inputs — warnings, never a throw', () => {
  it('goal below base: a warning, time 0, no uplift', () => {
    const r = computeModel(ecommerce({ goal: goal({ targetAnnual: 50_000_000 }) }))
    expect(r.level).toBe(1)
    expect(hasWarning(r, /не выше текущей годовой выручки/)).toBe(true)
    expect(r.gap.absolute).toBe(-10_000_000)
    expect(r.gap.multiplier!).toBeLessThan(1)
    for (const s of r.scenarios) {
      expect(s.timeToGoalMonths).toEqual({ low: 0, base: 0, high: 0 })
      expect(s.requiredUplift).toEqual([])
    }
    expectCleanResult(r)
  })

  it('goal in the past, months 0 and months 70 produce warnings and no throw', () => {
    const past = computeModel(ecommerce({ goal: goal({ months: 0, deadline: '2026-01-31' }) }))
    expect(past.level).toBe(0)
    expect(past.scenarios).toEqual([])
    expect(hasWarning(past, /уже прошёл/)).toBe(true)
    expect(past.verdict.key).toBe('no_data')
    expect(past.gap.months).toBe(0)
    expect(past.gap.requiredCagrPct).toBeNull()
    expectCleanResult(past)

    const far = computeModel(ecommerce({ goal: goal({ months: 70, deadline: '2032-08-18' }) }))
    expect(far.level).toBe(0)
    expect(far.scenarios).toEqual([])
    expect(hasWarning(far, /не дальше 60 мес/)).toBe(true)
    expect(far.gap.months).toBe(70)
    expectCleanResult(far)

    // 60 months is the edge and is allowed
    const edge = computeModel(ecommerce({ goal: goal({ months: 60, deadline: '2031-10-18' }) }))
    expect(edge.level).toBe(1)
    expect(edge.scenarios[0].trajectory.length - 1).toBeLessThanOrEqual(60)
    expectCleanResult(edge)
  })

  it('a deadline within a month is calculated for one month with a warning', () => {
    const r = computeModel(ecommerce({ goal: goal({ months: 1, deadline: '2026-11-02' }) }))
    expect(r.level).toBe(1)
    expect(hasWarning(r, /меньше месяца/)).toBe(true)
    expectCleanResult(r)
  })

  it('conversion 120% or check 0 gives level 0 with a warning, no NaN anywhere (JSON round-trip has no null from NaN)', () => {
    const conv = computeModel(ecommerce({ levers: { conversion: src(1.2) } }))
    expect(conv.level).toBe(0)
    expect(conv.scenarios).toEqual([])
    expect(hasWarning(conv, /Конверсия 120% не может быть больше 100%/)).toBe(true)
    expect(conv.missing.map((m) => m.key)).toContain('conversion')
    // the gap is still given: it needs only the base and the goal
    expect(conv.gap.multiplier).toBe(2)
    expectCleanResult(conv)

    const zero = computeModel(ecommerce({ levers: { avgCheck: src(0) } }))
    expect(zero.level).toBe(0)
    expect(hasWarning(zero, /Средний чек должен быть больше нуля/)).toBe(true)
    expectCleanResult(zero)

    const neg = computeModel(ecommerce({ levers: { avgCheck: src(-5), leads: src(-1), repeat: src(1.5) } }))
    expect(neg.level).toBe(0)
    expect(neg.warnings.length).toBeGreaterThanOrEqual(3)
    expect(neg.missing.map((m) => m.key)).toEqual(expect.arrayContaining(['leads', 'avgCheck', 'repeat']))
    expectCleanResult(neg)
  })

  it('a base or a goal that is not a positive number is level 0 with a warning', () => {
    const base = computeModel(ecommerce({ base: { revenueYear: src(-5), ageMonths: 0, stale: false } }))
    expect(base.level).toBe(0)
    expect(base.gap.baseAnnual).toBeNull()
    expect(hasWarning(base, /выручка должна быть больше нуля/)).toBe(true)
    expectCleanResult(base)
    const target = computeModel(ecommerce({ goal: goal({ targetAnnual: 0 }) }))
    expect(target.level).toBe(0)
    expect(hasWarning(target, /Цель по выручке должна быть больше нуля/)).toBe(true)
    expectCleanResult(target)
    const nan = computeModel(ecommerce({ goal: goal({ months: NaN }) }))
    expect(nan.level).toBe(0)
    expectCleanResult(nan)
  })

  it('stale base adds a warning and keeps the numbers', () => {
    const fresh = computeModel(ecommerce())
    const stale = computeModel(ecommerce({ base: { revenueYear: { value: 60_000_000, origin: 'fact', period: '2024' }, ageMonths: 22, stale: true } }))
    expect(stale.warnings[0]).toMatch(/База устарела \(выручка за 2024\): прошло 22 мес\./)
    expect(stale.warnings.slice(1)).toEqual(fresh.warnings)
    expect(stale.scenarios).toEqual(fresh.scenarios)
    expect(stale.gap).toEqual(fresh.gap)
    expect(stale.level).toBe(1)
    // a missing base cannot be stale
    expect(computeModel(ecommerce({ base: { revenueYear: src(null), ageMonths: null, stale: true } })).warnings.join(' ')).not.toMatch(/устарела/)
  })

  it('a goal the expert has not verified is flagged; verified and agreed are not', () => {
    for (const status of ['owner_draft', 'corrected', 'disputed'] as const) {
      expect(hasWarning(computeModel(ecommerce({ goal: goal({ reviewStatus: status }) })), /Цель не проверена экспертом/), status).toBe(true)
    }
    for (const status of ['verified', 'agreed'] as const) {
      expect(hasWarning(computeModel(ecommerce({ goal: goal({ reviewStatus: status }) })), /не проверена/), status).toBe(false)
    }
  })
})

describe('history, forecast and verdict through the orchestrator', () => {
  const growing = (months: number, from: string, rate = 0.02): ModelInputs['history'] =>
    monthly(from, Array.from({ length: months }, (_, k) => 5_000_000 * (1 + rate) ** k))

  it('12 months in a row give a forecast and a verdict; the seasonality warning stays below 24 months', () => {
    const r = computeModel(ecommerce({ history: growing(12, '2025-10') }))
    expect(r.forecast.basis).toBe('history')
    expect(r.forecast.trendMonthlyPct!).toBeCloseTo(2, 9)
    expect(r.forecast.atCurrentPace.base!).toBeCloseTo(60_000_000 * 1.02 ** 12, 0)
    // 76M against a goal of 120M is 63%: behind
    expect(r.verdict.key).toBe('behind')
    expect(r.verdict.reason).toContain('76,1 млн ₸')
    expect(r.verdict.reason).toContain('120 млн ₸')
    expect(hasWarning(r, /Сезонность не учтена/)).toBe(true)
    expect(hasWarning(r, /История выручки/)).toBe(false)
    expectCleanResult(r)
  })

  it('a modest goal at the current pace is on track', () => {
    const r = computeModel(ecommerce({ history: growing(12, '2025-10'), goal: goal({ targetAnnual: 76_000_000 }) }))
    expect(r.verdict.key).toBe('on_track')
  })

  it('a history shorter than 12 months or with gaps gives insufficient and no_data, with a reason in the warnings', () => {
    const short = computeModel(ecommerce({ history: growing(8, '2026-02') }))
    expect(short.forecast.basis).toBe('insufficient')
    expect(short.verdict.key).toBe('no_data')
    expect(hasWarning(short, /только 8 мес/)).toBe(true)
    const gappy = computeModel(ecommerce({ history: growing(14, '2025-08').filter((_, k) => k !== 9) }))
    expect(gappy.forecast.basis).toBe('insufficient')
    expect(gappy.verdict.key).toBe('no_data')
    expect(hasWarning(gappy, /пропуски месяцев/)).toBe(true)
    const none = computeModel(ecommerce())
    expect(hasWarning(none, /Истории выручки по месяцам нет/)).toBe(true)
    const old = computeModel(ecommerce({ history: growing(12, '2024-01') }))
    expect(old.verdict.key).toBe('no_data')
    expect(hasWarning(old, /закончилась 22 мес\. назад/)).toBe(true)
    // the scenarios do not depend on the history that is too short
    expect(short.scenarios.map((s) => s.timeToGoalMonths.base)).toEqual([18, 12, 6])
  })

  it('a history that contradicts the base revenue is flagged but not corrected', () => {
    // 12 months of 5M → 60M a year matches; 12 months of 8M → 96M is 60% above the base
    const r = computeModel(ecommerce({ history: monthly('2025-10', Array(12).fill(8_000_000)) }))
    expect(hasWarning(r, /расходится с базовой годовой выручкой/)).toBe(true)
    expect(r.gap.baseAnnual).toBe(60_000_000)
    expect(hasWarning(computeModel(ecommerce({ history: monthly('2025-10', Array(12).fill(5_000_000)) })), /расходится/)).toBe(false)
  })

  it('24 months of history make the seasonality warning disappear', () => {
    const r = computeModel(ecommerce({ history: growing(26, '2024-08', 0.01) }))
    expect(hasWarning(r, /Сезонность не учтена/)).toBe(false)
  })
})

describe('invariants', () => {
  it('identity checks: scenarios[i].revenueAtDeadline.base ≤ target when time > months', () => {
    const inputs = [
      ecommerce(),
      modelInputs({ template: 'production' }),
      modelInputs({ template: 'services', base: { revenueYear: src(36_000_000), ageMonths: 0, stale: false }, levers: { leads: src(40), conversion: src(0.25), avgCheck: src(250_000), repeat: src(0.2), activeBase: src(120, 'derived') }, goal: goal({ targetAnnual: 54_000_000 }) }),
    ]
    for (const i of inputs) {
      const r = computeModel(i)
      for (const s of r.scenarios) {
        const target = i.goal!.targetAnnual
        if (s.timeToGoalMonths.base === null || s.timeToGoalMonths.base > i.goal!.months) expect(s.revenueAtDeadline.base!).toBeLessThanOrEqual(target * (1 + 1e-9))
        // the range keeps its order
        expect(s.revenueAtDeadline.low!).toBeLessThanOrEqual(s.revenueAtDeadline.base!)
        expect(s.revenueAtDeadline.base!).toBeLessThanOrEqual(s.revenueAtDeadline.high!)
        if (s.timeToGoalMonths.base !== null) {
          expect(s.timeToGoalMonths.low === null || s.timeToGoalMonths.low >= s.timeToGoalMonths.base).toBe(true)
          expect(s.timeToGoalMonths.high === null || s.timeToGoalMonths.high <= s.timeToGoalMonths.base).toBe(true)
        }
      }
    }
  })

  it('ModelResult is JSON-serialisable and carries modelVersion pb-model-2', () => {
    for (const i of [ecommerce(), modelInputs({ template: 'production' }), modelInputs({ goal: null }), ecommerce({ levers: { conversion: src(1.2) } })]) {
      const r = computeModel(i)
      expect(r.modelVersion).toBe('pb-model-2')
      expectCleanResult(r)
    }
  })

  it('identical inputs give identical results; the input is not changed', () => {
    const i = ecommerce({ history: monthly('2025-10', Array.from({ length: 12 }, (_, k) => 5_000_000 + k * 50_000)) })
    const before = JSON.stringify(i)
    expect(JSON.stringify(computeModel(i))).toBe(JSON.stringify(computeModel(i)))
    expect(JSON.stringify(i)).toBe(before)
  })

  it('every number a scenario reports is finite, for a hostile spread of inputs', () => {
    const odd: Array<Parameters<typeof modelInputs>[0]> = [
      { levers: { leads: src(1e-6) } },
      { levers: { leads: src(1e9), avgCheck: src(1e9) } },
      { levers: { conversion: src(1) } },
      { goal: goal({ targetAnnual: 1e15 }) },
      { goal: goal({ targetAnnual: 60_000_001 }) },
      { base: { revenueYear: src(1), ageMonths: 0, stale: false } },
      { levers: { repeat: src(1), activeBase: src(1e9) } },
    ]
    for (const o of odd) {
      const r = computeModel(modelInputs(o))
      expectCleanResult(r)
      for (const s of r.scenarios) for (const p of s.trajectory) expect([p.low, p.base, p.high].every(Number.isFinite)).toBe(true)
    }
  })
})
