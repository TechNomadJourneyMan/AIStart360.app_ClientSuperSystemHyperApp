/**
 * Level 2 of the model (plan Ф3, Task 3): profit and cash flow apart.
 *
 * Golden numbers are derived by hand (₸ in millions where noted):
 *
 *  A. revenue 10 / 10 / 10, margin 0.4, payroll 2, fixed 1, no marketing, no tax, no NWC, no capex, no debt, cash0 5
 *     gross profit 4 − payroll 2 − fixed 1 = EBITDA 1 per month  →  cash 6 / 7 / 8, net profit 1 / 1 / 1.
 *  B. the same with DSO 30 (the receivable is one month of revenue = 10):
 *     B1 revenue stays at the base (10)  → NWC 10, ΔNWC 0 / 0 / 0, cash 6 / 7 / 8 (the first month is not hit).
 *     B2 revenue steps to 12: EBITDA = 4.8 − 3 = 1.8; NWC = 12, ΔNWC = 2 / 0 / 0;
 *        CF = 1.8 − 2 = −0.2 / 1.8 / 1.8  →  cash 4.8 / 6.6 / 8.4;
 *        Σ net profit = 5.4, Σ ΔCash = 3.4: the cash lags the profit by exactly the 2 locked in the receivable.
 *  C. profit positive, cash gap: margin 0.4, payroll 2, fixed 1, DSO 60 (receivable = 2 months of revenue), base 10, cash0 3,
 *     revenue 12 / 16 / 20 / 24  →  EBITDA = 0.4R − 3 = 1.8 / 3.4 / 5.0 / 6.6 (all positive);
 *     NWC = 2R = 24 / 32 / 40 / 48, NWC_0 = 20, ΔNWC = 4 / 8 / 8 / 8;
 *     CF = −2.2 / −4.6 / −3.0 / −1.4  →  cash 0.8 / −3.8 / −6.8 / −8.2: the gap starts in month 2, the minimum is −8.2 in month 4;
 *     with a 1-month reserve (2 + 1 = 3) fundingNeed = 3 + 8.2 = 11.2.
 *  D. debt 1.0 at 12% a year (1% a month), service 0.4: interest 0.01 / 0.0061 / 0.002161, principal 0.39 / 0.3939 / 0.2161 (the rest),
 *     debt 0.61 / 0.2161 / 0 / 0 …: the payments stop once the debt is repaid.
 */
import { describe, expect, it } from 'vitest'
import { computeModel } from '@/lib/point-b/model/compute'
import { simulateCash, type CashInputs } from '@/lib/point-b/model/cash'
import { ModelInputError } from '@/lib/point-b/model/types'
import { finmodelState, modelInputsL2 } from './_model'

const M = 1_000_000
const sum = (a: number[]) => a.reduce((x, y) => x + y, 0)

const cash = (over: Partial<CashInputs> = {}): CashInputs => ({
  revenue: [10 * M, 10 * M, 10 * M],
  newCustomers: [0, 0, 0],
  margin: 0.4,
  cac: 1,
  marketingMonthlyBase: null,
  revenueBaseMonthly: 10 * M,
  headcount0: null,
  payrollMonthly: 2 * M,
  payrollGrowth: [],
  fixedCostsMonthly: 1 * M,
  cash0: 5 * M,
  debt0: 0,
  debtServiceMonthly: 0,
  interestRateAnnual: 0,
  dso: 0,
  dio: 0,
  dpo: 0,
  taxRate: 0,
  capexYear: 0,
  reserveMonths: 0,
  ...over,
})

