/**
 * The «Что если» engine (plan Ф4, Task 2). Golden numbers are derived by hand.
 *
 * Client G (e-commerce, funnel, moderate profile: levers reach the target in 12 months, horizon 24):
 *   300 leads × 12% × 140 000 ₸ = 36 customers × 140 000 = 5 040 000 ₸ a month → 60 480 000 ₸ a year (the base,
 *   so the calibration residual is 0). No repeats: the opening base does not matter. Goal 120 M in 12 months.
 *   Level 2: margin 40%, payroll 1 000 000, fixed 500 000, 10 employees, CAC 10 000 → marketing 36 × 10 000 = 360 000,
 *   baseline EBITDA = 5.04 M × 0.4 − 360 000 − 1 000 000 − 500 000 = 156 000 a month → 1 872 000 in 12 months.
 *
 *  A. avg_check +10%, elasticity 0: the check ×(1 + 0.1·t/12) → at the deadline (month 12) the run-rate is 60.48 M × 1.1 = 66 528 000;
 *     month 6 is 60.48 M × 1.05 = 63 504 000.
 *  B. avg_check +10%, elasticity 0.3: conversion ×(1 − 0.03) → 60.48 M × 1.1 × 0.97 = 60.48 M × 1.067 = 64 532 160.
 *  C. conversion +2 pp: 0.14/0.12 → 60.48 M × 7/6 = 70 560 000.
 *  D. both B and C together are ONE run: conversion (0.12 + 0.02)(1 − 0.03) = 0.1358, check 154 000 →
 *     300 × 0.1358 × 154 000 × 12 = 75 287 520. Contributions 4 052 160 + 10 080 000 = 14 132 160, combined delta 14 807 520,
 *     the interaction is 675 360.
 *  E. revenue_shock −20% for 3 months from month 2: months 2–4 earn 4 032 000 instead of 5 040 000 → the first 12 months lose 3 × 1 008 000 = 3 024 000.
 *  F. fixed_costs −10% from month 1 at fixed 1 000 000: EBITDA +100 000 a month = +1 200 000 in 12 months; with a one-off 300 000 → +900 000.
 *  G. hire 2 (payroll 1 000 000 / 10 employees = 100 000 each) from month 4: −200 000 × 9 months = −1 800 000 EBITDA, revenue unchanged.
 *     With revenueEffect 0.5: per employee 504 000 a month × 0.5 × 2 = 504 000 at full effect, linear over 12 months after the start:
 *     months 4..12 → (1..9)/12, Σ = 45/12 = 3.75 → +1 890 000 revenue, EBITDA −1 800 000 + 0.4 × 1 890 000 = −1 044 000.
 *  H. marketing +50%, efficiency 0.7: leads ×(1 + 0.35·t/12) → run-rate at month 12 = 60.48 M × 1.35 = 81 648 000; revenue of the first 12
 *     months +5.04 M × 0.35 × 6.5 = +11 466 000 (Σ t/12 for t = 1..12 = 6.5); marketing 360 000 × (1 + 0.5·t/12) → +360 000 × 0.5 × 6.5 = +1 170 000;
 *     EBITDA +0.4 × 11 466 000 − 1 170 000 = +3 416 400.
 *  I. goal 63 M: with avg_check +10% (elasticity 0) the run-rate 60.48 M × (1 + 0.1·t/12) reaches 63 M exactly in month 5; the flat baseline never.
 */
import { describe, expect, it } from 'vitest'
import { simulateCash } from '@/lib/point-b/model/cash'
import { computeModel } from '@/lib/point-b/model/compute'
import {
  inspectWhatIf, runWhatIf, validateWhatIf, WHATIF_LABELS, type WhatIfChange, type WhatIfKind, type WhatIfMetrics, type WhatIfResult,
} from '@/lib/point-b/model/whatif'
import type { ModelInputs } from '@/lib/point-b/model/types'
import { modelInputs, modelInputsL2, src } from './_model'

const GOLD_BASE: ModelInputs['base'] = { revenueYear: { value: 60_480_000, origin: 'fact', period: '2026' }, ageMonths: 0, stale: false }
const goal = (target: number, months = 12): ModelInputs['goal'] => ({
  metricKey: 'biz.finansy.vyruchka_god', targetAnnual: target, deadline: '2027-10-18', months, reviewStatus: 'verified',
})

/** Level 1, funnel. */
const l1 = (over: Parameters<typeof modelInputs>[0] = {}) =>
  modelInputs({ base: GOLD_BASE, ...over, levers: { avgCheck: src(140_000), ...over.levers } })
