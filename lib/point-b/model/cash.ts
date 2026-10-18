/**
 * lib/point-b/model/cash.ts — level 2 of the model: profit and CASH FLOW, kept apart (spec §9.2–9.3). Pure.
 *
 *   Marketing_t = NewCustomers_t · CAC                          (CAC constant — an assumption)
 *                 or, without CAC / customers, the base marketing spend scaled with the revenue
 *   Payroll_t   = payroll · (1 + growth_t)                      growth_t: hiring over the ramp
 *   COGS_t      = Revenue_t · (1 − margin)
 *   EBITDA_t    = Revenue − COGS − Marketing − Payroll − FixedCosts
 *   Interest_t  = Debt_{t−1} · rate / 12
 *   Principal_t = min(Debt_{t−1}, max(0, debtService − Interest_t));  Debt_t = Debt_{t−1} − Principal_t
 *   Tax_t       = max(0, taxRate · (EBITDA_t − Interest_t));  NetProfit_t = EBITDA − Interest − Tax
 *   NWC_t       = Revenue·DSO/30 + COGS·DIO/30 − COGS·DPO/30;  ΔNWC_t = NWC_t − NWC_{t−1}
 *                 (NWC_0 from the BASE monthly revenue, no growth)
 *   CFO_t       = EBITDA − Tax − ΔNWC;  CF_t = CFO − Interest − Principal − Capex_t;  Capex_t = capexYear/12
 *   Cash_t      = Cash_{t−1} + CF_t
 *   reserveRequired = reserveMonths · (Payroll + FixedCosts + Marketing) of the BASE month
 *   fundingNeed     = max(0, reserveRequired − min Cash);  cashGapMonth = the first month with Cash < 0
 *
 * Identities (tested): Σ CF = Cash_end − Cash_start;  Σ CF = Σ NetProfit − Σ ΔNWC − Σ Capex − Σ Principal.
 * No IO, no clock; every number is finite (a bad input is a ModelInputError, never a NaN in the result).
 */
import type { FinmodelState } from '../finmodel/store'
import { fmtMoney, fmtMonths, fmtNum, fmtPct, round } from './format'
import { ModelInputError, type ModelInputs, type ScenarioFinance, type ScenarioProfile, type ScenarioResult } from './types'

const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n)

/** The band of uncertainty when tax or the working capital days are industry assumptions. */
export const DEFAULTS_BAND = 0.25
/** The model works at most this many months. */
export const FINANCE_HORIZON_MAX = 60
/** Below this cash balance (₸) a month counts as a cash gap — float noise is not a gap. */
const GAP_EPS = 0.005

export interface CashInputs {
  /** Monthly revenue 1..H (₸). */
  revenue: number[]
  /** New customers 1..H; null = the model has none (growth model) → marketing scales with the revenue. */
  newCustomers: number[] | null
  /** Gross margin, a fraction. */
  margin: number
  cac: number | null
  /** Marketing spend of the base month; null = unknown (then 0, said in the assumptions). */
  marketingMonthlyBase: number | null
  /** The base monthly revenue: NWC_0 and the marketing share are taken from it. */
  revenueBaseMonthly: number
  headcount0: number | null
  payrollMonthly: number
  /** Payroll growth 1..H as fractions (missing months = 0). */
  payrollGrowth: number[]
  fixedCostsMonthly: number
  cash0: number
  debt0: number
  debtServiceMonthly: number
  /** A fraction per year. */
  interestRateAnnual: number
  dso: number
  dio: number
  dpo: number
  taxRate: number
  capexYear: number
  reserveMonths: number
}

/** What `simulateCash` returns: the contract plus the lines needed to check the identities. */
export interface CashSimulation extends ScenarioFinance {
  cashFlow: number[]
  operatingCashFlow: number[]
  deltaNwc: number[]
  interest: number[]
  principal: number[]
  tax: number[]
  capex: number[]
  debt: number[]
  marketing: number[]
  payroll: number[]
}

const nonNeg = (what: string, v: number): void => {
  if (!finite(v) || v < 0) throw new ModelInputError(`${what}: нужно число не меньше нуля`)
}

