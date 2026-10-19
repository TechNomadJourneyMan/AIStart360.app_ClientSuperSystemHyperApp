/**
 * lib/point-b/model/whatif.ts — the «Что если» lab: the contract (plan Ф4, «Контракты») and the engine.
 *
 * The UI imports only the types, `WHATIF_LABELS` and `WHATIF_RANGES` (the schemas of `validateWhatIf` are
 * built lazily, so importing this module costs the client bundle nothing at load time); the server calls
 * `validateWhatIf` and `runWhatIf`. Engine section: «Движок» below.
 *
 * Units: `budgetPct`, `pct`, `cutPct` are PERCENT numbers (10 means +10 %), `pp` is percentage
 * points, `efficiency`, `demandElasticity` and `revenueEffectPct` are fractions 0..1.
 */
import { z } from 'zod'
import {
  cashInputsOf, financeHorizon, finmodelNumber, marketingBaseMonthly, simulateCash, type CashInputs, type CashSimulation,
} from './cash'
import { computeModel } from './compute'
import { fmtMoney, fmtNum, fmtPct, round } from './format'
import { calibrate, rotateSeasonality, seasonalityIndex, simulateFunnel, type FunnelParams, type FunnelPath } from './funnel'
import { projectGrowth } from './growth'
import { withDerivedActiveBase } from './inputs'
import { FUNNEL_TEMPLATES } from './levels'
import { defaultProfiles } from './profiles'
import { MODEL_VERSION, ModelInputError, type DataLevel, type ModelInputs, type ScenarioProfile } from './types'

export type WhatIfKind = 'marketing' | 'hire' | 'avg_check' | 'conversion' | 'revenue_shock' | 'fixed_costs'

export type WhatIfChange =
  | { kind: 'marketing'; budgetPct: number /* −50..+100 */; efficiency?: number /* 0.3..1, по умолчанию 0.7 */ }
  | { kind: 'hire'; count: number /* 1..20 */; startMonth: number /* 1..H */; revenueEffectPct?: number /* 0..1 выручки на сотрудника, по умолчанию 0 */ }
  | { kind: 'avg_check'; pct: number /* −30..+50 */; demandElasticity?: number /* 0..1, по умолчанию 0.3 */ }
  | { kind: 'conversion'; pp: number /* −10..+20 п.п. */ }
  | { kind: 'revenue_shock'; pct: number /* −60..0 */; startMonth: number; durationMonths: number /* 1..24 */ }
  | { kind: 'fixed_costs'; cutPct: number /* 0..50 */; startMonth: number; oneOffCost?: number /* ≥ 0, ₸ */ }

export interface WhatIfMetrics {
  annualRunRateAtDeadline: number | null // годовой run-rate к сроку цели (в месяц срока)
  revenueFirst12m: number | null
  timeToGoalMonths: number | null // null — цель не достигнута в горизонте
  minCash: { value: number; month: number } | null // только уровень 2
  cashGapMonth: number | null
  fundingNeed: number | null
  ebitdaFirst12m: number | null
}

export interface WhatIfResult {
  modelVersion: string
  level: DataLevel
  computedAt: string
  baseline: WhatIfMetrics
  changed: WhatIfMetrics
  delta: { [K in keyof WhatIfMetrics]?: number | null } // changed − baseline там, где оба числа
  contributions: Array<{ kind: WhatIfKind; label: string; delta: WhatIfResult['delta'] }>
  interaction: WhatIfResult['delta']
  series: { months: number[]; baseline: number[]; changed: number[]; target: number | null } // годовой run-rate по месяцам, month 0 = сейчас
  explanation: string[]
  riskFlags: string[]
  assumptions: string[]
  warnings: string[]
  applicable: Record<WhatIfKind, { ok: boolean; reason: string | null }>
  /** Additive to the contract: months the calculation runs (the upper bound of every `startMonth`); absent at level 0. */
  horizonMonths?: number
}

export const WHATIF_LABELS: Record<WhatIfKind, string> = {
  marketing: 'Маркетинг',
  hire: 'Найм сотрудников',
  avg_check: 'Средний чек',
  conversion: 'Конверсия',
  revenue_shock: 'Падение выручки',
  fixed_costs: 'Постоянные расходы',
}

export const WHATIF_RANGES: Record<WhatIfKind, Record<string, { min: number; max: number; step: number; unit: string; default: number }>> = {
  marketing: {
    budgetPct: { min: -50, max: 100, step: 5, unit: '%', default: 20 },
    efficiency: { min: 0.3, max: 1, step: 0.05, unit: '', default: 0.7 },
  },
  hire: {
    count: { min: 1, max: 20, step: 1, unit: 'чел.', default: 2 },
    startMonth: { min: 1, max: 60, step: 1, unit: 'мес.', default: 1 },
    revenueEffectPct: { min: 0, max: 1, step: 0.05, unit: '', default: 0 },
  },
  avg_check: {
    pct: { min: -30, max: 50, step: 1, unit: '%', default: 10 },
    demandElasticity: { min: 0, max: 1, step: 0.05, unit: '', default: 0.3 },
  },
  conversion: {
    pp: { min: -10, max: 20, step: 0.5, unit: 'п.п.', default: 2 },
  },
  revenue_shock: {
    pct: { min: -60, max: 0, step: 5, unit: '%', default: -20 },
    startMonth: { min: 1, max: 60, step: 1, unit: 'мес.', default: 2 },
    durationMonths: { min: 1, max: 24, step: 1, unit: 'мес.', default: 3 },
  },
  fixed_costs: {
    cutPct: { min: 0, max: 50, step: 1, unit: '%', default: 10 },
    startMonth: { min: 1, max: 60, step: 1, unit: 'мес.', default: 1 },
    oneOffCost: { min: 0, max: 1_000_000_000, step: 10_000, unit: '₸', default: 0 },
  },
}