/** Level 2, funnel: payroll 1 M, fixed 0.5 M, 10 employees, CAC 10 000. */
const l2 = (over: Parameters<typeof modelInputsL2>[0] = {}, fin: Parameters<typeof modelInputsL2>[1] = {}) =>
  modelInputsL2({ base: GOLD_BASE, ...over }, fin)
/** The same without a funnel (other industry, no levers): the simplified growth model. */
const growth1 = (over: Parameters<typeof modelInputs>[0] = {}) =>
  modelInputs({ template: 'default', levers: { leads: src(null), conversion: src(null), avgCheck: src(null), activeBase: src(null) }, ...over })
const growth2 = (fin: Parameters<typeof modelInputsL2>[1] = {}) =>
  modelInputsL2({ template: 'default', levers: { leads: src(null), conversion: src(null), avgCheck: src(null), activeBase: src(null), cac: src(null) } }, fin)

const at = (r: WhatIfResult, month: number, which: 'baseline' | 'changed' = 'changed') => r.series[which][r.series.months.indexOf(month)]
const NUMERIC: Array<keyof WhatIfMetrics> = ['annualRunRateAtDeadline', 'revenueFirst12m', 'timeToGoalMonths', 'cashGapMonth', 'fundingNeed', 'ebitdaFirst12m']

describe('runWhatIf — the baseline', () => {
  it('no changes: changed equals baseline exactly', () => {
    for (const inputs of [l1(), l2(), growth1(), growth2()]) {
      const r = runWhatIf(inputs, [])
      expect(r.changed).toEqual(r.baseline)
      expect(r.series.changed).toEqual(r.series.baseline)
      expect(r.contributions).toEqual([])
      for (const k of NUMERIC) expect(r.delta[k] === 0 || r.delta[k] === null, k).toBe(true)
      expect(r.interaction.annualRunRateAtDeadline).toBe(0)
      expect(r.explanation.length).toBeGreaterThan(0)
    }
  })

  it('the baseline of the funnel is today’s levers held flat (run-rate = the base), level 1 has no money', () => {
    const r = runWhatIf(l1(), [])
    expect(r.level).toBe(1)
    expect(r.baseline.annualRunRateAtDeadline).toBe(60_480_000)
    expect(r.baseline.revenueFirst12m).toBe(60_480_000)
    expect(r.baseline.timeToGoalMonths).toBeNull()
    expect(r.baseline.minCash).toBeNull()
    expect(r.baseline.cashGapMonth).toBeNull()
    expect(r.baseline.fundingNeed).toBeNull()
    expect(r.baseline.ebitdaFirst12m).toBeNull()
    expect(r.series.months[0]).toBe(0)
    expect(r.series.months).toHaveLength(25)
    expect(r.series.baseline.every((v) => v === 60_480_000)).toBe(true)
    expect(r.series.target).toBe(120_000_000)
    expect(r.horizonMonths).toBe(24)
  })

  it('level 2 baseline money by hand: EBITDA 156 000 a month, no cash gap', () => {
    const r = runWhatIf(l2(), [])
    expect(r.level).toBe(2)
    expect(r.baseline.ebitdaFirst12m).toBe(1_872_000)
    expect(r.baseline.cashGapMonth).toBeNull()
    expect(r.baseline.minCash).not.toBeNull()
    expect(r.baseline.fundingNeed).toBe(0)
  })
})

