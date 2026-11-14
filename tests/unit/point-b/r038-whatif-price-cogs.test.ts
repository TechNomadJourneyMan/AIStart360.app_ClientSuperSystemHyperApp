/**
 * R-038 (BI-31): «Что если → Средний чек». A price change moves the REVENUE, not the cost of a unit:
 * COGS = volume × unit cost = revenue at today's check × (1 − margin). Before the fix the cash model took
 * COGS = revenue × (1 − margin) with a constant margin, so the cost grew with the price.
 *
 * Golden numbers (the BI audit example, margin 30%, elasticity 0.3; ramp of 1 month so every month is on the plateau):
 *   base: 300 leads × 12% × 140 000 ₸ = 5 040 000 ₸ a month, gross profit 0.3 × 5.04 M = 1 512 000.
 *   +10% check: revenue 5.04 M × 1.1 × 0.97 = 5 377 680, volume at today's check 5.04 M × 0.97 = 4 888 800,
 *     COGS 0.7 × 4 888 800 = 3 422 160 → gross profit 1 955 520 (+29.3%; the old model: 0.3 × 5 377 680 = 1 613 304, +6.7%).
 *     Marketing, payroll and fixed costs do not move with the check → ΔEBITDA = ΔGP = +443 520 a month = +5 322 240 in 12 months
 *     (old: +1 215 648).
 *   −10% check (a discount): revenue 5.04 M × 0.9 × 1.03 = 4 672 080, volume 5.04 M × 1.03 = 5 191 200, COGS 3 633 840
 *     → gross profit 1 038 240 (−31.3%; old: 1 401 624, −7.3%) → ΔEBITDA −473 760 a month = −5 685 120 in 12 months (old: −1 324 512).
 */
import { describe, expect, it } from 'vitest'
import { simulateCash } from '@/lib/point-b/model/cash'
import { defaultProfiles } from '@/lib/point-b/model/profiles'
import { solveFunnelScenario } from '@/lib/point-b/model/scenarios'
import { inspectWhatIf, runWhatIf } from '@/lib/point-b/model/whatif'
import type { ModelInputs, ScenarioProfile } from '@/lib/point-b/model/types'
import { modelInputsL2, src } from './_model'

const BASE: ModelInputs['base'] = { revenueYear: { value: 60_480_000, origin: 'fact', period: '2026' }, ageMonths: 0, stale: false }
const inputs = () => modelInputsL2({ base: BASE, grossMargin: src(0.3) })
const moderate = defaultProfiles('ecommerce').find((p) => p.key === 'moderate') as ScenarioProfile
const fast: ScenarioProfile = { ...moderate, rampMonths: 1 }