function validate(c: CashInputs): void {
  if (!Array.isArray(c.revenue) || c.revenue.length < 1 || c.revenue.length > 600) throw new ModelInputError('Горизонт денежного потока — от 1 до 600 месяцев')
  if (c.revenue.some((v) => !finite(v) || v < 0)) throw new ModelInputError('Выручка по месяцам не может быть отрицательной')
  if (c.newCustomers !== null && (c.newCustomers.length < c.revenue.length || c.newCustomers.some((v) => !finite(v) || v < 0))) {
    throw new ModelInputError('Новые клиенты по месяцам заданы неверно')
  }
  if (!finite(c.margin) || c.margin <= 0 || c.margin > 1) throw new ModelInputError('Валовая маржа должна быть больше нуля и не больше 100%')
  if (c.cac !== null) nonNeg('Стоимость привлечения клиента', c.cac)
  if (c.marketingMonthlyBase !== null) nonNeg('Маркетинг базового месяца', c.marketingMonthlyBase)
  nonNeg('Базовая месячная выручка', c.revenueBaseMonthly)
  if (c.headcount0 !== null) nonNeg('Число сотрудников', c.headcount0)
  nonNeg('Фонд оплаты труда', c.payrollMonthly)
  nonNeg('Постоянные расходы', c.fixedCostsMonthly)
  if (!finite(c.cash0)) throw new ModelInputError('Деньги на счёте указаны неверно')
  nonNeg('Долг', c.debt0)
  nonNeg('Платёж по долгу', c.debtServiceMonthly)
  nonNeg('Ставка по кредитам', c.interestRateAnnual)
  nonNeg('Срок оплаты клиентами', c.dso)
  nonNeg('Оборачиваемость запасов', c.dio)
  nonNeg('Срок оплаты поставщикам', c.dpo)
  nonNeg('Налоговая ставка', c.taxRate)
  nonNeg('Капитальные затраты', c.capexYear)
  nonNeg('Резерв ликвидности', c.reserveMonths)
  if (c.payrollGrowth.some((v) => !finite(v) || v < -1)) throw new ModelInputError('Рост фонда оплаты труда задан неверно')
}

function marketingOf(c: CashInputs, t: number): number {
  if (c.cac !== null && c.newCustomers !== null) return c.newCustomers[t] * c.cac
  if (c.marketingMonthlyBase !== null) {
    return c.revenueBaseMonthly > 0 ? (c.marketingMonthlyBase * c.revenue[t]) / c.revenueBaseMonthly : c.marketingMonthlyBase
  }
  return 0
}