describe('runWhatIf — golden single changes (funnel)', () => {
  it('A: avg_check +10%, elasticity 0 → run-rate ×1.10 on the plateau, linear before', () => {
    const r = runWhatIf(l1(), [{ kind: 'avg_check', pct: 10, demandElasticity: 0 }])
    expect(r.changed.annualRunRateAtDeadline).toBe(66_528_000)
    expect(r.delta.annualRunRateAtDeadline).toBe(6_048_000)
    expect(at(r, 0)).toBe(60_480_000)
    expect(at(r, 6)).toBe(63_504_000)
    expect(at(r, 12)).toBe(66_528_000)
    expect(at(r, 24)).toBe(66_528_000)
  })

  it('B: avg_check +10%, elasticity 0.3 → ×1.10 × 0.97 = ×1.067', () => {
    const r = runWhatIf(l1(), [{ kind: 'avg_check', pct: 10 }])
    expect(r.changed.annualRunRateAtDeadline).toBe(64_532_160)
    expect(r.delta.annualRunRateAtDeadline).toBe(4_052_160)
    expect(r.explanation.join(' ')).toContain('×1,067')
    expect(r.assumptions.join(' ')).toMatch(/Эластичность спроса по чеку 0,3/)
  })

  it('C: conversion +2 pp → ×(0.14 / 0.12)', () => {
    const r = runWhatIf(l1(), [{ kind: 'conversion', pp: 2 }])
    expect(r.changed.annualRunRateAtDeadline).toBe(70_560_000)
    // month 3: conversion 0.12 + 0.02 × 3/12 = 0.125 → 60.48 M × 0.125 / 0.12 = 63 M exactly
    expect(at(r, 3)).toBe(63_000_000)
  })

  it('E: revenue_shock −20% for 3 months from month 2 → those months ×0.8, the others untouched', () => {
    const r = runWhatIf(l1(), [{ kind: 'revenue_shock', pct: -20, startMonth: 2, durationMonths: 3 }])
    expect(r.changed.revenueFirst12m).toBe(57_456_000)
    expect(r.delta.revenueFirst12m).toBe(-3_024_000)
    expect([1, 2, 3, 4, 5, 6].map((m) => at(r, m))).toEqual([60_480_000, 48_384_000, 48_384_000, 48_384_000, 60_480_000, 60_480_000])
    expect(r.changed.annualRunRateAtDeadline).toBe(60_480_000)
  })

  it('F: fixed_costs −10% from month 1 at 1 M → EBITDA +100 000 a month; the one-off is subtracted', () => {
    const plain = runWhatIf(l2({}, { fixed_costs_month: 1_000_000 }), [{ kind: 'fixed_costs', cutPct: 10, startMonth: 1 }])
    expect(plain.delta.ebitdaFirst12m).toBe(1_200_000)
    expect(plain.delta.annualRunRateAtDeadline).toBe(0)
    const oneOff = runWhatIf(l2({}, { fixed_costs_month: 1_000_000 }), [{ kind: 'fixed_costs', cutPct: 10, startMonth: 1, oneOffCost: 300_000 }])
    expect(oneOff.delta.ebitdaFirst12m).toBe(900_000)
  })

  it('F2: the reserve follows the new costs: a permanent cut lowers the funding need', () => {
    // A small cash balance so that the reserve (2 months of costs) decides the funding need.
    const inputs = l2({}, { cash_balance: 3_000_000, fixed_costs_month: 1_000_000 })
    const base = runWhatIf(inputs, [])
    const cut = runWhatIf(inputs, [{ kind: 'fixed_costs', cutPct: 50, startMonth: 1 }])
    expect(base.baseline.fundingNeed).toBeGreaterThan(0)
    // reserve 2 months × (1 000 000 payroll + 1 000 000 fixed + 360 000 marketing) = 4 720 000; the cut takes 2 × 500 000 off it.
    expect(base.baseline.fundingNeed).toBe(Math.round(4_720_000 - base.baseline.minCash!.value))
    expect(cut.changed.fundingNeed!).toBeLessThan(base.baseline.fundingNeed!)
  })

  it('G: hire 2 from month 4 without a revenue effect → payroll +200 000 × 9 months, revenue unchanged', () => {
    const r = runWhatIf(l2(), [{ kind: 'hire', count: 2, startMonth: 4 }])
    expect(r.delta.ebitdaFirst12m).toBe(-1_800_000)
    expect(r.delta.revenueFirst12m).toBe(0)
    expect(r.delta.annualRunRateAtDeadline).toBe(0)
    expect(r.assumptions.join(' ')).toMatch(/Эффект найма на выручку не предполагается/)
  })

  it('G2: hire with a revenue effect adds revenue linearly over the ramp after the start', () => {
    const r = runWhatIf(l2(), [{ kind: 'hire', count: 2, startMonth: 4, revenueEffectPct: 0.5 }])
    expect(r.delta.revenueFirst12m).toBe(1_890_000)
    expect(r.delta.ebitdaFirst12m).toBe(-1_044_000)
  })

  it('H: marketing +50% with efficiency 0.7 raises leads by 35% and marketing cost by 50% (level 2)', () => {
    const r = runWhatIf(l2(), [{ kind: 'marketing', budgetPct: 50, efficiency: 0.7 }])
    expect(r.changed.annualRunRateAtDeadline).toBe(81_648_000)
    expect(r.delta.revenueFirst12m).toBe(11_466_000)
    expect(r.delta.ebitdaFirst12m).toBe(3_416_400)
    expect(r.assumptions.join(' ')).toMatch(/Эффективность маркетинга 0,7/)
  })

  it('the default efficiency 0.7 and elasticity 0.3 are stated in the assumptions', () => {
    const a = runWhatIf(l2(), [{ kind: 'marketing', budgetPct: 10 }, { kind: 'avg_check', pct: 5 }]).assumptions.join(' ')
    expect(a).toMatch(/0,7/)
    expect(a).toMatch(/0,3/)
  })

  it('I: time to the goal — avg_check +10% reaches 63 M in month 5, the flat baseline never', () => {
    const r = runWhatIf(l1({ goal: goal(63_000_000) }), [{ kind: 'avg_check', pct: 10, demandElasticity: 0 }])
    expect(r.baseline.timeToGoalMonths).toBeNull()
    expect(r.changed.timeToGoalMonths).toBe(5)
    expect(r.delta.timeToGoalMonths).toBeNull()
    expect(r.explanation.join(' ')).toMatch(/5 мес\./)
  })

  it('a goal below today’s revenue is reached at month 0 and a shock below it is flagged', () => {
    const r = runWhatIf(l1({ goal: goal(50_000_000) }), [{ kind: 'revenue_shock', pct: -60, startMonth: 1, durationMonths: 24 }])
    expect(r.baseline.timeToGoalMonths).toBe(0)
    expect(r.changed.annualRunRateAtDeadline!).toBeLessThan(50_000_000)
    expect(r.riskFlags.join(' ')).toMatch(/ниже цели/)
  })

  it('a start month beyond the horizon is rejected with the field', () => {
    expect(() => runWhatIf(l2(), [{ kind: 'hire', count: 1, startMonth: 40 }])).toThrow(/startMonth|месяц/i)
    try {
      runWhatIf(l2(), [{ kind: 'hire', count: 1, startMonth: 40 }])
    } catch (e) {
      expect((e as { field?: string }).field).toBe('changes[0].startMonth')
    }
  })
})

