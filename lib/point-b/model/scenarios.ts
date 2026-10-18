/**
 * lib/point-b/model/scenarios.ts — the inverse problem per pace profile (spec §9.4). Pure.
 *
 * Funnel. The goal is an annual run-rate T at the deadline; today it is A. The part of the revenue
 * the funnel explains must grow by Gm = (T − other·12) / (steady-state funnel revenue today), and the
 * levers share that growth by the profile's `leverMix`: ln m_i = w_i · ln Gm for leads, conversion
 * and the check; the repeat share raises (1 + R) the same way. The levers then move LINEARLY from
 * today's level to the target level in `rampMonths`; the trajectory is simulated month by month with
 * the funnel model (the active base catches up with a lag of up to 12 months) and the goal is reached
 * in the first month when the mean of the last three months × 12 is at least T. The run-rate is
 * seasonally adjusted. Sizing does not depend on the pace; the pace decides WHEN.
 *
 * Ranges. The band delta (bands.ts) scales the pace: the unfavourable case moves the levers
 * (1 − delta) as fast, the favourable (1 + delta) as fast — slower pace = later and lower at the deadline.
 * Ceilings of realisability (lever caps) make a scenario infeasible with a reason; being late is not
 * infeasibility. Growth model. A constant yearly growth, limited by the profile's cap.
 */
import { bandText, volatilityBand } from './bands'
import { fmtMoney, fmtMonths, fmtNum, fmtPct, fmtTimes, round, safeRatio } from './format'
import { simulateFunnel, type FunnelParams, type FunnelPath } from './funnel'
import { projectGrowth, requiredAnnualGrowth, timeToTarget } from './growth'
import { withDerivedActiveBase } from './inputs'
import {
  ModelInputError, type ModelInputs, type Range, type ScenarioProfile, type ScenarioResult,
} from './types'

/** Ceilings of realisability of a lever (spec §9.4). */
export const LEVER_CAPS = {
  leadsTimes: 3,
  conversionTimes: 2,
  conversionMax: 0.6,
  avgCheckTimes: 2,
  repeatMax: 0.9,
} as const

export const MODEL_HORIZON_MAX = 60
const REACHED = 1 - 1e-9
const CASH_NOT_ESTIMATED = 'Кассовый разрыв не оценён: нет данных о деньгах (уровень 2).'

const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n)

/** A sentence that ends with a number of months («12 мес.») already has its full stop. */
const sentence = (text: string): string => (text.endsWith('.') ? text : `${text}.`)

type LeverKey = 'leads' | 'conversion' | 'avgCheck' | 'repeat'
const LEVER_LABEL: Record<LeverKey, string> = {
  leads: 'Лиды в месяц',
  conversion: 'Конверсия лида в клиента',
  avgCheck: 'Средний чек',
  repeat: 'Повторные продажи',
}

interface Setup {
  A: number
  T: number
  months: number
  /** Months of the horizon the model works in (1..60). */
  horizon: number
  band: { delta: number; source: 'history' | 'default' }
}

function setup(i: ModelInputs): Setup {
  const A = i.base.revenueYear.value
  if (!finite(A) || A <= 0) throw new ModelInputError('Нет базовой годовой выручки')
  if (!i.goal || !finite(i.goal.targetAnnual) || i.goal.targetAnnual <= 0) throw new ModelInputError('Нет цели по выручке')
  const months = i.goal.months
  return {
    A, T: i.goal.targetAnnual, months,
    horizon: Math.min(MODEL_HORIZON_MAX, Math.max(1, Math.floor(months))),
    band: volatilityBand(i.history),
  }
}

/** Time range: `low` is the unfavourable case (a LATER month), `high` the favourable one. */
function monthsRange(slow: number | null, base: number | null, fast: number | null): Range {
  return { low: slow, base, high: fast }
}

function firstMonthAtOrAbove(runRate: number[], target: number): number | null {
  const idx = runRate.findIndex((v) => v >= target * REACHED)
  return idx === -1 ? null : idx + 1
}

/** Mean of the last three months (fewer at the start) × 12. */
function runRateSeries(monthlyRevenue: number[]): number[] {
  return monthlyRevenue.map((_, t) => {
    const from = Math.max(0, t - 2)
    const slice = monthlyRevenue.slice(from, t + 1)
    return (slice.reduce((a, b) => a + b, 0) / slice.length) * 12
  })
}