export function simulateCash(c: CashInputs): CashSimulation {
  validate(c)
  const H = c.revenue.length
  const nwcOf = (revenue: number, cogs: number): number => (revenue * c.dso) / 30 + (cogs * c.dio) / 30 - (cogs * c.dpo) / 30
  let nwcPrev = nwcOf(c.revenueBaseMonthly, c.revenueBaseMonthly * (1 - c.margin))
  let debt = c.debt0
  let cash = c.cash0
  const capexMonthly = c.capexYear / 12

  const out: CashSimulation = {
    ebitda: [], netProfit: [], cash: [], nwc: [],
    minCash: { value: c.cash0, month: 0 }, cashGapMonth: null, fundingNeed: 0, reserveRequired: 0,
    totals: { revenue: 0, ebitda: 0, netProfit: 0, operatingCashFlow: 0, capex: 0, debtService: 0 },
    assumptions: [],
    cashFlow: [], operatingCashFlow: [], deltaNwc: [], interest: [], principal: [], tax: [], capex: [], debt: [], marketing: [], payroll: [],
  }

  for (let t = 0; t < H; t++) {
    const revenue = c.revenue[t]
    const cogs = revenue * (1 - c.margin)
    const marketing = marketingOf(c, t)
    const payroll = c.payrollMonthly * (1 + (c.payrollGrowth[t] ?? 0))
    const ebitda = revenue - cogs - marketing - payroll - c.fixedCostsMonthly

    const interest = (debt * c.interestRateAnnual) / 12
    const principal = Math.min(debt, Math.max(0, c.debtServiceMonthly - interest))
    debt -= principal
    const tax = Math.max(0, c.taxRate * (ebitda - interest))
    const netProfit = ebitda - interest - tax

    const nwc = nwcOf(revenue, cogs)
    const deltaNwc = nwc - nwcPrev
    nwcPrev = nwc
    const cfo = ebitda - tax - deltaNwc
    const cf = cfo - interest - principal - capexMonthly
    cash += cf

    const lines = [revenue, ebitda, netProfit, nwc, deltaNwc, cfo, cf, cash, interest, principal, tax, debt, marketing, payroll]
    if (lines.some((v) => !finite(v))) throw new ModelInputError('Денежный поток нельзя посчитать: проверьте значения финмодели')

    out.ebitda.push(ebitda); out.netProfit.push(netProfit); out.cash.push(cash); out.nwc.push(nwc)
    out.cashFlow.push(cf); out.operatingCashFlow.push(cfo); out.deltaNwc.push(deltaNwc)
    out.interest.push(interest); out.principal.push(principal); out.tax.push(tax); out.capex.push(capexMonthly)
    out.debt.push(debt); out.marketing.push(marketing); out.payroll.push(payroll)

    out.totals.revenue += revenue
    out.totals.ebitda += ebitda
    out.totals.netProfit += netProfit
    out.totals.operatingCashFlow += cfo
    out.totals.capex += capexMonthly
    out.totals.debtService += interest + principal

    if (t === 0 || cash < out.minCash.value) out.minCash = { value: cash, month: t + 1 }
    if (out.cashGapMonth === null && cash < -GAP_EPS) out.cashGapMonth = t + 1
  }

  out.reserveRequired = c.reserveMonths * (c.payrollMonthly + c.fixedCostsMonthly + (c.marketingMonthlyBase ?? 0))
  out.fundingNeed = Math.max(0, out.reserveRequired - out.minCash.value)
  out.assumptions = cashAssumptions(c)
  return out
}

function cashAssumptions(c: CashInputs): string[] {
  const a: string[] = [
    'Прибыль и денежный поток считаются отдельно: денежный поток = EBITDA − налог − прирост оборотного капитала − проценты − погашение долга − капитальные затраты.',
    'Себестоимость — по валовой марже; налог — доля от прибыли до налога (EBITDA − проценты), не ниже нуля, амортизация не учитывается.',
    `Оборотный капитал: дебиторка = выручка × ${fmtNum(c.dso, 0)}/30, запасы = себестоимость × ${fmtNum(c.dio, 0)}/30, кредиторка = себестоимость × ${fmtNum(c.dpo, 0)}/30.`,
    c.debt0 > 0
      ? `Долг ${fmtMoney(c.debt0)}: проценты по ставке ${fmtPct(c.interestRateAnnual, 1)} годовых, платёж ${fmtMoney(c.debtServiceMonthly)} в месяц идёт сначала на проценты, затем на основной долг; новых кредитов нет.`
      : 'Долгов нет: платежей по кредитам и процентов нет.',
    `Капитальные затраты ${fmtMoney(c.capexYear)} в год распределены равномерно по месяцам.`,
    'Сезонность в денежном потоке не учтена.',
  ]
  if (c.cac !== null && c.newCustomers !== null) a.push(`Маркетинг = новые клиенты × CAC (${fmtMoney(c.cac)}); CAC считается постоянным.`)
  else if (c.marketingMonthlyBase !== null) a.push(`Маркетинг ${fmtMoney(c.marketingMonthlyBase)} в месяц растёт пропорционально выручке.`)
  else a.push('Расходы на маркетинг не учтены: нет CAC и расходов на рекламу.')
  if (c.cash0 < 0) a.push('Деньги на счёте отрицательные: расчёт идёт от этого значения.')
  return a
}

// ─── level 2 inside a scenario ──────────────────────────────────────────────

/** The finmodel is complete, the gross margin is usable, no value is missing: level 2 can be calculated. */
export function grossMarginOf(i: ModelInputs): number | null {
  const m = i.grossMargin?.value
  return finite(m) && m > 0 && m <= 1 ? m : null
}