// ═══ Движок ═════════════════════════════════════════════════════════════════
//
// Every run recalculates the WHOLE model from today’s inputs with the changed INPUTS (never the outputs
// added up): the funnel (or the growth path) gives the monthly revenue, the cash model (level 2) the money.
// The contribution of a change is a separate run with that change alone; the interaction is
// «combined − Σ contributions». Pure: no IO, no clock (`inputs.now` is the only time), no NaN/Infinity.

const MAX_HORIZON = 60
const MIN_HORIZON = 12
export const WHATIF_MAX_CHANGES = 6
export const DEFAULT_EFFICIENCY = 0.7
export const DEFAULT_ELASTICITY = 0.3
/** A change of the conversion cannot push it above this (or above today’s level, if that is higher). */
export const CONVERSION_CEILING = 0.6
const REACHED = 1 - 1e-9

const KINDS = Object.keys(WHATIF_LABELS) as WhatIfKind[]
const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n)

/** An invalid change: the text is for the user, `field` names the input (`changes[1].pp`). */
export class WhatIfInputError extends ModelInputError {
  constructor(message: string, public readonly field: string) {
    super(message)
    this.name = 'WhatIfInputError'
  }
}

// ─── validation ─────────────────────────────────────────────────────────────

type Schemas = Record<WhatIfKind, z.ZodTypeAny>
let schemasCache: Schemas | null = null

/** A number in a range; every failure says what is allowed. */
function num(label: string, min: number, max: number, unit: string, o: { int?: boolean } = {}) {
  const say = `${label}: ${o.int ? 'целое число' : 'число'} от ${fmtNum(min)} до ${fmtNum(max)}${unit ? ` ${unit}` : ''}`
  let s = z.number({ invalid_type_error: say, required_error: `${label}: укажите значение` }).finite(say)
  if (o.int) s = s.int(say)
  return s.min(min, say).max(max, say)
}

function schemas(): Schemas {
  if (schemasCache) return schemasCache
  const R = WHATIF_RANGES
  const r = (kind: WhatIfKind, key: string, label: string, o: { int?: boolean } = {}) => {
    const x = R[kind][key]
    return num(label, x.min, x.max, x.unit === 'п.п.' ? 'п.п.' : x.unit, o)
  }
  schemasCache = {
    marketing: z.object({
      kind: z.literal('marketing'),
      budgetPct: r('marketing', 'budgetPct', 'Изменение маркетингового бюджета'),
      efficiency: r('marketing', 'efficiency', 'Эффективность маркетинга').optional(),
    }),
    hire: z.object({
      kind: z.literal('hire'),
      count: r('hire', 'count', 'Число сотрудников', { int: true }),
      startMonth: r('hire', 'startMonth', 'Месяц найма', { int: true }),
      revenueEffectPct: r('hire', 'revenueEffectPct', 'Доля выручки на сотрудника').optional(),
    }),
    avg_check: z.object({
      kind: z.literal('avg_check'),
      pct: r('avg_check', 'pct', 'Изменение среднего чека'),
      demandElasticity: r('avg_check', 'demandElasticity', 'Эластичность спроса').optional(),
    }),
    conversion: z.object({
      kind: z.literal('conversion'),
      pp: r('conversion', 'pp', 'Изменение конверсии'),
    }),
    revenue_shock: z.object({
      kind: z.literal('revenue_shock'),
      pct: r('revenue_shock', 'pct', 'Падение выручки'),
      startMonth: r('revenue_shock', 'startMonth', 'Месяц начала падения', { int: true }),
      durationMonths: r('revenue_shock', 'durationMonths', 'Длительность падения', { int: true }),
    }),
    fixed_costs: z.object({
      kind: z.literal('fixed_costs'),
      cutPct: r('fixed_costs', 'cutPct', 'Сокращение постоянных расходов'),
      startMonth: r('fixed_costs', 'startMonth', 'Месяц начала сокращения', { int: true }),
      oneOffCost: num('Разовые затраты', 0, 1e12, '₸').optional(),
    }),
  }
  return schemasCache
}

/**
 * The changes a user sent → typed changes (unknown fields dropped), or the first error with the field.
 * `horizonMonths`, when known, also bounds every `startMonth`. At most 6 changes, one of each kind.
 */