describe('simulateCash — golden examples', () => {
  it('A: profit 1 per month → cash 6 / 7 / 8', () => {
    const r = simulateCash(cash())
    expect(r.ebitda).toEqual([1 * M, 1 * M, 1 * M])
    expect(r.netProfit).toEqual([1 * M, 1 * M, 1 * M])
    expect(r.nwc).toEqual([0, 0, 0])
    expect(r.cash).toEqual([6 * M, 7 * M, 8 * M])
    expect(r.minCash).toEqual({ value: 6 * M, month: 1 })
    expect(r.cashGapMonth).toBeNull()
    expect(r.totals).toEqual({ revenue: 30 * M, ebitda: 3 * M, netProfit: 3 * M, operatingCashFlow: 3 * M, capex: 0, debtService: 0 })
  })

  it('B1: DSO 30 with revenue at the base does not hit the first month', () => {
    const r = simulateCash(cash({ dso: 30 }))
    expect(r.nwc).toEqual([10 * M, 10 * M, 10 * M])
    expect(r.deltaNwc).toEqual([0, 0, 0])
    expect(r.cash).toEqual([6 * M, 7 * M, 8 * M])
  })

  it('B2: revenue steps to 12 with DSO 30 → ΔNWC 2 and the cash lags the profit by 2', () => {
    const r = simulateCash(cash({ revenue: [12 * M, 12 * M, 12 * M], dso: 30 }))
    expect(r.ebitda.map((v) => Math.round(v))).toEqual([1_800_000, 1_800_000, 1_800_000])
    expect(r.nwc).toEqual([12 * M, 12 * M, 12 * M])
    expect(r.deltaNwc).toEqual([2 * M, 0, 0])
    expect(r.cashFlow.map((v) => Math.round(v))).toEqual([-200_000, 1_800_000, 1_800_000])
    expect(r.cash.map((v) => Math.round(v))).toEqual([4_800_000, 6_600_000, 8_400_000])
    const profit = sum(r.netProfit)
    const dCash = r.cash[2] - 5 * M
    expect(Math.round(profit)).toBe(5_400_000)
    expect(Math.round(dCash)).toBe(3_400_000)
    expect(Math.round(profit - dCash)).toBe(2 * M)
  })

  it('C: profit positive but cash gap — fast growth with DSO 60', () => {
    const r = simulateCash(cash({ revenue: [12 * M, 16 * M, 20 * M, 24 * M], newCustomers: [0, 0, 0, 0], dso: 60, cash0: 3 * M, reserveMonths: 1 }))
    expect(r.ebitda.map((v) => Math.round(v))).toEqual([1_800_000, 3_400_000, 5_000_000, 6_600_000])
    expect(r.netProfit.every((v) => v > 0)).toBe(true)
    expect(r.nwc).toEqual([24 * M, 32 * M, 40 * M, 48 * M])
    expect(r.deltaNwc).toEqual([4 * M, 8 * M, 8 * M, 8 * M])
    expect(r.cash.map((v) => Math.round(v))).toEqual([800_000, -3_800_000, -6_800_000, -8_200_000])
    expect(r.cashGapMonth).toBe(2)
    expect(r.minCash.month).toBe(4)
    expect(Math.round(r.minCash.value)).toBe(-8_200_000)
    expect(r.reserveRequired).toBe(3 * M)
    expect(Math.round(r.fundingNeed)).toBe(11_200_000)
    // profit and cash are different things: a positive total profit and a negative cash
    expect(sum(r.netProfit)).toBeGreaterThan(0)
    expect(r.cash[3]).toBeLessThan(0)
  })

  it('D: debt — interest = debt·rate/12, principal = service − interest, debt never negative, repaid early stops the payments', () => {
    const r = simulateCash(cash({
      revenue: Array(5).fill(10 * M) as number[], newCustomers: Array(5).fill(0) as number[],
      debt0: 1 * M, interestRateAnnual: 0.12, debtServiceMonthly: 0.4 * M,
    }))
    expect(r.interest[0]).toBeCloseTo(10_000, 6)
    expect(r.principal[0]).toBeCloseTo(390_000, 6)
    expect(r.debt[0]).toBeCloseTo(610_000, 6)
    expect(r.interest[1]).toBeCloseTo(6_100, 6)
    expect(r.principal[1]).toBeCloseTo(393_900, 6)
    expect(r.debt[1]).toBeCloseTo(216_100, 6)
    expect(r.interest[2]).toBeCloseTo(2_161, 6)
    expect(r.principal[2]).toBeCloseTo(216_100, 6) // the rest, not the full 397 839
    expect(r.debt[2]).toBeCloseTo(0, 6)
    expect(r.interest.slice(3)).toEqual([0, 0])
    expect(r.principal.slice(3)).toEqual([0, 0])
    expect(r.debt.every((d) => d >= 0)).toBe(true)
    expect(r.totals.debtService).toBeCloseTo(1_000_000 + 10_000 + 6_100 + 2_161, 4)
  })
})