function staffNeed(i: ModelInputs, A: number, T: number, productivityGain: number): number | null {
  const h = i.levers.headcount.value
  if (!finite(h) || h <= 0) return null
  return Math.max(0, Math.ceil((h * T) / A / (1 + productivityGain) - 1e-9) - h)
}

function seasonText(season: number[] | null): string {
  return season && season.some((s) => Math.abs(s - 1) > 1e-9)
    ? 'Сезонность учтена по истории выручки; траектория показана с поправкой на сезон.'
    : 'Сезонность не учтена (индекс 1,0): в истории меньше 24 месяцев.'
}

// ─── funnel ─────────────────────────────────────────────────────────────────

/** Weights of the levers: a lever that has no base value (repeat = 0) takes no share. */
function leverWeights(mix: ScenarioProfile['leverMix'], hasRepeat: boolean): { w: ScenarioProfile['leverMix']; redistributed: boolean } {
  const w = { ...mix }
  if (!hasRepeat) w.repeat = 0
  let sum = w.leads + w.conversion + w.avgCheck + w.repeat
  let redistributed = !hasRepeat && mix.repeat > 0
  if (!(sum > 0)) {
    // everything was on repeat, which is not there: equal shares on the other three
    w.leads = w.conversion = w.avgCheck = 1
    sum = 3
    redistributed = true
  }
  return { w: { leads: w.leads / sum, conversion: w.conversion / sum, avgCheck: w.avgCheck / sum, repeat: w.repeat / sum }, redistributed }
}