export function validateWhatIf(
  raw: unknown, opts: { horizonMonths?: number } = {},
): { ok: true; changes: WhatIfChange[] } | { ok: false; error: string; field: string } {
  const err = (error: string, field: string) => ({ ok: false as const, error, field })
  if (!Array.isArray(raw)) return err('Передайте список изменений', 'changes')
  if (raw.length > WHATIF_MAX_CHANGES) return err(`За один расчёт можно менять не больше ${WHATIF_MAX_CHANGES} параметров`, 'changes')

  const out: WhatIfChange[] = []
  const seen = new Set<string>()
  for (let i = 0; i < raw.length; i++) {
    const item = raw[i] as unknown
    const at = `changes[${i}]`
    if (!item || typeof item !== 'object' || Array.isArray(item)) return err('Изменение задано неверно', at)
    const kind = (item as { kind?: unknown }).kind
    if (typeof kind !== 'string' || !(KINDS as string[]).includes(kind)) return err('Неизвестный калькулятор', `${at}.kind`)
    if (seen.has(kind)) return err(`«${WHATIF_LABELS[kind as WhatIfKind]}» указан дважды: оставьте одно изменение каждого вида`, `${at}.kind`)
    seen.add(kind)

    const parsed = schemas()[kind as WhatIfKind].safeParse(item)
    if (!parsed.success) {
      const issue = parsed.error.issues[0]
      const key = issue.path[0]
      return err(issue.message, typeof key === 'string' ? `${at}.${key}` : at)
    }
    const change = parsed.data as WhatIfChange
    // zod drops optional keys that were not given; undefined values are not carried either
    const clean = Object.fromEntries(Object.entries(change).filter(([, v]) => v !== undefined)) as unknown as WhatIfChange
    if (finite(opts.horizonMonths) && 'startMonth' in clean && clean.startMonth > opts.horizonMonths) {
      return err(`Старт в месяце ${clean.startMonth} выходит за расчётный период (${opts.horizonMonths} мес.)`, `${at}.startMonth`)
    }
    out.push(clean)
  }
  return { ok: true, changes: out }
}

// ─── the prepared model ─────────────────────────────────────────────────────

interface Prepared {
  inputs: ModelInputs
  level: DataLevel
  kind: 'funnel' | 'growth'
  profile: ScenarioProfile
  A: number
  T: number
  /** The month of the goal’s deadline, 1..60. */
  m: number
  H: number
  ramp: number
  funnel: { params: FunnelParams; L0: number; c0: number; p0: number } | null
  /** Annual growth of the baseline of the growth model (0 = flat). */
  annualGrowth: number
  trendUsed: 'trend' | 'flat'
  payroll: number | null
  headcount: number | null
  /** A cost basis for marketing exists (CAC × customers or the advertising spend). */
  marketingBasis: boolean
  /** The cash model can be built (level 2). */
  money: boolean
  notes: string[]
  applicable: WhatIfResult['applicable']
}

const hasNum = (s: { value: number | null }): boolean => finite(s.value) && s.value > 0

function profileFor(inputs: ModelInputs, opts: { profile?: ScenarioProfile }): ScenarioProfile {
  if (opts.profile) return opts.profile
  const all = defaultProfiles(inputs.template)
  return all.find((p) => p.key === 'moderate') ?? all[0]
}

function funnelReason(inputs: ModelInputs): string {
  const L = inputs.levers
  if (!(hasNum(L.leads) && hasNum(L.conversion) && hasNum(L.avgCheck))) {
    return 'Нужна воронка: добавьте лиды в месяц, конверсию и средний чек (анкета, документы или эксперт).'
  }
  if (!FUNNEL_TEMPLATES.includes(inputs.template)) return 'Для вашей отрасли расчёт идёт по упрощённой модели роста, без воронки.'
  return 'Воронка не сходится с фактом выручки: расчёт идёт по упрощённой модели роста. Проверьте лиды, конверсию, средний чек и выручку.'
}

function applicabilityLevel0(reason: string): WhatIfResult['applicable'] {
  return Object.fromEntries(KINDS.map((k) => [k, { ok: false, reason }])) as WhatIfResult['applicable']
}

function prepare(inputs: ModelInputs, opts: { profile?: ScenarioProfile; horizonMonths?: number }): Prepared | { level0: ReturnType<typeof computeModel> } {
  const res = computeModel(inputs)
  if (res.level === 0 || !inputs.goal) return { level0: res }
  const profile = profileFor(inputs, opts)
  const A = inputs.base.revenueYear.value as number
  const T = inputs.goal.targetAnnual
  const m = Math.min(MAX_HORIZON, Math.max(1, Math.floor(inputs.goal.months)))
  const ramp = Math.max(1, profile.rampMonths)
  const H = finite(opts.horizonMonths)
    ? Math.min(MAX_HORIZON, Math.max(m, MIN_HORIZON, Math.floor(opts.horizonMonths)))
    : financeHorizon(m, ramp)

  const notes: string[] = []
  let funnel: Prepared['funnel'] = null
  if (res.kind === 'funnel') {
    const lev = withDerivedActiveBase(inputs.levers)
    const L0 = lev.leads.value as number
    const c0 = lev.conversion.value as number
    const p0 = lev.avgCheck.value as number
    const R0 = hasNum(lev.repeat) ? (lev.repeat.value as number) : 0
    const B0 = finite(lev.activeBase.value) && lev.activeBase.value >= 0 ? lev.activeBase.value : L0 * c0 * 12
    // The calibration uses the seasonal indices (as in the scenarios); the trajectory is shown without the season.
    const season = rotateSeasonality(seasonalityIndex(inputs.history).index, inputs.now)
    const cal = calibrate({ revenueYear: A, params: { leads: L0, conversion: c0, avgCheck: p0, repeat: R0, activeBase0: B0, seasonality: season } })
    funnel = {
      params: { leads: L0, conversion: c0, avgCheck: p0, repeat: R0, activeBase0: B0, seasonality: Array(12).fill(1) as number[], otherMonthly: cal.otherMonthly },
      L0, c0, p0,
    }
  }

  let annualGrowth = 0
  let trendUsed: Prepared['trendUsed'] = 'flat'
  if (!funnel) {
    const trend = res.forecast.trendMonthlyPct
    if (finite(trend)) {
      const annual = (1 + trend / 100) ** 12 - 1
      if (finite(annual) && annual > -1) {
        annualGrowth = Math.min(annual, profile.growthCapAnnual)
        trendUsed = 'trend'
      }
    }
  }

  const kind: Prepared['kind'] = funnel ? 'funnel' : 'growth'
  const payroll = finmodelNumber(inputs.finmodel, 'payroll')
  const headcount = hasNum(inputs.levers.headcount) ? (inputs.levers.headcount.value as number) : null
  const marketingBasis = marketingBaseMonthly(inputs, kind === 'funnel') !== null

  const reasonFunnel = funnel ? null : funnelReason(inputs)
  const hireReason = payroll === null || !(payroll > 0)
    ? (headcount === null ? 'Нужны фонд оплаты труда (финмодель) и число сотрудников.' : 'Нужен фонд оплаты труда: заполните финмодель.')
    : headcount === null ? 'Нужно число сотрудников: стоимость сотрудника считается как ФОТ, делённый на численность.' : null
  const applicable: WhatIfResult['applicable'] = {
    marketing: { ok: funnel !== null, reason: reasonFunnel },
    avg_check: { ok: funnel !== null, reason: reasonFunnel },
    conversion: { ok: funnel !== null, reason: reasonFunnel },
    hire: { ok: hireReason === null, reason: hireReason },
    revenue_shock: { ok: true, reason: null },
    fixed_costs: { ok: true, reason: null },
  }

  const prep: Prepared = {
    inputs, level: res.level, kind, profile, A, T, m, H, ramp, funnel, annualGrowth, trendUsed, payroll, headcount,
    marketingBasis, money: res.level === 2, notes, applicable,
  }
  return prep
}