describe('runWhatIf — several changes, contributions and interaction', () => {
  const two: WhatIfChange[] = [{ kind: 'avg_check', pct: 10 }, { kind: 'conversion', pp: 2 }]

  it('two changes together equal one full run and sum(contributions) + interaction = combined', () => {
    for (const inputs of [l1(), l2()]) {
      const r = runWhatIf(inputs, two)
      // one full run: conversion (0.12 + 0.02)(1 − 0.03) = 0.1358, check 154 000 → 75 287 520
      expect(r.changed.annualRunRateAtDeadline).toBe(75_287_520)
      expect(r.contributions.map((c) => c.kind)).toEqual(['avg_check', 'conversion'])
      expect(r.contributions.map((c) => c.label)).toEqual([WHATIF_LABELS.avg_check, WHATIF_LABELS.conversion])
      expect(r.contributions[0].delta.annualRunRateAtDeadline).toBe(4_052_160)
      expect(r.contributions[1].delta.annualRunRateAtDeadline).toBe(10_080_000)
      expect(r.delta.annualRunRateAtDeadline).toBe(14_807_520)
      expect(r.interaction.annualRunRateAtDeadline).toBe(675_360)

      for (const k of NUMERIC) {
        const parts = r.contributions.map((c) => c.delta[k])
        if (r.delta[k] === null || r.delta[k] === undefined || parts.some((p) => p === null || p === undefined)) continue
        const sum = (parts as number[]).reduce((a, b) => a + b, 0)
        expect(sum + (r.interaction[k] as number), k).toBe(r.delta[k])
      }
      // the order of the changes does not matter
      expect(runWhatIf(inputs, [...two].reverse()).changed).toEqual(r.changed)
    }
  })

  it('a single change has no interaction', () => {
    const r = runWhatIf(l2(), [{ kind: 'marketing', budgetPct: 30 }])
    expect(r.contributions).toHaveLength(1)
    expect(r.contributions[0].delta).toEqual(r.delta)
    for (const k of NUMERIC) expect(r.interaction[k] === 0 || r.interaction[k] === null, k).toBe(true)
  })

  it('all six together at level 2: the identity holds for every metric that is a number', () => {
    const all: WhatIfChange[] = [
      { kind: 'marketing', budgetPct: 30 }, { kind: 'hire', count: 3, startMonth: 2, revenueEffectPct: 0.4 }, { kind: 'avg_check', pct: -10 },
      { kind: 'conversion', pp: 3 }, { kind: 'revenue_shock', pct: -15, startMonth: 6, durationMonths: 4 }, { kind: 'fixed_costs', cutPct: 20, startMonth: 3, oneOffCost: 200_000 },
    ]
    const r = runWhatIf(l2(), all)
    expect(r.contributions).toHaveLength(6)
    let checked = 0
    for (const k of NUMERIC) {
      const parts = r.contributions.map((c) => c.delta[k])
      if (typeof r.delta[k] !== 'number' || parts.some((p) => typeof p !== 'number')) continue
      expect((parts as number[]).reduce((a, b) => a + b, 0) + (r.interaction[k] as number), k).toBe(r.delta[k])
      checked++
    }
    expect(checked).toBeGreaterThanOrEqual(3)
  })
})

