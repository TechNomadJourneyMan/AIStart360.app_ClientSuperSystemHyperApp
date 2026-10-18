/**
 * lib/point-b/model/compute.ts — the single entry point of the Point B model.
 *
 *   computeModel(inputs, profiles?) → ModelResult
 *
 * Pure and deterministic (the time is `inputs.now`). It does not throw on bad input: a value the
 * model cannot work with (a zero check, a conversion above 100%, a deadline in the past or beyond 60
 * months, an unusable profile) becomes a text in `warnings` and the result stays at level 0 — gap and
 * forecast are still given where they can be.
 *
 * Funnel: calibrated against the fact first; if the funnel explains the fact by less than 85% (or
 * overshoots it by more than 15%) the scenarios are built on the simplified growth model and a warning
 * says by how much the funnel missed. A client without enough history gets forecast `insufficient`
 * and the verdict `no_data`.
 */
import { fmtMoney, fmtNum } from './format'
import { calibrate, rotateSeasonality, seasonalityIndex, type FunnelParams } from './funnel'
import { describeHistory, HISTORY_MAX_LAG_MONTHS, HISTORY_MIN_MONTHS, projectCurrentPace, verdictFor } from './forecast'
import { withDerivedActiveBase } from './inputs'
import { determineLevel, missingInput } from './levels'
import { defaultProfiles, normalizeProfiles } from './profiles'
import { solveFunnelScenario, solveGrowthScenario, MODEL_HORIZON_MAX } from './scenarios'
import {
  MODEL_VERSION, ModelInputError,
  type MissingInput, type ModelInputs, type ModelResult, type ScenarioProfile,
} from './types'

const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n)
const DAY = 86_400_000

/** Differences between the history and the base revenue above this are worth a warning. */
const HISTORY_BASE_MISMATCH = 0.25

const emptyGap = (): ModelResult['gap'] => ({ baseAnnual: null, targetAnnual: null, absolute: null, multiplier: null, requiredCagrPct: null, months: null })
const noForecast = (): ModelResult['forecast'] => ({ atCurrentPace: { low: null, base: null, high: null }, trendMonthlyPct: null, basis: 'insufficient' })

/** What in the inputs makes the model unusable: text for the user and, for a lever, which input to refill. */
function validate(i: ModelInputs): { errors: string[]; refill: Array<'leads' | 'conversion' | 'avgCheck' | 'repeat'> } {
  const errors: string[] = []
  const refill: Array<'leads' | 'conversion' | 'avgCheck' | 'repeat'> = []
  const base = i.base.revenueYear.value
  if (base !== null && !(finite(base) && base > 0)) errors.push('Текущая годовая выручка должна быть больше нуля.')

  const g = i.goal
  if (g) {
    if (!finite(g.targetAnnual) || g.targetAnnual <= 0) errors.push('Цель по выручке должна быть больше нуля.')
    if (!finite(g.months)) errors.push('Срок цели указан неверно.')
    else if (g.months < 1) errors.push(`Срок цели (${g.deadline}) уже прошёл — задайте новый срок, и модель посчитает сценарии.`)
    else if (g.months > MODEL_HORIZON_MAX) errors.push(`Срок цели — ${fmtNum(g.months)} мес., а модель считает не дальше ${MODEL_HORIZON_MAX} мес. Уточните срок цели.`)
  }

  const L = i.levers
  const bad = (s: { value: number | null }, ok: (v: number) => boolean) => s.value !== null && !(finite(s.value) && ok(s.value))
  if (bad(L.leads, (v) => v > 0)) { errors.push('Число лидов в месяц должно быть больше нуля.'); refill.push('leads') }
  if (bad(L.conversion, (v) => v > 0 && v <= 1)) {
    errors.push(finite(L.conversion.value) && L.conversion.value > 1
      ? `Конверсия ${fmtNum(L.conversion.value * 100, 0)}% не может быть больше 100% — проверьте значение.`
      : 'Конверсия должна быть больше нуля и не больше 100%.')
    refill.push('conversion')
  }
  if (bad(L.avgCheck, (v) => v > 0)) { errors.push('Средний чек должен быть больше нуля.'); refill.push('avgCheck') }
  if (bad(L.repeat, (v) => v >= 0 && v <= 1)) { errors.push('Доля повторных продаж должна быть от 0 до 100%.'); refill.push('repeat') }
  if (bad(L.cac, (v) => v > 0)) errors.push('Стоимость привлечения клиента должна быть больше нуля.')
  if (bad(L.headcount, (v) => v > 0)) errors.push('Число сотрудников должно быть больше нуля.')
  if (bad(L.activeBase, (v) => v >= 0)) errors.push('Активная база клиентов не может быть отрицательной.')
  return { errors, refill }
}