// ─── one run ────────────────────────────────────────────────────────────────

interface Run {
  /** Monthly revenue 1..H, ₸. */
  monthly: number[]
  newCustomers: number[] | null
  sim: CashSimulation | null
  /** The reserve required (₸): the base month’s expenses moved by the recurring costs the changes add. */
  reserve: number | null
  /** Money is not known for this run (a marketing change without a cost basis). */
  moneyUnknown: boolean
  /** Fixed costs of the last month (₸), for the reserve. */
  fixedEnd: number | null
}

type ByKind = { [K in WhatIfKind]?: Extract<WhatIfChange, { kind: K }> }

function byKind(changes: WhatIfChange[]): ByKind {
  const out: Record<string, WhatIfChange> = {}
  for (const c of changes) out[c.kind] = c
  return out as ByKind
}

function execute(p: Prepared, changes: WhatIfChange[], baseSim: CashSimulation | null): Run {
  const by = byKind(changes)
  const { H, A, ramp } = p
  const u = (t: number): number => Math.min(1, t / ramp)

  // 1. revenue
  let monthly: number[]
  let newCustomers: number[] | null = null
  if (p.funnel) {
    const { L0, c0, p0 } = p.funnel
    const mk = by.marketing
    const ck = by.avg_check
    const cv = by.conversion
    const path: FunnelPath = { leads: [], conversion: [], avgCheck: [], repeat: [] }
    for (let t = 1; t <= H; t++) {
      const leadsFactor = mk ? 1 + (mk.budgetPct / 100) * (mk.efficiency ?? DEFAULT_EFFICIENCY) * u(t) : 1
      const checkPct = ck ? (ck.pct / 100) * u(t) : 0
      const elasticity = ck ? ck.demandElasticity ?? DEFAULT_ELASTICITY : 0
      const convBase = c0 + (cv ? (cv.pp / 100) * u(t) : 0)
      const conv = convBase * (1 - elasticity * checkPct)
      path.leads.push(L0 * leadsFactor)
      path.avgCheck.push(p0 * (1 + checkPct))
      path.conversion.push(Math.min(Math.max(0, conv), Math.max(CONVERSION_CEILING, c0)))
    }
    const sim = simulateFunnel(p.funnel.params, path, H)
    monthly = sim.revenue
    newCustomers = sim.newCustomers
  } else {
    monthly = projectGrowth({ baseAnnual: A, annualGrowth: p.annualGrowth, months: H }).map((v) => v / 12)
  }

  // 2. hiring may bring revenue (default: none); a revenue shock multiplies the month
  const hire = by.hire
  if (hire && (hire.revenueEffectPct ?? 0) > 0 && p.headcount) {
    const perEmployee = A / 12 / p.headcount
    for (let t = hire.startMonth; t <= H; t++) {
      monthly[t - 1] += (hire.revenueEffectPct ?? 0) * perEmployee * hire.count * Math.min(1, (t - hire.startMonth + 1) / ramp)
    }
  }
  const shock = by.revenue_shock
  if (shock) {
    for (let t = shock.startMonth; t <= Math.min(H, shock.startMonth + shock.durationMonths - 1); t++) monthly[t - 1] *= 1 + shock.pct / 100
  }
  monthly = monthly.map((v) => Math.max(0, v))

  // 3. money (level 2)
  if (!p.money) return { monthly, newCustomers, sim: null, reserve: null, moneyUnknown: false, fixedEnd: null }
  const fixed0 = finmodelNumber(p.inputs.finmodel, 'fixed') as number
  const extra: Partial<CashInputs> = {}
  let fixedEnd = fixed0
  if (baseSim) {
    // Marketing moves only by the decision «Маркетинг»; payroll only by hiring; fixed costs only by their cut.
    const mk = by.marketing
    extra.marketingPath = baseSim.marketing.map((v, k) => v * (mk ? 1 + (mk.budgetPct / 100) * u(k + 1) : 1))
    if (hire && p.headcount) extra.payrollGrowth = Array.from({ length: H }, (_, k) => (k + 1 >= hire.startMonth ? hire.count / (p.headcount as number) : 0))
    const fc = by.fixed_costs
    if (fc) {
      extra.fixedCostsPath = Array.from({ length: H }, (_, k) => (k + 1 >= fc.startMonth ? fixed0 * (1 - fc.cutPct / 100) : fixed0))
      extra.oneOff = Array.from({ length: H }, (_, k) => (k + 1 === fc.startMonth ? fc.oneOffCost ?? 0 : 0))
      fixedEnd = extra.fixedCostsPath[H - 1]
    }
  }
  const ci = cashInputsOf(
    p.inputs, p.profile, { revenue: monthly, newCustomers },
    { funnel: p.kind === 'funnel', staffNeed: null, baseMonthlyRevenue: A / 12 }, extra,
  )
  const sim = simulateCash(ci)
  let reserve = sim.reserveRequired
  if (baseSim) {
    const recurring = (sim.payroll[H - 1] - baseSim.payroll[H - 1]) + (fixedEnd - fixed0) + (sim.marketing[H - 1] - baseSim.marketing[H - 1])
    reserve = Math.max(0, baseSim.reserveRequired + p.profile.reserveMonths * recurring)
  }
  const moneyUnknown = !!by.marketing && !p.marketingBasis
  return { monthly, newCustomers, sim, reserve, moneyUnknown, fixedEnd }
}