describe('runWhatIf — missing data', () => {
  it('no CAC: marketing revenue effect computed, money null with the note', () => {
    const inputs = l2({ levers: { cac: src(null) } })
    const base = runWhatIf(inputs, [])
    expect(base.baseline.minCash).not.toBeNull()
    const r = runWhatIf(inputs, [{ kind: 'marketing', budgetPct: 50 }])
    expect(r.changed.annualRunRateAtDeadline).toBe(81_648_000)
    expect(r.changed.revenueFirst12m).toBe(60_480_000 + 11_466_000)
    expect(r.changed.minCash).toBeNull()
    expect(r.changed.fundingNeed).toBeNull()
    expect(r.changed.ebitdaFirst12m).toBeNull()
    expect(r.delta.ebitdaFirst12m).toBeNull()
    expect(r.warnings.join(' ')).toMatch(/CAC|расход.* на рекламу/)
    // the other changes keep their money
    const mixed = runWhatIf(inputs, [{ kind: 'marketing', budgetPct: 50 }, { kind: 'fixed_costs', cutPct: 10, startMonth: 1 }])
    expect(mixed.contributions.find((c) => c.kind === 'fixed_costs')!.delta.ebitdaFirst12m).toBe(600_000)
  })

  it('growth model: marketing, avg_check and conversion are not applicable with a reason; revenue_shock and fixed_costs work', () => {
    const r1 = runWhatIf(growth1(), [])
    for (const k of ['marketing', 'avg_check', 'conversion'] as WhatIfKind[]) {
      expect(r1.applicable[k].ok, k).toBe(false)
      expect(r1.applicable[k].reason, k).toMatch(/воронк/i)
    }
    expect(r1.applicable.revenue_shock).toEqual({ ok: true, reason: null })
    expect(r1.applicable.fixed_costs).toEqual({ ok: true, reason: null })
    expect(r1.applicable.hire.ok).toBe(false)
    expect(r1.applicable.hire.reason).toMatch(/ФОТ|фонд/i)

    // the funnel changes are ignored with a warning, nothing changes
    const ignored = runWhatIf(growth1(), [{ kind: 'marketing', budgetPct: 20 }])
    expect(ignored.changed).toEqual(ignored.baseline)
    expect(ignored.contributions).toEqual([])
    expect(ignored.warnings.join(' ')).toMatch(/Маркетинг/)

    // revenue_shock on the growth model (flat, no history): 3 months × 20% of 5 000 000
    const shock = runWhatIf(growth2(), [{ kind: 'revenue_shock', pct: -20, startMonth: 2, durationMonths: 3 }])
    expect(shock.level).toBe(2)
    expect(shock.delta.revenueFirst12m).toBe(-3_000_000)
    // fixed costs 500 000 × 10% × 12
    const fixed = runWhatIf(growth2(), [{ kind: 'fixed_costs', cutPct: 10, startMonth: 1 }])
    expect(fixed.delta.ebitdaFirst12m).toBe(600_000)
    expect(fixed.delta.revenueFirst12m).toBe(0)
  })

  it('growth model with a history uses the trend, held under the profile ceiling', () => {
    const history = Array.from({ length: 12 }, (_, i) => {
      const idx = 2025 * 12 + 9 + i
      return { period: `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, '0')}`, revenue: 4_000_000 * 1.01 ** i }
    })
    const r = runWhatIf(growth1({ history }), [])
    expect(computeModel(growth1({ history })).forecast.basis).toBe('history')
    expect(r.baseline.annualRunRateAtDeadline!).toBeGreaterThan(60_000_000)
    expect(r.series.baseline[1]).toBeGreaterThan(r.series.baseline[0])
    expect(r.assumptions.join(' ')).toMatch(/тренд/i)
  })

  it('level 1 without a finmodel: fixed_costs is allowed but says the money needs the finmodel; hire needs payroll', () => {
    const r = runWhatIf(l1(), [{ kind: 'fixed_costs', cutPct: 10, startMonth: 1 }])
    expect(r.applicable.fixed_costs.ok).toBe(true)
    expect(r.applicable.hire.ok).toBe(false)
    expect(r.warnings.join(' ')).toMatch(/финмодел/)
    expect(r.changed.ebitdaFirst12m).toBeNull()
  })

  it('level 0: all not applicable', () => {
    for (const inputs of [modelInputs({ goal: null }), modelInputs({ base: { revenueYear: { value: null, origin: null, period: null }, ageMonths: null, stale: false } })]) {
      const r = runWhatIf(inputs, [{ kind: 'revenue_shock', pct: -10, startMonth: 1, durationMonths: 2 }])
      expect(r.level).toBe(0)
      for (const k of Object.keys(WHATIF_LABELS) as WhatIfKind[]) {
        expect(r.applicable[k].ok, k).toBe(false)
        expect(r.applicable[k].reason, k).toBeTruthy()
      }
      expect(r.baseline.annualRunRateAtDeadline).toBeNull()
      expect(r.changed).toEqual(r.baseline)
      expect(r.series.baseline).toEqual([])
      expect(r.contributions).toEqual([])
      expect(r.explanation.join(' ')).toMatch(/Недостаточно данных|нет/i)
    }
  })

  it('a funnel that does not match the fact falls back to the growth model with the reason', () => {
    const r = runWhatIf(l1({ base: { revenueYear: { value: 20_000_000, origin: 'fact', period: '2026' }, ageMonths: 0, stale: false } }), [])
    expect(r.applicable.avg_check.ok).toBe(false)
    expect(r.applicable.avg_check.reason).toMatch(/не сходится|факт/i)
  })
})