function gapOf(i: ModelInputs, usable: boolean): ModelResult['gap'] {
  const base = i.base.revenueYear.value
  const baseAnnual = finite(base) && base > 0 ? base : null
  const g = i.goal
  if (!g || !usable || baseAnnual === null || !finite(g.targetAnnual) || g.targetAnnual <= 0) {
    return { ...emptyGap(), baseAnnual, targetAnnual: g && finite(g.targetAnnual) && g.targetAnnual > 0 ? g.targetAnnual : null, months: g && finite(g.months) ? g.months : null }
  }
  const multiplier = g.targetAnnual / baseAnnual
  const cagr = g.months >= 1 ? multiplier ** (12 / g.months) - 1 : NaN
  return {
    baseAnnual,
    targetAnnual: g.targetAnnual,
    absolute: g.targetAnnual - baseAnnual,
    multiplier,
    requiredCagrPct: finite(cagr) ? cagr * 100 : null,
    months: g.months,
  }
}

function staleWarning(i: ModelInputs): string {
  const period = i.base.revenueYear.period
  const age = i.base.ageMonths
  return `База устарела${period ? ` (выручка за ${period})` : ''}${finite(age) && age > 0 ? `: прошло ${fmtNum(age)} мес.` : ''} Обновите выручку в анкете или загрузите свежий отчёт — расчёт идёт по старым данным.`
}

function historyWarnings(i: ModelInputs): string[] {
  if (!i.goal) return []
  const d = describeHistory(i.history, i.now)
  if (d.points === 0) return ['Истории выручки по месяцам нет: прогноз «при текущем ходе» не строится.']
  if (d.run < HISTORY_MIN_MONTHS) {
    return [d.hasGaps
      ? `В истории выручки есть пропуски месяцев: подряд только ${d.run} мес., а для прогноза «при текущем ходе» нужно ${HISTORY_MIN_MONTHS}.`
      : `В истории выручки только ${d.run} мес., а для прогноза «при текущем ходе» нужно ${HISTORY_MIN_MONTHS}.`]
  }
  if (d.lagMonths !== null && d.lagMonths > HISTORY_MAX_LAG_MONTHS) {
    return [`История выручки закончилась ${d.lagMonths} мес. назад — прогноз «при текущем ходе» по такой истории не строится.`]
  }
  return []
}

/** History against the base: both are «the revenue of the last 12 months», they should roughly agree. */
function historyVsBase(i: ModelInputs): string[] {
  const base = i.base.revenueYear.value
  const d = describeHistory(i.history, i.now)
  if (!finite(base) || base <= 0 || d.run < HISTORY_MIN_MONTHS || d.lagMonths === null || d.lagMonths > HISTORY_MAX_LAG_MONTHS) return []
  const sorted = [...i.history].sort((a, b) => (a.period < b.period ? -1 : 1))
  const last12 = sorted.slice(-HISTORY_MIN_MONTHS).reduce((s, p) => s + p.revenue, 0)
  if (Math.abs(last12 / base - 1) <= HISTORY_BASE_MISMATCH) return []
  return [`Выручка за последние 12 месяцев по истории (${fmtMoney(last12)}) расходится с базовой годовой выручкой (${fmtMoney(base)}) больше чем на ${Math.round(HISTORY_BASE_MISMATCH * 100)}% — проверьте, какая из цифр верна.`]
}

function goalWarnings(i: ModelInputs, usable: boolean): string[] {
  const g = i.goal
  if (!g) return []
  const out: string[] = []
  const base = i.base.revenueYear.value
  if (usable && finite(base) && base > 0 && g.targetAnnual <= base) {
    out.push(`Цель (${fmtMoney(g.targetAnnual)}) не выше текущей годовой выручки (${fmtMoney(base)}): разрыва нет, сценарии показывают, как удержать уровень.`)
  }
  if (usable && g.months >= 1) {
    const now = Date.parse(i.now)
    const end = Date.parse(`${g.deadline}T23:59:59Z`)
    if (finite(now) && finite(end) && end > now && end - now < 28 * DAY) {
      out.push('До срока цели меньше месяца: сценарии рассчитаны на один месяц, рычаги за такой срок не успевают измениться.')
    }
  }
  if (g.reviewStatus !== 'verified' && g.reviewStatus !== 'agreed') out.push('Цель не проверена экспертом: расчёт может измениться после проверки.')
  return out
}