// ─── metrics ────────────────────────────────────────────────────────────────

const sumTo = (a: number[], n: number): number => a.slice(0, n).reduce((x, y) => x + y, 0)
const whole = (v: number): number | null => (finite(v) ? round(v, 0) : null)

function metricsOf(p: Prepared, run: Run): WhatIfMetrics {
  const rr = run.monthly.map((v) => v * 12)
  const idx = rr.findIndex((v) => v >= p.T * REACHED)
  const timeToGoal = p.A >= p.T * REACHED ? 0 : idx === -1 ? null : idx + 1
  const out: WhatIfMetrics = {
    annualRunRateAtDeadline: whole(rr[p.m - 1]),
    revenueFirst12m: whole(sumTo(run.monthly, 12)),
    timeToGoalMonths: timeToGoal,
    minCash: null, cashGapMonth: null, fundingNeed: null, ebitdaFirst12m: null,
  }
  if (run.sim && !run.moneyUnknown) {
    const minCash = whole(run.sim.minCash.value)
    const need = run.reserve === null ? null : whole(Math.max(0, run.reserve - run.sim.minCash.value))
    out.minCash = minCash === null ? null : { value: minCash, month: run.sim.minCash.month }
    out.cashGapMonth = run.sim.cashGapMonth
    out.fundingNeed = need
    out.ebitdaFirst12m = whole(sumTo(run.sim.ebitda, 12))
  }
  return out
}

const DELTA_KEYS = ['annualRunRateAtDeadline', 'revenueFirst12m', 'timeToGoalMonths', 'minCash', 'cashGapMonth', 'fundingNeed', 'ebitdaFirst12m'] as const

function valueOf(m: WhatIfMetrics, k: (typeof DELTA_KEYS)[number]): number | null {
  const v = m[k]
  if (k === 'minCash') return v === null ? null : (v as { value: number }).value
  return typeof v === 'number' ? v : null
}

function deltaOf(changed: WhatIfMetrics, baseline: WhatIfMetrics): WhatIfResult['delta'] {
  const out: WhatIfResult['delta'] = {}
  for (const k of DELTA_KEYS) {
    const a = valueOf(changed, k)
    const b = valueOf(baseline, k)
    out[k] = a !== null && b !== null ? a - b : null
  }
  return out
}

function interactionOf(combined: WhatIfResult['delta'], parts: Array<WhatIfResult['delta']>): WhatIfResult['delta'] {
  const out: WhatIfResult['delta'] = {}
  for (const k of DELTA_KEYS) {
    const c = combined[k]
    const ps = parts.map((d) => d[k])
    out[k] = typeof c === 'number' && ps.every((v): v is number => typeof v === 'number') ? c - ps.reduce((x, y) => x + y, 0) : null
  }
  return out
}

// ─── texts ──────────────────────────────────────────────────────────────────

const money = (n: number | null | undefined): string => fmtMoney(n)
const sMoney = (n: number | null | undefined): string => (finite(n) && n > 0 ? `+${fmtMoney(n)}` : fmtMoney(n))
const sPct = (n: number, digits = 0): string => `${n > 0 ? '+' : ''}${fmtNum(n, digits)}%`
const months = (n: number): string => `${fmtNum(n, 0)} мес.`
/** 0,70 → «0,7», 1,00 → «1»: a parameter without trailing zeros. */
const plain = (n: number, digits = 2): string => fmtNum(n, digits).replace(/,?0+$/, '')