export function solveFunnelScenario(i: ModelInputs, profile: ScenarioProfile, season: number[], otherMonthly: number): ScenarioResult {
  const s = setup(i)
  const levers = withDerivedActiveBase(i.levers)
  const L0 = levers.leads.value
  const c0 = levers.conversion.value
  const p0 = levers.avgCheck.value
  if (!finite(L0) || L0 <= 0 || !finite(c0) || c0 <= 0 || c0 > 1 || !finite(p0) || p0 <= 0) {
    throw new ModelInputError('Для расчёта по воронке нужны лиды, конверсия (до 100%) и средний чек больше нуля')
  }
  const hasRepeat = finite(levers.repeat.value) && levers.repeat.value > 0
  const R0 = hasRepeat ? (levers.repeat.value as number) : 0
  const B0 = finite(levers.activeBase.value) && levers.activeBase.value >= 0 ? levers.activeBase.value : L0 * c0 * 12
  const ONES = Array(12).fill(1) as number[]
  const params: FunnelParams = { leads: L0, conversion: c0, avgCheck: p0, repeat: R0, activeBase0: B0, seasonality: ONES, otherMonthly }

  const { A, T, band } = s
  const O = otherMonthly * 12
  const steady0 = 12 * L0 * c0 * (1 + R0) * p0
  const alreadyThere = T <= A

  // 1. Levels of the levers at the end of the ramp.
  const { w, redistributed } = leverWeights(profile.leverMix, hasRepeat)
  const Gm = alreadyThere ? 1 : Math.max(1, (T - O) / steady0)
  const lnG = Math.log(Gm)
  const required = {
    leads: L0 * Math.exp(w.leads * lnG),
    conversion: c0 * Math.exp(w.conversion * lnG),
    avgCheck: p0 * Math.exp(w.avgCheck * lnG),
    repeat: hasRepeat ? (1 + R0) * Math.exp(w.repeat * lnG) - 1 : R0,
  }
  const caps = {
    leads: L0 * LEVER_CAPS.leadsTimes,
    conversion: Math.max(c0, Math.min(1, c0 * LEVER_CAPS.conversionTimes, LEVER_CAPS.conversionMax)),
    avgCheck: p0 * LEVER_CAPS.avgCheckTimes,
    repeat: Math.max(R0, LEVER_CAPS.repeatMax),
  }
  const reasons: string[] = []
  const reached: Record<LeverKey, number> = { ...required }
  if (required.leads > caps.leads * (1 + 1e-9)) {
    reasons.push(`Лиды: нужен рост в ${fmtTimes(required.leads / L0)}, потолок реализуемости — ${fmtTimes(LEVER_CAPS.leadsTimes)}.`)
    reached.leads = caps.leads
  }
  if (required.conversion > caps.conversion * (1 + 1e-9)) {
    reasons.push(`Конверсия: нужно ${fmtPct(required.conversion, 1)}, потолок реализуемости — ${fmtPct(caps.conversion, 1)} (не больше ${fmtTimes(LEVER_CAPS.conversionTimes)} от текущей и не выше ${fmtPct(LEVER_CAPS.conversionMax)}).`)
    reached.conversion = caps.conversion
  }
  if (required.avgCheck > caps.avgCheck * (1 + 1e-9)) {
    reasons.push(`Средний чек: нужен рост в ${fmtTimes(required.avgCheck / p0)}, потолок реализуемости — ${fmtTimes(LEVER_CAPS.avgCheckTimes)}.`)
    reached.avgCheck = caps.avgCheck
  }
  if (hasRepeat && required.repeat > caps.repeat * (1 + 1e-9)) {
    reasons.push(`Повторные продажи: нужно ${fmtPct(required.repeat)}, потолок реализуемости — ${fmtPct(LEVER_CAPS.repeatMax)}.`)
    reached.repeat = caps.repeat
  }
  const feasible = reasons.length === 0

  // 2. The trajectory at a pace: levers move linearly from today's level to `reached` in ramp / pace months.
  const ramp = profile.rampMonths
  const horizon = Math.min(MODEL_HORIZON_MAX, Math.max(s.horizon, Math.ceil(ramp / (1 - band.delta)) + 14))
  const trajectoryAt = (pace: number): number[] => {
    const rampEff = ramp / pace
    const u = (t: number) => Math.min(1, t / rampEff)
    const path: FunnelPath = { leads: [], conversion: [], avgCheck: [], repeat: [] }
    for (let t = 1; t <= horizon; t++) {
      path.leads.push(L0 + (reached.leads - L0) * u(t))
      path.conversion.push(c0 + (reached.conversion - c0) * u(t))
      path.avgCheck.push(p0 + (reached.avgCheck - p0) * u(t))
      path.repeat.push(R0 + (reached.repeat - R0) * u(t))
    }
    return runRateSeries(simulateFunnel(params, path, horizon).revenue)
  }
  const slow = trajectoryAt(1 - band.delta)
  const mid = trajectoryAt(1)
  const fast = trajectoryAt(1 + band.delta)
  const at = (series: number[], month: number) => series[Math.min(series.length, Math.max(1, month)) - 1]

  const timeBase = alreadyThere ? 0 : firstMonthAtOrAbove(mid, T)
  const time = alreadyThere
    ? monthsRange(0, 0, 0)
    : monthsRange(firstMonthAtOrAbove(slow, T), timeBase, firstMonthAtOrAbove(fast, T))
  const m = s.horizon
  const revenueAtDeadline: Range = alreadyThere
    ? { low: A, base: A, high: A }
    : { low: at(slow, m), base: at(mid, m), high: at(fast, m) }

  const trajectory = [{ month: 0, low: A, base: A, high: A }]
  for (let t = 1; t <= horizon; t++) {
    trajectory.push(alreadyThere
      ? { month: t, low: A, base: A, high: A }
      : { month: t, low: round(at(slow, t), 2), base: round(at(mid, t), 2), high: round(at(fast, t), 2) })
  }

  // 3. What it takes.
  const uplift = (lever: LeverKey, current: number, target: number): ScenarioResult['requiredUplift'][number] => ({
    lever, label: LEVER_LABEL[lever], current, target, upliftPct: round((safeRatio(target, current) ?? 1) * 100 - 100, 1),
  })
  const requiredUplift: ScenarioResult['requiredUplift'] = alreadyThere || Gm <= 1 ? [] : [
    uplift('leads', L0, required.leads),
    uplift('conversion', c0, required.conversion),
    uplift('avgCheck', p0, required.avgCheck),
    ...(hasRepeat ? [uplift('repeat', R0, required.repeat)] : []),
  ]

  const cac = levers.cac.value
  const extraLeads = Math.max(0, reached.leads - L0)
  let marketingMonthlyIncrease: number | null = null
  let totalOverRamp: number | null = null
  if (finite(cac) && cac > 0) {
    marketingMonthlyIncrease = round(extraLeads * reached.conversion * cac, 0)
    let total = 0
    for (let t = 1; t <= Math.ceil(ramp); t++) total += Math.min(1, t / ramp) * extraLeads * reached.conversion * cac
    totalOverRamp = round(total, 0)
  }
  const staff = staffNeed(i, A, T, profile.productivityGain)
  const notes: string[] = []
  if (marketingMonthlyIncrease === null) notes.push('Нужен CAC (стоимость привлечения клиента), чтобы оценить рост маркетингового бюджета.')
  else notes.push('Маркетинг: прирост лидов × конверсия × CAC в месяц; всего за выход рычагов — накопленная сумма.')
  if (staff === null) notes.push('Нужно число сотрудников, чтобы оценить потребность в персонале.')
  notes.push('Деньги (резерв, нехватка средств, денежный поток) не рассчитаны: нужны данные уровня 2.')

  // 4. Texts.
  const lateBy = timeBase !== null && timeBase > s.months
  const delta = Math.round(band.delta * 100)
  const constraints: string[] = []
  if (!alreadyThere) {
    for (const u of requiredUplift) {
      const cap = u.lever === 'leads' ? fmtTimes(LEVER_CAPS.leadsTimes) : u.lever === 'avgCheck' ? fmtTimes(LEVER_CAPS.avgCheckTimes)
        : u.lever === 'conversion' ? fmtPct(caps.conversion, 1) : fmtPct(LEVER_CAPS.repeatMax)
      constraints.push(`${u.label}: нужно ${u.upliftPct !== null && u.upliftPct >= 0 ? '+' : ''}${fmtNum(u.upliftPct, 1)}%, потолок реализуемости — ${cap}.`)
    }
    constraints.push(`Рычаги выходят на целевой уровень за ${fmtMonths(ramp)}; база повторных клиентов догоняет с лагом до 12 месяцев.`)
    if (lateBy) constraints.push(sentence(`При этом темпе цель достигается через ${fmtMonths(timeBase)}, а срок цели — ${fmtMonths(s.months)}`))
  }
  const risks: string[] = []
  if (ramp <= 6) risks.push('Быстрый рост нагрузки на команду и сервис: рычаги меняются за считаные месяцы.')
  if (ramp >= 18) risks.push('Рынок и конкуренты могут измениться раньше, чем рычаги выйдут на целевой уровень.')
  if (required.leads > L0 * 1.0001 && !alreadyThere) risks.push('Рост лидов может снизить их качество и конверсию.')
  if (required.conversion > c0 * 1.0001 && !alreadyThere) risks.push('Рост конверсии требует изменений в продажах; без них прирост не реализуется.')
  if (required.avgCheck > p0 * 1.0001 && !alreadyThere) risks.push('Рост среднего чека может снизить спрос и конверсию.')
  if (hasRepeat && required.repeat > R0 * 1.0001 && !alreadyThere) risks.push('Рост повторных продаж требует программы удержания и приносит выручку с лагом.')
  if (alreadyThere) risks.push('Цель не выше текущей выручки: основной риск — потерять текущий уровень.')
  risks.push(CASH_NOT_ESTIMATED)

  const conditions: string[] = []
  if (!alreadyThere) {
    for (const u of requiredUplift) {
      if (u.lever === 'leads') conditions.push(`${u.label}: довести с ${fmtNum(u.current, 0)} до ${fmtNum(u.target, 0)} в месяц.`)
      else if (u.lever === 'avgCheck') conditions.push(`${u.label}: довести с ${fmtMoney(u.current)} до ${fmtMoney(u.target)}.`)
      else conditions.push(`${u.label}: довести с ${fmtPct(u.current, 1)} до ${fmtPct(u.target, 1)}.`)
    }
  } else {
    conditions.push('Удерживать лиды, конверсию и средний чек на текущем уровне.')
  }
  conditions.push(`Политика резерва сценария: ${fmtMonths(profile.reserveMonths)} расходов (расчёт — когда появятся данные о деньгах).`)

  const slowTime = time.low
  const downside = alreadyThere
    ? 'Цель не выше текущей выручки: неблагоприятный исход — спад ниже текущего уровня.'
    : slowTime !== null
      ? `Если рычаги пойдут на ${delta}% медленнее плана, цель будет достигнута через ${fmtMonths(slowTime)} вместо ${fmtMonths(timeBase)}, а выручка к сроку цели составит ${fmtMoney(revenueAtDeadline.low)} вместо ${fmtMoney(revenueAtDeadline.base)}.`
      : `Если рычаги пойдут на ${delta}% медленнее плана, цель не будет достигнута за ${fmtMonths(horizon)}; выручка к сроку цели составит ${fmtMoney(revenueAtDeadline.low)}.`

  const reviewPoints = [
    `Через ${fmtMonths(Math.max(1, Math.ceil(ramp / 2)))}: сверить лиды, конверсию и средний чек с планом.`,
    `Через ${fmtMonths(ramp)}: сверить выручку с целью.`,
    'После изменения цели, данных или допущений — пересчитать сценарий.',
  ]
  const signsToChangePace = [
    `Выручка три месяца подряд ниже траектории больше чем на ${delta}% — замедлить или пересмотреть цель.`,
    'Рычаги вышли на целевой уровень раньше срока, а выручка не растёт — искать узкое место вне воронки.',
    'Рычаги выходят быстрее плана без потери качества — можно ускорить.',
  ]

  const assumptions = [
    'Модель — воронка «лиды × конверсия × средний чек» с повторными заказами.',
    ...(Math.abs(otherMonthly) > 0 ? [`Выручка вне воронки учтена как постоянная: ${fmtMoney(otherMonthly)} в месяц (остаток калибровки по факту).`] : []),
    `Рычаги растут линейно и выходят на целевой уровень за ${fmtMonths(ramp)}; цель достигнута, когда среднее трёх последних месяцев × 12 не ниже цели.`,
    seasonText(season),
    `Диапазон: темп рычагов ±${delta}%, источник — ${bandText(band)}. Вероятность достижения цели не вычисляется.`,
    `Вклад рычагов в рост: лиды ${fmtPct(w.leads)}, конверсия ${fmtPct(w.conversion)}, средний чек ${fmtPct(w.avgCheck)}, повторные продажи ${fmtPct(w.repeat)}${redistributed ? ' (доля повторных продаж перераспределена: повторные продажи не заданы)' : ''}.`,
    ...(hasRepeat ? [] : ['Повторные продажи не заданы: учтены как 0%.']),
    ...(levers.activeBase.origin === 'derived' ? ['Активная база клиентов выведена: лиды × конверсия × 12.'] : []),
    'Деньги (резерв, нехватка средств, денежный поток) не рассчитаны: нужны данные уровня 2.',
  ]

  return {
    key: profile.key,
    label: profile.label,
    feasible,
    infeasibleReason: feasible ? null : reasons.join(' '),
    timeToGoalMonths: time,
    revenueAtDeadline,
    requiredUplift,
    investments: { marketingMonthlyIncrease, totalOverRamp, staffNeed: staff, note: notes.join(' ') },
    constraints, risks, conditions, downside, reviewPoints, signsToChangePace, assumptions,
    trajectory,
  }
}