function level0(i: ModelInputs, args: { warnings: string[]; missing: MissingInput[]; forecast?: ModelResult['forecast']; gapUsable: boolean }): ModelResult {
  const forecast = args.forecast ?? noForecast()
  return {
    modelVersion: MODEL_VERSION,
    computedAt: i.now,
    level: 0,
    kind: 'none',
    template: i.template,
    gap: gapOf(i, args.gapUsable),
    forecast,
    verdict: verdictFor({ goal: i.goal, forecast, baseAnnual: i.base.revenueYear.value }),
    scenarios: [],
    missing: args.missing,
    warnings: args.warnings,
  }
}

function build(raw: ModelInputs, profilesIn?: ScenarioProfile[]): ModelResult {
  const { errors, refill } = validate(raw)
  const stale = raw.base.stale && finite(raw.base.revenueYear.value) ? [staleWarning(raw)] : []
  const levelInfo = determineLevel(raw)

  if (errors.length) {
    // Something cannot be calculated: level 0, but the gap and the forecast are given where they are sound.
    const fatalGoal = raw.goal && (!finite(raw.goal.targetAnnual) || raw.goal.targetAnnual <= 0 || !finite(raw.goal.months))
    const baseBad = raw.base.revenueYear.value !== null && !(raw.base.revenueYear.value > 0)
    const forecast = fatalGoal || baseBad ? noForecast() : projectCurrentPace(raw)
    return level0(raw, {
      warnings: [...stale, ...errors, ...goalWarnings(raw, !fatalGoal && !baseBad), ...historyWarnings(raw)],
      missing: [...levelInfo.missing.filter((m) => m.key === 'goal' || m.key === 'revenue_base'), ...refill.map((k) => missingInput(k))],
      forecast,
      gapUsable: !fatalGoal && !baseBad,
    })
  }

  const warnings: string[] = [...stale]
  const forecast = projectCurrentPace(raw)
  const verdict = verdictFor({ goal: raw.goal, forecast, baseAnnual: raw.base.revenueYear.value })
  const gap = gapOf(raw, true)

  if (levelInfo.level === 0) {
    return {
      modelVersion: MODEL_VERSION, computedAt: raw.now, level: 0, kind: 'none', template: raw.template,
      gap, forecast, verdict, scenarios: [], missing: levelInfo.missing,
      warnings: [...warnings, ...goalWarnings(raw, true), ...historyWarnings(raw)],
    }
  }

  // Level 1.
  const inputs: ModelInputs = { ...raw, levers: withDerivedActiveBase(raw.levers) }
  const profiles = normalizeProfiles(profilesIn ?? defaultProfiles(inputs.template), inputs.template)
  const seasonal = seasonalityIndex(inputs.history)
  warnings.push(...goalWarnings(inputs, true), ...historyWarnings(inputs), ...historyVsBase(inputs))
  if (seasonal.defaulted) warnings.push('Сезонность не учтена: в истории выручки меньше 24 месяцев, использован индекс 1,0.')

  let kind: ModelResult['kind'] = levelInfo.kind
  let missing = levelInfo.missing
  let scenarios: ModelResult['scenarios'] = []
  if (kind === 'funnel') {
    const season = rotateSeasonality(seasonal.index, inputs.now)
    const params: Omit<FunnelParams, 'otherMonthly'> = {
      leads: inputs.levers.leads.value as number,
      conversion: inputs.levers.conversion.value as number,
      avgCheck: inputs.levers.avgCheck.value as number,
      repeat: inputs.levers.repeat.value ?? 0,
      activeBase0: inputs.levers.activeBase.value ?? 0,
      seasonality: season,
    }
    const cal = calibrate({ revenueYear: inputs.base.revenueYear.value as number, params })
    if (cal.ok) {
      scenarios = profiles.map((p) => solveFunnelScenario(inputs, p, season, cal.otherMonthly))
    } else {
      kind = 'growth'
      missing = missing.filter((m) => m.key !== 'cac')
      warnings.push(`Расчёт по воронке не сходится с фактом на ${Math.round(Math.abs(cal.residualShare) * 100)}%: сценарии построены по упрощённой модели роста. Проверьте лиды, конверсию, средний чек и выручку.`)
    }
  }
  if (kind === 'growth') scenarios = profiles.map((p) => solveGrowthScenario(inputs, p))

  return { modelVersion: MODEL_VERSION, computedAt: raw.now, level: 1, kind, template: raw.template, gap, forecast, verdict, scenarios, missing, warnings }
}

export function computeModel(inputs: ModelInputs, profiles?: ScenarioProfile[]): ModelResult {
  try {
    return build(inputs, profiles)
  } catch (err) {
    if (!(err instanceof ModelInputError)) throw err
    const info = determineLevel(inputs)
    return level0(inputs, { warnings: [err.message], missing: info.level === 0 ? info.missing : [], gapUsable: true })
  }
}