describe('simulateCash — debt edge cases', () => {
  it('service below the interest: the interest is still paid, the principal is not repaid, the debt does not grow', () => {
    const r = simulateCash(cash({ debt0: 10 * M, interestRateAnnual: 0.24, debtServiceMonthly: 0.1 * M }))
    expect(r.interest[0]).toBeCloseTo(200_000, 6)
    expect(r.principal).toEqual([0, 0, 0])
    expect(r.debt).toEqual([10 * M, 10 * M, 10 * M])
    expect(r.cash[0]).toBeCloseTo(5 * M + 1 * M - 200_000, 6)
  })

  it('a debt with no service pays only interest; a 0% rate pays the principal only', () => {
    const noService = simulateCash(cash({ debt0: 6 * M, interestRateAnnual: 0.12, debtServiceMonthly: 0 }))
    expect(noService.principal).toEqual([0, 0, 0])
    expect(noService.interest[0]).toBeCloseTo(60_000, 6)
    const zeroRate = simulateCash(cash({ debt0: 1 * M, interestRateAnnual: 0, debtServiceMonthly: 0.4 * M }))
    expect(zeroRate.interest).toEqual([0, 0, 0])
    expect(zeroRate.principal).toEqual([0.4 * M, 0.4 * M, 0.2 * M])
    expect(zeroRate.debt).toEqual([0.6 * M, 0.2 * M, 0])
  })

  it('tax is zero when EBITDA − interest ≤ 0, and a share of the profit before tax otherwise', () => {
    const loss = simulateCash(cash({ revenue: [5 * M, 5 * M, 5 * M], taxRate: 0.2 }))
    expect(loss.ebitda.every((v) => v < 0)).toBe(true)
    expect(loss.tax).toEqual([0, 0, 0])
    expect(loss.netProfit).toEqual(loss.ebitda)
    // EBITDA 1 − interest 0.2 = 0.8 > 0 → tax 0.16
    const withInterest = simulateCash(cash({ debt0: 10 * M, interestRateAnnual: 0.24, debtServiceMonthly: 0.1 * M, taxRate: 0.2 }))
    expect(withInterest.tax[0]).toBeCloseTo(0.2 * (1 * M - 200_000), 6)
    // EBITDA 1 ≤ interest 1.2 → no tax
    const interestEats = simulateCash(cash({ debt0: 60 * M, interestRateAnnual: 0.24, debtServiceMonthly: 0, taxRate: 0.2 }))
    expect(interestEats.tax[0]).toBe(0)
    const taxed = simulateCash(cash({ taxRate: 0.2 }))
    expect(taxed.tax).toEqual([0.2 * M, 0.2 * M, 0.2 * M])
    expect(taxed.netProfit).toEqual([0.8 * M, 0.8 * M, 0.8 * M])
  })
})