export function financeReady(i: ModelInputs): boolean {
  return !!i.finmodel && i.finmodel.complete && grossMarginOf(i) !== null
}

/** Industry assumptions are in use: the uncertainty band is wider. */
export function usesDefaults(i: ModelInputs): boolean {
  return financeReady(i) && (i.finmodel?.defaulted.length ?? 0) > 0
}

const val = (f: FinmodelState, key: keyof typeof KEYS): number | null => {
  const v = f.values[KEYS[key]]?.value
  return finite(v) ? v : null
}
const KEYS = {
  cash: 'cash_balance', fixed: 'fixed_costs_month', payroll: 'payroll_month', debt: 'debt_total', service: 'debt_service_month',
  rate: 'interest_rate_annual', dso: 'dso_days', dio: 'dio_days', dpo: 'dpo_days', tax: 'tax_rate', capex: 'capex_year',
} as const

/** Months a scenario is simulated: the later of the goal and the exit of the levers, plus a year, at most 60. */
export function financeHorizon(goalMonths: number, rampMonths: number): number {
  return Math.min(FINANCE_HORIZON_MAX, Math.max(1, Math.ceil(Math.max(goalMonths, rampMonths))) + 12)
}

/** Marketing spend of the base month: customers × CAC for the funnel, else the advertising spend of the platform. */
export function marketingBaseMonthly(i: ModelInputs, funnel: boolean): number | null {
  const L = i.levers.leads.value
  const c = i.levers.conversion.value
  const cac = i.levers.cac.value
  if (funnel && finite(L) && L > 0 && finite(c) && c > 0 && finite(cac) && cac > 0) return L * c * cac
  const ad = i.finmodel?.facts?.adSpendMonthly
  return finite(ad) && ad > 0 ? ad : null
}

/** The expenses of the base month by the model (payroll + fixed costs + marketing). */
export function baseMonthExpenses(i: ModelInputs, funnel: boolean): number | null {
  const f = i.finmodel
  if (!f) return null
  const payroll = val(f, 'payroll')
  const fixed = val(f, 'fixed')
  if (payroll === null || fixed === null) return null
  return payroll + fixed + (marketingBaseMonthly(i, funnel) ?? 0)
}

export interface ScenarioPath {
  /** Monthly revenue 1..H. */
  revenue: number[]
  /** New customers 1..H (funnel) or null (growth). */
  newCustomers: number[] | null
}

export interface FinanceBuild {
  finance: ScenarioFinance
  /** The estimate of the hiring cost over the ramp (null = no headcount / no need). */
  hiringCost: number | null
  payrollPerEmployee: number | null
}

function scenarioNotes(i: ModelInputs, hiring: { staffNeed: number | null; headcount: number | null }): string[] {
  const notes: string[] = []
  if (usesDefaults(i)) {
    const labels: Record<string, string> = { tax_rate: 'налог', dso_days: 'срок оплаты клиентами', dio_days: 'запасы', dpo_days: 'срок оплаты поставщикам' }
    const list = (i.finmodel?.defaulted ?? []).map((k) => labels[k] ?? k).join(', ')
    notes.push(`Допущения по отрасли (в финмодели не указано): ${list}. Диапазон расширен до ±${Math.round(DEFAULTS_BAND * 100)}%.`)
  }
  if (hiring.headcount === null) notes.push('Фонд оплаты труда не растёт с выручкой: не указано число сотрудников, стоимость найма не оценена.')
  else if (hiring.staffNeed && hiring.staffNeed > 0) notes.push(`Найм ${fmtNum(hiring.staffNeed, 0)} чел. растёт линейно за срок выхода рычагов; стоимость сотрудника — средняя по текущему ФОТ.`)
  return notes
}