// ─── growth ─────────────────────────────────────────────────────────────────

export function solveGrowthScenario(i: ModelInputs, profile: ScenarioProfile): ScenarioResult {
  const s = setup(i)
  const { A, T, band } = s
  const alreadyThere = T <= A
  const cap = profile.growthCapAnnual
  const need = alreadyThere ? 0 : requiredAnnualGrowth(A, T, Math.max(1, s.months))
  if (!alreadyThere && need === null) throw new ModelInputError('Требуемый рост слишком велик для расчёта')
  const required = need ?? 0

  const g = alreadyThere ? 0 : Math.min(required, cap)
  const feasible = alreadyThere || required <= cap * (1 + 1e-9)
  const gSlow = g * (1 - band.delta)
  const gFast = Math.min(cap, g * (1 + band.delta))

  const ceilMonths = (t: number | null): number | null => (t === null ? null : Math.max(0, Math.ceil(t - 1e-9)))
  const timeOf = (growth: number): number | null => ceilMonths(timeToTarget({ baseAnnual: A, targetAnnual: T, annualGrowth: growth }))
  const tBase = alreadyThere ? 0 : timeOf(g)
  const time = alreadyThere ? monthsRange(0, 0, 0) : monthsRange(timeOf(gSlow), tBase, timeOf(gFast))

  const m = s.horizon
  const horizon = Math.min(MODEL_HORIZON_MAX, Math.max(m, time.low ?? tBase ?? m))
  const path = (growth: number): number[] => (alreadyThere ? Array(horizon).fill(A) : projectGrowth({ baseAnnual: A, annualGrowth: growth, months: horizon }))
  const slow = path(gSlow)
  const mid = path(g)
  const fast = path(gFast)
  const revenueAtDeadline: Range = { low: slow[m - 1], base: mid[m - 1], high: fast[m - 1] }
  const trajectory = [{ month: 0, low: A, base: A, high: A }]
  for (let t = 1; t <= horizon; t++) trajectory.push({ month: t, low: round(slow[t - 1], 2), base: round(mid[t - 1], 2), high: round(fast[t - 1], 2) })

  const staff = staffNeed(i, A, T, profile.productivityGain)
  const delta = Math.round(band.delta * 100)
  const late = tBase !== null && tBase > s.months
  const infeasibleReason = feasible ? null
    : sentence(`Цель требует роста ${fmtPct(required)} в год, а потолок этого сценария — ${fmtPct(cap)}: при потолке цель достигается через ${tBase === null ? 'более чем 60 мес.' : fmtMonths(tBase)} (срок цели — ${fmtMonths(s.months)})`)

  return {
    key: profile.key,
    label: profile.label,
    feasible,
    infeasibleReason,
    timeToGoalMonths: time,
    revenueAtDeadline,
    requiredUplift: alreadyThere ? [] : [{ lever: 'growth', label: 'Годовой рост выручки', current: null, target: g, upliftPct: null }],
    investments: {
      marketingMonthlyIncrease: null,
      totalOverRamp: null,
      staffNeed: staff,
      note: [
        'Упрощённая модель роста не раскладывает цель по рычагам, поэтому бюджет маркетинга не оценивается; чтобы получить разбор, добавьте лиды, конверсию и средний чек.',
        ...(staff === null ? ['Нужно число сотрудников, чтобы оценить потребность в персонале.'] : []),
        'Деньги (резерв, нехватка средств, денежный поток) не рассчитаны: нужны данные уровня 2.',
      ].join(' '),
    },
    constraints: [
      `Потолок годового роста этого сценария — ${fmtPct(cap)}.`,
      ...(alreadyThere ? [] : [sentence(`Цель требует роста ${fmtPct(required, 1)} в год при сроке ${fmtMonths(s.months)}`)]),
      ...(late ? [sentence(`При этом росте цель достигается через ${fmtMonths(tBase)}, а срок цели — ${fmtMonths(s.months)}`)] : []),
    ],
    risks: [
      ...(alreadyThere ? ['Цель не выше текущей выручки: основной риск — потерять текущий уровень.'] : ['Рост считается одним темпом на всю выручку: узкие места по рычагам не видны.']),
      CASH_NOT_ESTIMATED,
    ],
    conditions: [
      alreadyThere ? 'Удерживать текущий уровень выручки.' : `Держать рост выручки около ${fmtPct(g, 1)} в год.`,
      `Политика резерва сценария: ${fmtMonths(profile.reserveMonths)} расходов (расчёт — когда появятся данные о деньгах).`,
    ],
    downside: alreadyThere
      ? 'Цель не выше текущей выручки: неблагоприятный исход — спад ниже текущего уровня.'
      : sentence(`Если рост окажется на ${delta}% ниже плана, к сроку цели выручка составит ${fmtMoney(revenueAtDeadline.low)} вместо ${fmtMoney(revenueAtDeadline.base)}${time.low === null ? '; цель не будет достигнута в пределах 60 месяцев' : `; цель будет достигнута через ${fmtMonths(time.low)}`}`),
    reviewPoints: [
      'Каждые три месяца: сверить фактический рост с планом.',
      'После изменения цели, данных или допущений — пересчитать сценарий.',
    ],
    signsToChangePace: [
      `Фактический рост три месяца подряд ниже плана больше чем на ${delta}% — пересмотреть темп или цель.`,
      'Рост стабильно выше плана — можно поднять цель.',
    ],
    assumptions: [
      'Модель — упрощённая: годовая выручка растёт с постоянным темпом, не больше потолка сценария.',
      'Рычаги воронки не используются: нет лидов, конверсии или среднего чека, либо отрасль не про поток заявок.',
      `Диапазон: темп роста ±${delta}%, источник — ${bandText(band)}. Вероятность достижения цели не вычисляется.`,
      'Деньги (резерв, нехватка средств, денежный поток) не рассчитаны: нужны данные уровня 2.',
    ],
    trajectory,
  }
}