describe('runWhatIf — money', () => {
  it('cash gap appears under a revenue shock at level 2 and riskFlags mention it', () => {
    const inputs = l2({}, { cash_balance: 500_000 })
    const base = runWhatIf(inputs, [])
    expect(base.baseline.cashGapMonth).toBeNull()
    const r = runWhatIf(inputs, [{ kind: 'revenue_shock', pct: -60, startMonth: 1, durationMonths: 12 }])
    expect(r.changed.cashGapMonth).not.toBeNull()
    expect(r.changed.cashGapMonth!).toBeGreaterThan(0)
    expect(r.changed.minCash!.value).toBeLessThan(0)
    expect(r.changed.fundingNeed!).toBeGreaterThan(0)
    expect(r.riskFlags.join(' ')).toMatch(/Кассовый разрыв/)
    expect(r.riskFlags.join(' ')).toMatch(/финансирование/)
  })

  it('identities of the cash model still hold in the changed run (Σ CF = Δcash)', () => {
    const inputs = l2({}, { cash_balance: 2_000_000, debt_total: 3_000_000, debt_service_month: 150_000, interest_rate_annual: 0.12 })
    const changes: WhatIfChange[] = [
      { kind: 'marketing', budgetPct: 40 }, { kind: 'hire', count: 2, startMonth: 3, revenueEffectPct: 0.3 }, { kind: 'avg_check', pct: 8 },
      { kind: 'conversion', pp: 1 }, { kind: 'revenue_shock', pct: -25, startMonth: 5, durationMonths: 3 }, { kind: 'fixed_costs', cutPct: 15, startMonth: 2, oneOffCost: 400_000 },
    ]
    const { baseline, changed } = inspectWhatIf(inputs, changes)
    for (const run of [baseline, changed]) {
      const sim = run.sim!
      expect(sim).not.toBeNull()
      const sum = (a: number[]) => a.reduce((x, y) => x + y, 0)
      expect(sum(sim.cashFlow)).toBeCloseTo(sim.cash[sim.cash.length - 1] - 2_000_000, 4)
      expect(sum(sim.cashFlow)).toBeCloseTo(sum(sim.netProfit) - sum(sim.deltaNwc) - sum(sim.capex) - sum(sim.principal), 4)
      expect(sim.cash.every(Number.isFinite)).toBe(true)
    }
    expect(changed.sim!.cash).not.toEqual(baseline.sim!.cash)
  })

  it('simulateCash with the what-if paths keeps the Ф3 behaviour without them', () => {
    const base = {
      revenue: [10e6, 10e6], newCustomers: [0, 0], margin: 0.4, cac: 1, marketingMonthlyBase: null, revenueBaseMonthly: 10e6, headcount0: null,
      payrollMonthly: 2e6, payrollGrowth: [], fixedCostsMonthly: 1e6, cash0: 5e6, debt0: 0, debtServiceMonthly: 0, interestRateAnnual: 0,
      dso: 0, dio: 0, dpo: 0, taxRate: 0, capexYear: 0, reserveMonths: 0,
    }
    expect(simulateCash(base).cash).toEqual([6e6, 7e6])
    const withPaths = simulateCash({ ...base, fixedCostsPath: [0.5e6, 1e6], oneOff: [0.25e6], marketingPath: [0, 0.1e6] })
    // month 1: 4 − 2 − 0.5 − 0.25 = 1.25; month 2: 4 − 2 − 1 − 0.1 = 0.9
    expect(withPaths.ebitda.map((v) => Math.round(v))).toEqual([1_250_000, 900_000])
    expect(withPaths.cash.map((v) => Math.round(v))).toEqual([6_250_000, 7_150_000])
  })

  it('the explanation and flags carry numbers from the calculation', () => {
    const r = runWhatIf(l2(), [{ kind: 'marketing', budgetPct: 50 }, { kind: 'hire', count: 2, startMonth: 1 }])
    const text = r.explanation.join(' ')
    expect(text).toMatch(/Маркетинг/)
    expect(text).toMatch(/Найм/)
    expect(text).toMatch(/млн ₸|тыс\. ₸/)
    expect(text).not.toMatch(/NaN|Infinity|undefined/)
  })
})