/** Level 2 of one scenario: the money by month for the revenue path of the scenario. Throws ModelInputError on unusable input. */
export function buildScenarioFinance(
  i: ModelInputs, profile: ScenarioProfile, path: ScenarioPath,
  ctx: { funnel: boolean; staffNeed: number | null; baseMonthlyRevenue: number },
): FinanceBuild {
  const f = i.finmodel
  const margin = grossMarginOf(i)
  if (!f || !f.complete || margin === null) throw new ModelInputError('Для расчёта денег нужна полная финмодель и валовая маржа')
  const H = path.revenue.length
  const payroll = val(f, 'payroll') as number
  const headcount0 = finite(i.levers.headcount.value) && i.levers.headcount.value > 0 ? i.levers.headcount.value : null
  const staff = ctx.staffNeed && headcount0 !== null ? ctx.staffNeed : 0
  const ramp = Math.max(1, profile.rampMonths)
  const growthFull = headcount0 !== null ? staff / headcount0 : 0
  const payrollGrowth = Array.from({ length: H }, (_, k) => growthFull * Math.min(1, (k + 1) / ramp))

  const cac = ctx.funnel && finite(i.levers.cac.value) && i.levers.cac.value > 0 ? i.levers.cac.value : null
  const sim = simulateCash({
    revenue: path.revenue,
    newCustomers: path.newCustomers,
    margin,
    cac,
    marketingMonthlyBase: marketingBaseMonthly(i, ctx.funnel),
    revenueBaseMonthly: ctx.baseMonthlyRevenue,
    headcount0,
    payrollMonthly: payroll,
    payrollGrowth,
    fixedCostsMonthly: val(f, 'fixed') as number,
    cash0: val(f, 'cash') as number,
    debt0: val(f, 'debt') as number,
    debtServiceMonthly: val(f, 'service') ?? 0,
    interestRateAnnual: val(f, 'rate') ?? 0,
    dso: val(f, 'dso') ?? 0,
    dio: val(f, 'dio') ?? 0,
    dpo: val(f, 'dpo') ?? 0,
    taxRate: val(f, 'tax') ?? 0,
    capexYear: val(f, 'capex') ?? 0,
    reserveMonths: profile.reserveMonths,
  })

  const perEmployee = headcount0 !== null ? payroll / headcount0 : null
  const hiringCost = perEmployee !== null && staff > 0 ? staff * perEmployee * (ramp / 2) : perEmployee !== null ? 0 : null
  const assumptions = [...scenarioNotes(i, { staffNeed: ctx.staffNeed, headcount: headcount0 }), ...sim.assumptions]
  return { finance: toFinance(sim, assumptions), hiringCost, payrollPerEmployee: perEmployee }
}

/** The contract object: whole tenge, only the contract fields (no helper lines). */
export function toFinance(sim: CashSimulation, assumptions: string[]): ScenarioFinance {
  const r = (v: number) => round(v, 0)
  const rows = (v: number[]) => v.map(r)
  return {
    ebitda: rows(sim.ebitda),
    netProfit: rows(sim.netProfit),
    cash: rows(sim.cash),
    nwc: rows(sim.nwc),
    minCash: { value: r(sim.minCash.value), month: sim.minCash.month },
    cashGapMonth: sim.cashGapMonth,
    fundingNeed: r(sim.fundingNeed),
    reserveRequired: r(sim.reserveRequired),
    totals: {
      revenue: r(sim.totals.revenue), ebitda: r(sim.totals.ebitda), netProfit: r(sim.totals.netProfit),
      operatingCashFlow: r(sim.totals.operatingCashFlow), capex: r(sim.totals.capex), debtService: r(sim.totals.debtService),
    },
    assumptions,
  }
}

// ─── texts a scenario gets at level 2 ───────────────────────────────────────

/** The texts of level 1 that say «money is not calculated»; at level 2 they are replaced. */
export const LEVEL1_CASH_TEXTS = [
  'Кассовый разрыв не оценён: нет данных о деньгах (уровень 2).',
  'Деньги (резерв, нехватка средств, денежный поток) не рассчитаны: нужны данные уровня 2.',
] as const