function describeChange(p: Prepared, c: WhatIfChange): string {
  switch (c.kind) {
    case 'marketing': {
      const eff = c.efficiency ?? DEFAULT_EFFICIENCY
      return `Маркетинг ${sPct(c.budgetPct)}: лиды ${sPct(c.budgetPct * eff, 1)} (эффективность ${plain(eff)}), затраты на маркетинг ${sPct(c.budgetPct)}`
    }
    case 'hire': {
      const per = p.payroll !== null && p.headcount ? p.payroll / p.headcount : null
      return `Найм ${fmtNum(c.count)} чел. с месяца ${c.startMonth}${per !== null ? `: ФОТ ${sMoney(c.count * per)} в месяц` : ''}`
    }
    case 'avg_check': {
      const el = c.demandElasticity ?? DEFAULT_ELASTICITY
      const d = c.pct / 100
      return `Средний чек ${sPct(c.pct)} при эластичности ${plain(el)}: конверсия ×${fmtNum(1 - el * d, 3)}, выручка на плато ×${fmtNum((1 + d) * (1 - el * d), 3)}`
    }
    case 'conversion':
      return `Конверсия ${c.pp > 0 ? '+' : ''}${fmtNum(c.pp, 1)} п.п. (с ${fmtPct(p.funnel?.c0 ?? null, 1)} до ${fmtPct((p.funnel?.c0 ?? 0) + c.pp / 100, 1)})`
    case 'revenue_shock':
      return `Падение выручки ${sPct(c.pct)} на ${months(c.durationMonths)} с месяца ${c.startMonth}`
    case 'fixed_costs':
      return `Постоянные расходы −${fmtNum(c.cutPct)}% с месяца ${c.startMonth}${c.oneOffCost ? `, разовые затраты ${money(c.oneOffCost)}` : ''}`
  }
}

function assumptionsFor(p: Prepared, changes: WhatIfChange[], baseSim: CashSimulation | null): string[] {
  const out: string[] = []
  if (p.funnel) {
    out.push('Базовый расчёт — «ничего не менять»: лиды, конверсия, средний чек и повторные продажи остаются на текущем уровне (воронка с калибровкой по факту; сезонность учтена в калибровке, траектория показана без сезонных колебаний).')
  } else if (p.trendUsed === 'trend') {
    out.push(`Базовый расчёт — «ничего не менять»: упрощённая модель роста с текущим трендом выручки (${fmtPct(p.annualGrowth, 1)} в год, не выше потолка профиля «${p.profile.label}» — ${fmtPct(p.profile.growthCapAnnual)}).`)
  } else {
    out.push('Базовый расчёт — «ничего не менять»: упрощённая модель роста, выручка остаётся на текущем уровне (истории выручки для тренда недостаточно).')
  }
  out.push(`Изменения воронки входят линейно за ${months(p.ramp)} (профиль темпа «${p.profile.label}»); горизонт расчёта — ${months(p.H)}`)
  out.push('Каждое изменение пересчитывает всю модель заново; вклад — отдельный прогон, эффект взаимодействия — разница между совместным результатом и суммой вкладов.')
  if (p.money) out.push('Маркетинг меняется только решением «Маркетинг», ФОТ — только наймом, постоянные расходы — только их сокращением: CAC при изменении конверсии или чека не считается заново.')
  for (const c of changes) {
    if (c.kind === 'marketing') {
      out.push(`Эффективность маркетинга ${plain(c.efficiency ?? DEFAULT_EFFICIENCY)} (допущение, диапазон 0,3–1): лиды растут на бюджет × эффективность, затраты — на весь бюджет.`)
      if (!p.marketingBasis) out.push('Деньги по маркетингу не рассчитаны: нужен CAC или расходы на рекламу.')
    } else if (c.kind === 'hire') {
      const eff = c.revenueEffectPct ?? 0
      out.push(eff > 0
        ? `Эффект найма на выручку ${fmtPct(eff)} от выручки на сотрудника (допущение), линейно за ${months(p.ramp)} после старта.`
        : 'Эффект найма на выручку не предполагается (0): сотрудники только увеличивают ФОТ. Если они приносят выручку, задайте долю выручки на сотрудника.')
      out.push('Стоимость сотрудника — средняя: ФОТ, делённый на текущую численность.')
    } else if (c.kind === 'avg_check') {
      out.push(`Эластичность спроса по чеку ${plain(c.demandElasticity ?? DEFAULT_ELASTICITY)} (допущение, диапазон 0–1): конверсия меняется на −эластичность × изменение чека; конверсия не выше ${fmtPct(Math.max(CONVERSION_CEILING, p.funnel?.c0 ?? 0))}.`)
    } else if (c.kind === 'conversion') {
      out.push(`Конверсия растёт линейно за ${months(p.ramp)} и не выше ${fmtPct(Math.max(CONVERSION_CEILING, p.funnel?.c0 ?? 0))}.`)
    } else if (c.kind === 'revenue_shock') {
      out.push('Падение выручки умножает выручку месяца; затраты не меняются, себестоимость пропорциональна выручке.')
    } else if (c.kind === 'fixed_costs') {
      out.push('Сокращение постоянных расходов действует с указанного месяца; разовые затраты вычитаются из EBITDA в месяц начала.')
    }
  }
  if (p.money && changes.length > 0) out.push('Резерв ликвидности пересчитан на расходы в конце периода: рост расходов увеличивает потребность в финансировании, сокращение — уменьшает.')
  if (baseSim) out.push(...baseSim.assumptions)
  return out
}