describe('validateWhatIf', () => {
  const bad = (raw: unknown) => {
    const v = validateWhatIf(raw)
    if (v.ok) throw new Error('expected an error')
    return v
  }

  it('extreme values rejected by validateWhatIf with the field: pp 30, budgetPct −100, startMonth 99, count 0, more than 6 changes, duplicate kind', () => {
    expect(bad([{ kind: 'avg_check', pct: 5 }, { kind: 'conversion', pp: 30 }]).field).toBe('changes[1].pp')
    expect(bad([{ kind: 'marketing', budgetPct: -100 }]).field).toBe('changes[0].budgetPct')
    expect(bad([{ kind: 'marketing', budgetPct: 500 }]).field).toBe('changes[0].budgetPct')
    expect(bad([{ kind: 'hire', count: 1, startMonth: 99 }]).field).toBe('changes[0].startMonth')
    expect(bad([{ kind: 'hire', count: 0, startMonth: 1 }]).field).toBe('changes[0].count')
    expect(bad([{ kind: 'hire', count: 1000, startMonth: 1 }]).field).toBe('changes[0].count')
    expect(bad([{ kind: 'avg_check', pct: -90 }]).field).toBe('changes[0].pct')
    expect(bad([{ kind: 'revenue_shock', pct: 10, startMonth: 1, durationMonths: 3 }]).field).toBe('changes[0].pct')
    expect(bad([{ kind: 'revenue_shock', pct: -10, startMonth: 1, durationMonths: 30 }]).field).toBe('changes[0].durationMonths')
    expect(bad([{ kind: 'fixed_costs', cutPct: 80, startMonth: 1 }]).field).toBe('changes[0].cutPct')
    expect(bad([{ kind: 'fixed_costs', cutPct: 10, startMonth: 1, oneOffCost: -5 }]).field).toBe('changes[0].oneOffCost')

    const seven = Array.from({ length: 7 }, () => ({ kind: 'conversion', pp: 1 }))
    expect(bad(seven).field).toBe('changes')
    const dup = bad([{ kind: 'conversion', pp: 1 }, { kind: 'avg_check', pct: 1 }, { kind: 'conversion', pp: 2 }])
    expect(dup.field).toBe('changes[2].kind')
    expect(dup.error).toMatch(/дважды/)
  })

  it('texts are Russian and name the range; non-numbers, NaN and strings are rejected', () => {
    expect(bad([{ kind: 'conversion', pp: 30 }]).error).toMatch(/конверси.*от −10 до 20/i)
    for (const pp of [Number.NaN, Infinity, '5', null, undefined]) {
      const v = bad([{ kind: 'conversion', pp }])
      expect(v.field).toBe('changes[0].pp')
      expect(v.error).toMatch(/[А-Яа-я]/)
    }
    expect(bad([{ kind: 'hire', count: 1.5, startMonth: 1 }]).field).toBe('changes[0].count')
    expect(bad([{ kind: 'warp' }]).field).toBe('changes[0].kind')
    expect(bad([42]).field).toBe('changes[0]')
    expect(bad('nope').field).toBe('changes')
    expect(bad(undefined).field).toBe('changes')
    expect(bad([{ kind: 'marketing', budgetPct: 10, efficiency: 2 }]).field).toBe('changes[0].efficiency')
  })

  it('a valid list is returned normalised (unknown fields dropped, optional ones kept when given); an empty list is valid', () => {
    expect(validateWhatIf([])).toEqual({ ok: true, changes: [] })
    const v = validateWhatIf([
      { kind: 'marketing', budgetPct: 20, evil: 1 }, { kind: 'avg_check', pct: -10, demandElasticity: 0.5 }, { kind: 'conversion', pp: -2.5 },
      { kind: 'hire', count: 3, startMonth: 2, revenueEffectPct: 0.2 }, { kind: 'revenue_shock', pct: 0, startMonth: 1, durationMonths: 24 },
      { kind: 'fixed_costs', cutPct: 0, startMonth: 60, oneOffCost: 0 },
    ])
    expect(v).toEqual({
      ok: true,
      changes: [
        { kind: 'marketing', budgetPct: 20 }, { kind: 'avg_check', pct: -10, demandElasticity: 0.5 }, { kind: 'conversion', pp: -2.5 },
        { kind: 'hire', count: 3, startMonth: 2, revenueEffectPct: 0.2 }, { kind: 'revenue_shock', pct: 0, startMonth: 1, durationMonths: 24 },
        { kind: 'fixed_costs', cutPct: 0, startMonth: 60, oneOffCost: 0 },
      ],
    })
  })

  it('the horizon bound is checked when it is known', () => {
    const ok = validateWhatIf([{ kind: 'hire', count: 1, startMonth: 30 }])
    expect(ok.ok).toBe(true)
    const v = validateWhatIf([{ kind: 'hire', count: 1, startMonth: 30 }], { horizonMonths: 24 })
    expect(v.ok).toBe(false)
    if (!v.ok) {
      expect(v.field).toBe('changes[0].startMonth')
      expect(v.error).toMatch(/24/)
    }
  })
})