export function financeRisks(f: ScenarioFinance): string[] {
  const out: string[] = []
  if (f.cashGapMonth !== null) out.push(`Кассовый разрыв в месяце ${f.cashGapMonth}: денег на счёте не хватает, минимум — ${fmtMoney(f.minCash.value)}.`)
  if (f.fundingNeed > 0) out.push(`Нужно финансирование около ${fmtMoney(f.fundingNeed)}: так не хватает до резерва ликвидности (${fmtMoney(f.reserveRequired)}).`)
  if (f.totals.netProfit > 0 && f.minCash.value < f.reserveRequired) out.push('Оборотный капитал и платежи съедают деньги: чистая прибыль положительная, а касса опускается ниже резерва.')
  return out
}

export function financeConditions(f: ScenarioFinance, profile: ScenarioProfile): string[] {
  return [`Резерв ликвидности сценария: ${fmtMonths(profile.reserveMonths)} расходов — ${fmtMoney(f.reserveRequired)}.`]
}

/** Investments of a scenario at level 2: the marketing increase over the ramp (when known) plus the cost of hiring (when known). */
export function totalInvestment(
  marketingOverRamp: number | null, hiringCost: number | null, funnel: boolean,
): { total: number | null; incomplete: string | null } {
  if (marketingOverRamp === null && hiringCost === null) return { total: null, incomplete: null }
  const total = round((marketingOverRamp ?? 0) + (hiringCost ?? 0), 0)
  const incomplete = funnel && marketingOverRamp === null ? 'рост маркетинга (нужен CAC)' : hiringCost === null ? 'найм (нужно число сотрудников)' : null
  return { total, incomplete }
}

/** Attaches level 2 to a solved scenario: the finance, the replaced «money not calculated» texts, the money risks. Returns a new object. */
export function withFinance(
  s: ScenarioResult, build: FinanceBuild, profile: ScenarioProfile, marketingOverRamp: number | null, funnel: boolean,
): ScenarioResult {
  const { finance } = build
  const inv = totalInvestment(marketingOverRamp, build.hiringCost, funnel)
  const keep = (t: string) => !(LEVEL1_CASH_TEXTS as readonly string[]).includes(t)
  const note = [
    s.investments.note.replace(LEVEL1_CASH_TEXTS[1], '').replace(/\s+/g, ' ').trim(),
    inv.incomplete ? `Оценка вложений неполная: не учтён ${inv.incomplete}.` : '',
    'Деньги рассчитаны по финмодели: прибыль и денежный поток показаны отдельно.',
  ].filter(Boolean).join(' ')
  return {
    ...s,
    investments: { ...s.investments, totalOverRamp: inv.total, note },
    risks: [...s.risks.filter(keep), ...financeRisks(finance)],
    conditions: [...s.conditions.filter((c) => !c.startsWith('Политика резерва сценария:')), ...financeConditions(finance, profile)],
    assumptions: [...s.assumptions.filter(keep), 'Деньги рассчитаны по финмодели (допущения денежного потока — в блоке «Деньги»).'],
    finance,
  }
}

// ─── warnings of a level-2 result ───────────────────────────────────────────

/** Expenses by the model against the fact differ by more than this → a warning (the numbers stay). */
export const OPEX_MISMATCH = 0.25

export function level2Warnings(i: ModelInputs, funnel: boolean): string[] {
  const out: string[] = []
  if (usesDefaults(i)) {
    const labels: Record<string, string> = { tax_rate: 'налог', dso_days: 'срок оплаты клиентами', dio_days: 'запасы', dpo_days: 'срок оплаты поставщикам' }
    const list = (i.finmodel?.defaulted ?? []).map((k) => labels[k] ?? k).join(', ')
    out.push(`Оборотный капитал и налог — допущения по отрасли (${list}): укажите свои значения в финмодели, и диапазон сузится.`)
  }
  const fact = i.finmodel?.facts?.opexMonthly
  const model = baseMonthExpenses(i, funnel)
  if (finite(fact) && fact > 0 && model !== null) {
    const diff = Math.abs(model / fact - 1)
    if (diff > OPEX_MISMATCH) {
      out.push(`Расходы по модели расходятся с фактом на ${Math.round(diff * 100)}%: по финмодели ${fmtMoney(model)} в месяц (ФОТ, постоянные расходы, маркетинг), по данным платформы ${fmtMoney(fact)}. Проверьте значения финмодели.`)
    }
  }
  return out
}