function explain(p: Prepared, effective: WhatIfChange[], contributions: WhatIfResult['contributions'], base: WhatIfMetrics, changed: WhatIfMetrics, delta: WhatIfResult['delta'], interaction: WhatIfResult['delta']): string[] {
  if (effective.length === 0) return ['Изменений нет: результат равен базовому расчёту («ничего не менять»). Подвигайте параметры, чтобы увидеть влияние на выручку, срок цели и деньги.']
  const out: string[] = []
  const one = effective.length === 1
  effective.forEach((c, i) => {
    const d = contributions[i].delta
    const parts: string[] = []
    if (typeof d.annualRunRateAtDeadline === 'number' && d.annualRunRateAtDeadline !== 0 && base.annualRunRateAtDeadline) {
      parts.push(`годовая выручка к сроку цели ${sMoney(d.annualRunRateAtDeadline)} (${sPct((d.annualRunRateAtDeadline / base.annualRunRateAtDeadline) * 100, 1)})`)
    } else if (c.kind !== 'fixed_costs' && c.kind !== 'hire') {
      parts.push('годовая выручка к сроку цели не меняется')
    }
    if (p.money) {
      if (typeof d.ebitdaFirst12m === 'number') parts.push(`EBITDA за 12 мес. ${sMoney(d.ebitdaFirst12m)}`)
      if (typeof d.minCash === 'number') parts.push(`минимальная касса ${sMoney(d.minCash)}`)
    }
    out.push(`${describeChange(p, c)}.${parts.length ? ` Итог: ${parts.join('; ')}.` : ''}`)
  })
  if (!one) {
    const i = interaction.annualRunRateAtDeadline
    if (typeof i === 'number' && i !== 0) {
      out.push(`Эффект взаимодействия изменений: ${sMoney(i)} к годовой выручке к сроку цели — вместе они дают ${i > 0 ? 'больше' : 'меньше'}, чем по отдельности.`)
    }
  }
  const tb = base.timeToGoalMonths
  const tc = changed.timeToGoalMonths
  if (tc !== null && tb !== null && tc !== tb) out.push(`Цель по выручке достигается ${tc < tb ? 'быстрее' : 'позже'}: через ${months(tc)} вместо ${months(tb)}.`)
  else if (tc !== null && tb === null) out.push(`Цель по выручке достигается через ${months(tc)}; без изменений она не достигается за ${months(p.H)}.`)
  else if (tc === null && tb !== null) out.push(`Без изменений цель достигается через ${months(tb)}, а с ними — не достигается за ${months(p.H)}.`)
  else if (tc === null && tb === null) out.push(`Цель по выручке не достигается за ${months(p.H)} ни в базовом расчёте, ни с изменениями.`)
  if (typeof delta.fundingNeed === 'number' && delta.fundingNeed !== 0) out.push(`Потребность в финансировании ${delta.fundingNeed > 0 ? 'растёт' : 'снижается'} на ${money(Math.abs(delta.fundingNeed))}.`)
  return out
}

function risksFor(p: Prepared, effective: WhatIfChange[], base: WhatIfMetrics, changed: WhatIfMetrics): string[] {
  const out: string[] = []
  if (changed.cashGapMonth !== null) {
    const was = base.cashGapMonth
    out.push(`Кассовый разрыв в месяце ${changed.cashGapMonth}${was === null ? ' — в базовом расчёте его нет' : was !== changed.cashGapMonth ? ` (в базовом расчёте — в месяце ${was})` : ''}: минимум на счёте ${money(changed.minCash?.value)}.`)
  }
  if (changed.fundingNeed !== null && changed.fundingNeed > 0) {
    out.push(`Нужно финансирование около ${money(changed.fundingNeed)}${base.fundingNeed ? ` (в базовом расчёте — ${money(base.fundingNeed)})` : ''}.`)
  }
  const tb = base.timeToGoalMonths
  const tc = changed.timeToGoalMonths
  if ((tb !== null && tc !== null && tc > tb) || (tb !== null && tc === null)) {
    out.push(`Срок достижения цели сдвигается позже: ${tc === null ? `цель не достигается за ${months(p.H)}` : `${months(tc)} вместо ${months(tb)}`}.`)
  }
  const rb = base.annualRunRateAtDeadline
  const rc = changed.annualRunRateAtDeadline
  if (effective.length > 0 && rb !== null && rc !== null && rc < p.T * REACHED && rc < rb) {
    out.push(`К сроку цели выручка падает ниже цели: ${money(rc)} в год против цели ${money(p.T)}.`)
  }
  return out
}

// ─── the entry point ────────────────────────────────────────────────────────

const metricsNull = (): WhatIfMetrics => ({
  annualRunRateAtDeadline: null, revenueFirst12m: null, timeToGoalMonths: null, minCash: null, cashGapMonth: null, fundingNeed: null, ebitdaFirst12m: null,
})
const emptyDelta = (): WhatIfResult['delta'] => Object.fromEntries(DELTA_KEYS.map((k) => [k, null])) as WhatIfResult['delta']

/**
 * What if… — the whole model recalculated from today’s inputs with the changed INPUTS.
 * Throws `WhatIfInputError` (a ModelInputError with the `field`) for changes that are out of range, repeated
 * or start beyond the horizon; everything else (a calculator that does not apply, a missing CAC…) is an
 * explanation in `applicable` / `warnings`, never a crash and never an invented number.
 */