describe('R-038 — what-if «Средний чек»: the price does not change the cost of a unit', () => {
  it('R-038: baseline gross profit 1 512 000 a month (margin 30%)', () => {
    const { baseline } = inspectWhatIf(inputs(), [], { profile: fast })
    // EBITDA = GP − marketing 360 000 − payroll 1 000 000 − fixed 500 000
    expect(baseline.sim!.ebitda[0]).toBeCloseTo(1_512_000 - 1_860_000, 4)
  })

  it('R-038: check +10% (elasticity 0.3) → gross profit +29.3%, EBITDA +5 322 240 in 12 months (was +1 215 648)', () => {
    const r = runWhatIf(inputs(), [{ kind: 'avg_check', pct: 10, demandElasticity: 0.3 }], { profile: fast })
    expect(r.delta.revenueFirst12m).toBe(12 * (5_377_680 - 5_040_000))
    expect(r.delta.ebitdaFirst12m).toBe(5_322_240)
    const { changed } = inspectWhatIf(inputs(), [{ kind: 'avg_check', pct: 10, demandElasticity: 0.3 }], { profile: fast })
    const gp = changed.sim!.ebitda[0] + 1_860_000
    expect(gp).toBeCloseTo(1_955_520, 4)
    expect(gp / 1_512_000 - 1).toBeCloseTo(0.2933, 3)
  })

  it('R-038: a 10% discount (elasticity 0.3) → gross profit −31.3%, EBITDA −5 685 120 in 12 months (was −1 324 512)', () => {
    const r = runWhatIf(inputs(), [{ kind: 'avg_check', pct: -10, demandElasticity: 0.3 }], { profile: fast })
    expect(r.delta.ebitdaFirst12m).toBe(-5_685_120)
  })

  it('R-038: elasticity 0 → the whole price change goes to the gross profit (volume unchanged)', () => {
    const r = runWhatIf(inputs(), [{ kind: 'avg_check', pct: 10, demandElasticity: 0 }], { profile: fast })
    // ΔGP = 5.04 M × 0.1 = 504 000 a month
    expect(r.delta.ebitdaFirst12m).toBe(12 * 504_000)
  })

  it('R-038: the assumption says the unit cost does not follow the price', () => {
    const r = runWhatIf(inputs(), [{ kind: 'avg_check', pct: 10 }], { profile: fast })
    expect(r.assumptions.join(' ')).toMatch(/себестоимость единицы/i)
  })

  it('R-038: other changes keep COGS = revenue × (1 − margin) (a revenue shock is a volume shock)', () => {
    const r = runWhatIf(inputs(), [{ kind: 'revenue_shock', pct: -20, startMonth: 1, durationMonths: 1 }], { profile: fast })
    // month 1 loses 1 008 000 of revenue → GP −0.3 × 1 008 000
    expect(r.delta.ebitdaFirst12m).toBe(-302_400)
  })

  it('R-038: simulateCash takes an explicit COGS path and keeps the cash identities', () => {
    const base = {
      revenue: [11e6, 11e6], newCustomers: null, margin: 0.3, cac: null, marketingMonthlyBase: null, revenueBaseMonthly: 10e6, headcount0: null,
      payrollMonthly: 1e6, payrollGrowth: [], fixedCostsMonthly: 0, cash0: 0, debt0: 0, debtServiceMonthly: 0, interestRateAnnual: 0,
      dso: 10, dio: 20, dpo: 5, taxRate: 0.1, capexYear: 0, reserveMonths: 0,
    }
    const sim = simulateCash({ ...base, cogsPath: [7e6, 7e6] })
    expect(sim.ebitda).toEqual([11e6 - 7e6 - 1e6, 11e6 - 7e6 - 1e6])
    const sum = (a: number[]) => a.reduce((x, y) => x + y, 0)
    expect(sum(sim.cashFlow)).toBeCloseTo(sim.cash[1] - 0, 6)
    expect(sum(sim.cashFlow)).toBeCloseTo(sum(sim.netProfit) - sum(sim.deltaNwc) - sum(sim.capex) - sum(sim.principal), 6)
  })
})

/**
 * The same rule in the scenarios (level 2): a scenario that reaches the goal through the check alone.
 * Margin 40%, base 5.04 M a month, goal ×1.1 = 66 528 000 → the check +10% linearly over 12 months, volume unchanged.
 * Month 12: revenue 5 544 000, COGS = 5 040 000 × 0.6 = 3 024 000 (unit cost unchanged), marketing 360 000, payroll 1 M, fixed 0.5 M
 *   → EBITDA 660 000 (old: 0.4 × 5 544 000 − 1 860 000 = 357 600).
 */
describe('R-038 — scenarios: the check moves the revenue, not the unit cost', () => {
  it('R-038: a check-only scenario, month 12 EBITDA 660 000 (was 357 600)', () => {
    const inputs = modelInputsL2({
      base: BASE,
      goal: { metricKey: 'biz.finansy.vyruchka_god', targetAnnual: 66_528_000, deadline: '2027-10-18', months: 12, reviewStatus: 'verified' },
      levers: { headcount: src(null) },
    })
    const checkOnly: ScenarioProfile = { ...moderate, rampMonths: 12, leverMix: { leads: 0, conversion: 0, avgCheck: 1, repeat: 0 } }
    const s = solveFunnelScenario(inputs, checkOnly, Array(12).fill(1), 0)
    expect(s.finance).toBeDefined()
    expect(s.finance!.ebitda[11]).toBe(660_000)
    // month 1: revenue 5.04 M × (1 + 0.1/12) = 5 082 000 → EBITDA 5 082 000 − 3 024 000 − 1 860 000 = 198 000
    expect(s.finance!.ebitda[0]).toBe(198_000)
  })
})