describe('simulateCash — identities and safety', () => {
  const busy = cash({
    revenue: Array.from({ length: 24 }, (_, k) => (8 + k * 0.5) * M),
    newCustomers: Array.from({ length: 24 }, (_, k) => 30 + k),
    cac: 20_000, marketingMonthlyBase: 0.6 * M, revenueBaseMonthly: 8 * M,
    headcount0: 10, payrollMonthly: 2 * M, payrollGrowth: Array.from({ length: 24 }, (_, k) => 0.5 * Math.min(1, (k + 1) / 12)),
    fixedCostsMonthly: 1 * M, cash0: 2 * M, debt0: 12 * M, debtServiceMonthly: 0.7 * M, interestRateAnnual: 0.18,
    dso: 21, dio: 40, dpo: 15, taxRate: 0.1, capexYear: 6 * M, reserveMonths: 2,
  })

  it('identity: Σ CF = cash_end − cash_start', () => {
    const r = simulateCash(busy)
    expect(Math.abs(sum(r.cashFlow) - (r.cash[r.cash.length - 1] - busy.cash0))).toBeLessThan(1e-6)
  })

  it('identity: Σ CF = Σ netProfit − Σ ΔNWC − Σ capex − Σ principal', () => {
    const r = simulateCash(busy)
    const rhs = sum(r.netProfit) - sum(r.deltaNwc) - sum(r.capex) - sum(r.principal)
    expect(Math.abs(sum(r.cashFlow) - rhs)).toBeLessThan(1e-6)
    expect(r.totals.capex).toBeCloseTo(6 * M * 2, 4)
    expect(r.totals.operatingCashFlow).toBeCloseTo(sum(r.ebitda) - sum(r.tax) - sum(r.deltaNwc), 4)
  })

  it('marketing follows new customers × CAC; without CAC it scales with the revenue; without both it is 0', () => {
    const byCac = simulateCash(busy)
    expect(byCac.marketing[0]).toBeCloseTo(30 * 20_000, 6)
    const byShare = simulateCash({ ...busy, cac: null })
    expect(byShare.marketing[0]).toBeCloseTo(0.6 * M * (8 * M / (8 * M)), 6)
    expect(byShare.marketing[23]).toBeCloseTo(0.6 * M * (19.5 * M / (8 * M)), 4)
    const none = simulateCash({ ...busy, cac: null, marketingMonthlyBase: null })
    expect(none.marketing.every((v) => v === 0)).toBe(true)
    expect(none.assumptions.join(' ')).toMatch(/Расходы на маркетинг не учтены/)
  })

  it('fundingNeed = max(0, reserve − minCash) and is 0 when cash stays above the reserve', () => {
    // reserve = months · (payroll 2 + fixed 1 + marketing base 0) = 3 per month of the policy
    const three = simulateCash(cash({ reserveMonths: 3 }))
    expect(three.reserveRequired).toBe(9 * M)
    expect(three.fundingNeed).toBe(3 * M) // min cash 6
    expect(simulateCash(cash({ reserveMonths: 1 })).fundingNeed).toBe(0)
    expect(simulateCash(cash({ reserveMonths: 2 })).fundingNeed).toBe(0) // reserve 6 = min cash 6
    // no reserve policy but the cash goes below zero: the shortfall itself is the need (cash0 −3 → −2, −1, 0 … min −2)
    const short = simulateCash(cash({ reserveMonths: 0, cash0: -3 * M }))
    expect(short.minCash).toEqual({ value: -2 * M, month: 1 })
    expect(short.fundingNeed).toBe(2 * M)
  })

  it('negative or zero starting cash does not throw', () => {
    const neg = simulateCash(cash({ cash0: -2 * M }))
    expect(neg.cash).toEqual([-1 * M, 0, 1 * M])
    expect(neg.cashGapMonth).toBe(1)
    const zero = simulateCash(cash({ cash0: 0 }))
    expect(zero.cash).toEqual([1 * M, 2 * M, 3 * M])
    expect(zero.cashGapMonth).toBeNull()
    const zeroRevenue = simulateCash(cash({ revenue: [0, 0, 0], cash0: 0 }))
    expect(zeroRevenue.cashGapMonth).toBe(1)
  })

  it('no NaN or Infinity anywhere (JSON round-trip)', () => {
    for (const r of [simulateCash(busy), simulateCash(cash({ revenue: [0, 0], newCustomers: [0, 0], revenueBaseMonthly: 0 })), simulateCash(cash({ cash0: -5 }))]) {
      expect(JSON.parse(JSON.stringify(r))).toEqual(r)
    }
  })

  it('bad input is a ModelInputError, not a NaN', () => {
    expect(() => simulateCash(cash({ margin: 0 }))).toThrow(ModelInputError)
    expect(() => simulateCash(cash({ margin: 1.2 }))).toThrow(ModelInputError)
    expect(() => simulateCash(cash({ revenue: [] }))).toThrow(ModelInputError)
    expect(() => simulateCash(cash({ revenue: [1, Number.NaN, 1] }))).toThrow(ModelInputError)
    expect(() => simulateCash(cash({ revenue: [1, -1, 1] }))).toThrow(ModelInputError)
    expect(() => simulateCash(cash({ taxRate: -0.1 }))).toThrow(ModelInputError)
    expect(() => simulateCash(cash({ cash0: Number.POSITIVE_INFINITY }))).toThrow(ModelInputError)
    expect(() => simulateCash(cash({ newCustomers: [1] }))).toThrow(ModelInputError)
  })
})