export function runWhatIf(
  inputs: ModelInputs, changes: WhatIfChange[], opts: { profile?: ScenarioProfile; horizonMonths?: number } = {},
): WhatIfResult {
  const checked = validateWhatIf(changes)
  if (!checked.ok) throw new WhatIfInputError(checked.error, checked.field)

  const p = prepare(inputs, opts)
  if ('level0' in p) {
    const res = p.level0
    const reason = res.missing.length
      ? `Недостаточно данных: ${res.missing.map((x) => x.label.toLowerCase()).join(', ')}.`
      : (res.warnings[0] ?? 'Недостаточно данных для расчёта.')
    return {
      modelVersion: MODEL_VERSION, level: 0, computedAt: inputs.now,
      baseline: metricsNull(), changed: metricsNull(), delta: emptyDelta(), contributions: [], interaction: emptyDelta(),
      series: { months: [], baseline: [], changed: [], target: inputs.goal && finite(inputs.goal.targetAnnual) ? inputs.goal.targetAnnual : null },
      explanation: [`${reason} «Что если» заработает, когда будут цель по выручке и текущая выручка.`],
      riskFlags: [], assumptions: [], warnings: res.warnings, applicable: applicabilityLevel0(reason),
    }
  }

  const horizon = validateWhatIf(changes, { horizonMonths: p.H })
  if (!horizon.ok) throw new WhatIfInputError(horizon.error, horizon.field)

  const warnings: string[] = []
  const effective = checked.changes.filter((c) => {
    const a = p.applicable[c.kind]
    if (!a.ok) warnings.push(`Изменение «${WHATIF_LABELS[c.kind]}» не применено: ${a.reason}`)
    return a.ok
  })

  let baseSim: CashSimulation | null = null
  let baseline: Run
  try {
    baseline = execute(p, [], null)
    baseSim = baseline.sim
  } catch (err) {
    if (!(err instanceof ModelInputError) || !p.money) throw err
    // The money cannot be built from the finmodel: the lab stays at level 1.
    p.money = false
    p.level = 1
    warnings.push('Деньги не рассчитаны: значения финмодели нельзя использовать в расчёте. Проверьте ввод.')
    baseline = execute(p, [], null)
  }

  const run = (cs: WhatIfChange[]): Run => (cs.length === 0 ? baseline : execute(p, cs, baseSim))
  const combined = run(effective)
  const baseM = metricsOf(p, baseline)
  const changedM = effective.length === 0 ? baseM : metricsOf(p, combined)
  const delta = deltaOf(changedM, baseM)

  const contributions: WhatIfResult['contributions'] = effective.map((c) => ({
    kind: c.kind,
    label: WHATIF_LABELS[c.kind],
    delta: effective.length === 1 ? delta : deltaOf(metricsOf(p, run([c])), baseM),
  }))
  const interaction = interactionOf(delta, contributions.map((c) => c.delta))

  // Notes about money
  if (!p.money) {
    if (effective.some((c) => c.kind === 'fixed_costs')) warnings.push('Постоянные расходы влияют на деньги: заполните финмодель (уровень 2), и эффект появится в EBITDA и кассе.')
    if (effective.some((c) => c.kind === 'hire')) warnings.push('Найм считается в деньгах: заполните финмодель (уровень 2), и затраты на ФОТ появятся в расчёте.')
  }
  if (combined.moneyUnknown) warnings.push('Деньги по маркетингу не рассчитаны: нужен CAC (стоимость привлечения клиента) или расходы на рекламу. Выручка посчитана.')
  if (p.money && effective.length > 1 && effective.some((c) => c.kind === 'marketing') && !p.marketingBasis) {
    warnings.push('Вклады остальных изменений в деньгах посчитаны отдельно; совместный денежный результат недоступен без CAC или расходов на рекламу.')
  }

  const series = (r: Run): number[] => [round(p.A, 0), ...r.monthly.map((v) => round(v * 12, 0))]
  const result: WhatIfResult = {
    modelVersion: MODEL_VERSION,
    level: p.level,
    computedAt: inputs.now,
    baseline: baseM,
    changed: changedM,
    delta,
    contributions,
    interaction,
    series: {
      months: Array.from({ length: p.H + 1 }, (_, t) => t),
      baseline: series(baseline),
      changed: series(effective.length === 0 ? baseline : combined),
      target: round(p.T, 0),
    },
    explanation: explain(p, effective, contributions, baseM, changedM, delta, interaction),
    riskFlags: risksFor(p, effective, baseM, changedM),
    assumptions: assumptionsFor(p, effective, baseSim),
    warnings,
    applicable: p.applicable,
    horizonMonths: p.H,
  }
  return result
}

/**
 * The raw runs behind a result (monthly revenue, the full cash simulation): for tests and debugging, so the
 * identities of the cash model can be checked on the changed run. Not used by the routes.
 */
export function inspectWhatIf(
  inputs: ModelInputs, changes: WhatIfChange[], opts: { profile?: ScenarioProfile; horizonMonths?: number } = {},
): { baseline: Run; changed: Run } {
  const checked = validateWhatIf(changes)
  if (!checked.ok) throw new WhatIfInputError(checked.error, checked.field)
  const p = prepare(inputs, opts)
  if ('level0' in p) throw new ModelInputError('Недостаточно данных для расчёта')
  const effective = checked.changes.filter((c) => p.applicable[c.kind].ok)
  const baseline = execute(p, [], null)
  return { baseline, changed: execute(p, effective, baseline.sim) }
}