describe('runWhatIf — determinism and JSON safety', () => {
  const extremes: WhatIfChange[][] = [
    [{ kind: 'marketing', budgetPct: -50, efficiency: 0.3 }, { kind: 'avg_check', pct: -30, demandElasticity: 1 }, { kind: 'conversion', pp: -10 }],
    [{ kind: 'marketing', budgetPct: 100, efficiency: 1 }, { kind: 'avg_check', pct: 50, demandElasticity: 0 }, { kind: 'conversion', pp: 20 }],
    [{ kind: 'avg_check', pct: -30, demandElasticity: 1 }, { kind: 'conversion', pp: 20 }, { kind: 'revenue_shock', pct: -60, startMonth: 1, durationMonths: 24 }],
    [{ kind: 'hire', count: 20, startMonth: 1, revenueEffectPct: 1 }, { kind: 'fixed_costs', cutPct: 50, startMonth: 1, oneOffCost: 1_000_000_000 }],
    [{ kind: 'revenue_shock', pct: -60, startMonth: 24, durationMonths: 24 }],
  ]

  it('determinism and JSON-safety (no NaN)', () => {
    const variants = [l1(), l2(), growth1(), growth2(), l2({}, { cash_balance: 0, dso_days: 90 }), modelInputs({ goal: null })]
    for (const inputs of variants) {
      for (const changes of extremes) {
        let r: WhatIfResult
        try {
          r = runWhatIf(inputs, changes)
        } catch (e) {
          // only a horizon violation may throw (24-month horizon: startMonth 24 is fine)
          throw new Error(`threw for ${JSON.stringify(changes)}: ${(e as Error).message}`)
        }
        expect(JSON.parse(JSON.stringify(r))).toEqual(r)
        expect(JSON.stringify(r)).not.toMatch(/NaN|Infinity/)
        expect(runWhatIf(inputs, changes)).toEqual(r)
        expect(r.computedAt).toBe(inputs.now)
        expect(r.modelVersion).toMatch(/^pb-model-/)
      }
    }
  })

  it('does not read the clock', () => {
    const real = Date.now
    Date.now = () => { throw new Error('Date.now() is not allowed in the engine') }
    try {
      expect(() => runWhatIf(l2(), [{ kind: 'marketing', budgetPct: 10 }])).not.toThrow()
    } finally {
      Date.now = real
    }
  })

  it('the input is not mutated', () => {
    const inputs = l2()
    const copy = structuredClone(inputs)
    runWhatIf(inputs, [{ kind: 'marketing', budgetPct: 10 }, { kind: 'fixed_costs', cutPct: 10, startMonth: 1 }])
    expect(inputs).toEqual(copy)
  })

  it('a duplicate kind passed to the engine directly is an error with the field', () => {
    expect(() => runWhatIf(l1(), [{ kind: 'conversion', pp: 1 }, { kind: 'conversion', pp: 2 }])).toThrow(/дважды/)
  })
})