describe('computeModel — level 2', () => {
  it('level 2 only with a complete finmodel; each scenario carries its money for max(goal, ramp) + 12 months', () => {
    const r = computeModel(modelInputsL2())
    expect(r.level).toBe(2)
    expect(r.kind).toBe('funnel')
    expect(r.scenarios).toHaveLength(3)
    const lengths = r.scenarios.map((s) => s.finance!.cash.length)
    // ramp 18 / 12 / 6, goal 12 months → 30 / 24 / 24
    expect(lengths).toEqual([30, 24, 24])
    for (const s of r.scenarios) {
      const f = s.finance!
      for (const a of [f.ebitda, f.netProfit, f.nwc]) expect(a).toHaveLength(f.cash.length)
      expect(f.assumptions.length).toBeGreaterThan(3)
      expect(f.reserveRequired).toBeGreaterThan(0)
    }
    // reserve policy of the profiles: 3 / 2 / 1 months of payroll + fixed + marketing of the base month
    const base = 1_000_000 + 500_000 + 36 * 10_000
    expect(r.scenarios.map((s) => s.finance!.reserveRequired)).toEqual([3 * base, 2 * base, 1 * base])
    expect(JSON.parse(JSON.stringify(r))).toEqual(r)
  })

  it('the horizon is at most 60 months', () => {
    const r = computeModel(modelInputsL2({ goal: { metricKey: 'biz.finansy.vyruchka_god', targetAnnual: 120_000_000, deadline: '2031-10-18', months: 60, reviewStatus: 'verified' } }))
    expect(r.level).toBe(2)
    for (const s of r.scenarios) expect(s.finance!.cash.length).toBe(60)
  })

  it('partial input stays level 1 and lists the missing keys with unlocks', () => {
    const r = computeModel(modelInputsL2({}, { payroll_month: null }))
    expect(r.level).toBe(1)
    expect(r.scenarios).toHaveLength(3)
    expect(r.scenarios.every((s) => s.finance === undefined)).toBe(true)
    const m = r.missing.find((x) => x.key === 'finmodel:payroll_month')
    expect(m).toMatchObject({ level: 2 })
    expect(m!.label.length).toBeGreaterThan(3)
    expect(m!.unlocks.length).toBeGreaterThan(3)
    expect(m!.actions.length).toBeGreaterThan(0)
    // only cash is entered → everything else hard is listed, not zeros
    const onlyCash = computeModel(modelInputsL2({}, { payroll_month: null, fixed_costs_month: null, debt_total: null, capex_year: null }))
    expect(onlyCash.level).toBe(1)
    expect(onlyCash.missing.filter((x) => x.key.startsWith('finmodel:')).map((x) => x.key).sort())
      .toEqual(['finmodel:capex_year', 'finmodel:debt_total', 'finmodel:fixed_costs_month', 'finmodel:payroll_month'])
    // the debt makes service and interest required
    const withDebt = computeModel(modelInputsL2({}, { debt_total: 3 * M, debt_service_month: null, interest_rate_annual: null }))
    expect(withDebt.level).toBe(1)
    expect(withDebt.missing.map((x) => x.key)).toEqual(expect.arrayContaining(['finmodel:debt_service_month', 'finmodel:interest_rate_annual']))
  })

  it('a missing gross margin keeps level 1 and asks for the margin', () => {
    const r = computeModel(modelInputsL2({ grossMargin: { value: null, origin: null, period: null } }))
    expect(r.level).toBe(1)
    expect(r.missing.find((m) => m.key === 'margin')).toMatchObject({ level: 2 })
    expect(r.scenarios.every((s) => s.finance === undefined)).toBe(true)
  })

  it('without a loaded finmodel the result is exactly the level-1 result (no level-2 hints)', () => {
    const a = computeModel(modelInputsL2({ finmodel: null }))
    const b = computeModel(modelInputsL2({ finmodel: undefined }))
    expect(a.level).toBe(1)
    expect(a.missing.some((m) => m.level === 2)).toBe(false)
    expect(b).toEqual(a)
  })

  it('level 2 keeps the revenue side of level 1 (time, revenue, trajectory) when no assumption widens the band', () => {
    const l1 = computeModel(modelInputsL2({ finmodel: null }))
    const l2 = computeModel(modelInputsL2())
    // dso/dio/dpo/tax are typed in FULL_FINMODEL → no defaults → no wider band
    expect(l2.warnings.some((w) => /допущения по отрасли/.test(w))).toBe(false)
    for (let k = 0; k < 3; k++) {
      const { finance: _f, ...rest } = l2.scenarios[k]
      void _f
      expect(rest.timeToGoalMonths).toEqual(l1.scenarios[k].timeToGoalMonths)
      expect(rest.revenueAtDeadline).toEqual(l1.scenarios[k].revenueAtDeadline)
      expect(rest.trajectory).toEqual(l1.scenarios[k].trajectory)
    }
  })

  it('defaults for tax and NWC are listed in assumptions and widen the band', () => {
    const typed = computeModel(modelInputsL2())
    const defaulted = computeModel(modelInputsL2({}, { tax_rate: null, dso_days: null, dio_days: null, dpo_days: null }))
    expect(defaulted.level).toBe(2)
    expect(defaulted.warnings.some((w) => /Оборотный капитал и налог — допущения по отрасли/.test(w))).toBe(true)
    expect(typed.warnings.some((w) => /допущения по отрасли/.test(w))).toBe(false)
    for (const s of defaulted.scenarios) {
      expect(s.finance!.assumptions.join(' ')).toMatch(/Допущения по отрасли.*налог.*±25%/)
      expect(s.assumptions.join(' ')).toMatch(/±25%/)
    }
    for (const s of typed.scenarios) {
      expect(s.finance!.assumptions.join(' ')).not.toMatch(/Допущения по отрасли/)
      expect(s.assumptions.join(' ')).toMatch(/±20%/)
    }
    // wider band → a later unfavourable case
    expect((defaulted.scenarios[1].timeToGoalMonths.low ?? 99)).toBeGreaterThanOrEqual(typed.scenarios[1].timeToGoalMonths.low ?? 99)
  })

  it('opex mismatch over 25% adds the warning and keeps the numbers', () => {
    const base = computeModel(modelInputsL2())
    // model month: payroll 1 000 000 + fixed 500 000 + marketing 36 × 10 000 = 1 860 000
    const far = computeModel(modelInputsL2({}, {}, { facts: { opexMonthly: 3_000_000, adSpendMonthly: null } }))
    expect(far.warnings.some((w) => /^Расходы по модели расходятся с фактом на 38%/.test(w))).toBe(true)
    expect(far.scenarios).toEqual(base.scenarios)
    expect(far.level).toBe(2)
    const near = computeModel(modelInputsL2({}, {}, { facts: { opexMonthly: 1_700_000, adSpendMonthly: null } }))
    expect(near.warnings.some((w) => /Расходы по модели расходятся/.test(w))).toBe(false)
  })

  it('profit positive but a cash gap in the aggressive scenario (working capital and capex eat the cash)', () => {
    const r = computeModel(modelInputsL2({}, { cash_balance: 500_000 }))
    const [cautious, moderate, aggressive] = r.scenarios
    expect(aggressive.finance!.cashGapMonth).toBe(3)
    expect(aggressive.finance!.totals.netProfit).toBeGreaterThan(0)
    expect(aggressive.finance!.minCash.value).toBeLessThan(0)
    expect(cautious.finance!.cashGapMonth).toBeNull()
    expect(moderate.finance!.cashGapMonth).toBeNull()
    expect(aggressive.risks.some((t) => /^Кассовый разрыв в месяце 3/.test(t))).toBe(true)
    expect(aggressive.risks.some((t) => /^Нужно финансирование около/.test(t))).toBe(true)
    expect(aggressive.risks.some((t) => /Оборотный капитал и платежи съедают деньги/.test(t))).toBe(true)
    // profit and cash are visibly different series
    expect(aggressive.finance!.netProfit).not.toEqual(aggressive.finance!.cash)
  })

  it('a faster scenario ends up with less cash at its lowest: min cash(aggressive) ≤ moderate ≤ cautious in the e-commerce golden', () => {
    for (const cashBalance of [4_000_000, 500_000]) {
      const [c, m, a] = computeModel(modelInputsL2({}, { cash_balance: cashBalance })).scenarios.map((s) => s.finance!)
      expect(a.minCash.value).toBeLessThanOrEqual(m.minCash.value)
      expect(m.minCash.value).toBeLessThanOrEqual(c.minCash.value)
      for (const f of [c, m, a]) expect(f.fundingNeed).toBeCloseTo(Math.max(0, f.reserveRequired - f.minCash.value), 0)
    }
  })

  it('investments: marketing and hiring are added, and the gaps are named instead of invented', () => {
    const full = computeModel(modelInputsL2()).scenarios[1]
    expect(full.investments.marketingMonthlyIncrease).toBeGreaterThan(0)
    expect(full.investments.totalOverRamp).toBeGreaterThan(0)
    expect(full.investments.note).toMatch(/Деньги рассчитаны по финмодели/)
    expect(full.investments.note).not.toMatch(/не рассчитаны/)
    const noHeadcount = computeModel(modelInputsL2({ levers: { headcount: { value: null, origin: null, period: null } } })).scenarios[1]
    expect(noHeadcount.investments.staffNeed).toBeNull()
    expect(noHeadcount.investments.note).toMatch(/Оценка вложений неполная: не учтён найм/)
    expect(noHeadcount.finance!.assumptions.join(' ')).toMatch(/не указано число сотрудников/)
    const noCac = computeModel(modelInputsL2({ levers: { cac: { value: null, origin: null, period: null } } })).scenarios[1]
    expect(noCac.investments.marketingMonthlyIncrease).toBeNull()
    expect(noCac.investments.note).toMatch(/не учтён рост маркетинга/)
    // the level-1 «money not calculated» texts are gone at level 2
    for (const s of [full, noHeadcount, noCac]) {
      expect(s.risks.join(' ')).not.toMatch(/Кассовый разрыв не оценён/)
      expect(s.assumptions.join(' ')).not.toMatch(/не рассчитаны/)
      expect(s.conditions.join(' ')).not.toMatch(/когда появятся данные о деньгах/)
    }
  })

  it('the growth model also gets its money (production template, advertising spend from the platform)', () => {
    const r = computeModel(modelInputsL2({ template: 'production' }, {}, { template: 'production', facts: { opexMonthly: null, adSpendMonthly: 300_000 } }))
    expect(r.level).toBe(2)
    expect(r.kind).toBe('growth')
    for (const s of r.scenarios) {
      expect(s.finance!.cash.length).toBeGreaterThan(12)
      expect(s.finance!.assumptions.join(' ')).toMatch(/Маркетинг 300 тыс\. ₸ в месяц растёт пропорционально выручке/)
    }
    expect(JSON.parse(JSON.stringify(r))).toEqual(r)
  })

  it('no NaN or Infinity in the result or its texts', () => {
    for (const i of [modelInputsL2(), modelInputsL2({}, { cash_balance: 0, debt_total: 4 * M, debt_service_month: 100_000, interest_rate_annual: 0.3 })]) {
      const r = computeModel(i)
      expect(JSON.parse(JSON.stringify(r))).toEqual(r)
      const texts = r.scenarios.flatMap((s) => [...s.risks, ...s.assumptions, ...s.conditions, s.investments.note, ...(s.finance?.assumptions ?? [])])
      for (const t of texts) expect(t, t).not.toMatch(/NaN|undefined|Infinity|\[object/)
    }
  })

  it('a goal below the current revenue still gets a cash picture', () => {
    const r = computeModel(modelInputsL2({ goal: { metricKey: 'biz.finansy.vyruchka_god', targetAnnual: 50_000_000, deadline: '2027-10-18', months: 12, reviewStatus: 'verified' } }))
    expect(r.level).toBe(2)
    for (const s of r.scenarios) {
      expect(s.finance).toBeDefined()
      expect(s.timeToGoalMonths.base).toBe(0)
    }
  })

  it('finmodelState helper: removing a default-able key brings the industry default back', () => {
    const s = finmodelState({ tax_rate: null })
    expect(s.defaulted).toEqual(['tax_rate'])
    expect(s.complete).toBe(true)
  })
})
