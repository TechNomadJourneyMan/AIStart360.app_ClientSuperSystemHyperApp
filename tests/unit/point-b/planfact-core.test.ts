/**
 * Point B Ф6b, Task 2: the pure core of the plan-fact — the verdict with tolerances and its boundaries, «нет данных»,
 * the planned values of an approved version, the progress of a goal (way, time, forecast date), the checkpoint
 * builder, the version diff and the recompute schedule. No IO, no clock.
 */
import { describe, expect, it } from 'vitest'
import { computeModel } from '@/lib/point-b/model/compute'
import type { ModelResult, ScenarioResult } from '@/lib/point-b/model/types'
import type { PlanGoalItem } from '@/lib/point-b/plan/types'
import { buildCheckpoint, currentCheckpoint, forecastFromResult } from '@/lib/point-b/planfact/checkpoint'
import { cronDue, isValidRecomputeCron } from '@/lib/point-b/planfact/cron'
import { diffVersions, summarizeVersion, type VersionRowLike } from '@/lib/point-b/planfact/diff'
import { addPeriods, fmtKpi, lastFinishedPeriod, periodLabel } from '@/lib/point-b/planfact/kpis'
import { plannedFor, planKpis, planStartPeriod } from '@/lib/point-b/planfact/planned'
import { daysSince, goalProgress } from '@/lib/point-b/planfact/progress'
import { DEFAULT_TOLERANCES, type Checkpoint } from '@/lib/point-b/planfact/types'
import { kpiVerdict, normalizeTolerances, overallVerdict } from '@/lib/point-b/planfact/verdict'
import { modelInputs, modelInputsL2, REVENUE } from './_model'

const NOW = new Date('2026-10-22T09:00:00Z')
const TOL = DEFAULT_TOLERANCES

/** A scenario with round numbers: revenue 5M → 10M a month over 12 months, leads 300 → 420, conversion 10% → 13%. */
function scenario(over: Partial<ScenarioResult> = {}): ScenarioResult {
  return {
    key: 'moderate', label: 'Умеренный', feasible: true, infeasibleReason: null,
    timeToGoalMonths: { low: 14, base: 12, high: 10 }, revenueAtDeadline: { low: 100_000_000, base: 120_000_000, high: 130_000_000 },
    requiredUplift: [
      { lever: 'leads', label: 'Лиды в месяц', current: 300, target: 420, upliftPct: 40 },
      { lever: 'conversion', label: 'Конверсия лида в клиента', current: 0.1, target: 0.13, upliftPct: 30 },
      { lever: 'avgCheck', label: 'Средний чек', current: 140_000, target: 154_000, upliftPct: 10 },
    ],
    investments: { marketingMonthlyIncrease: null, totalOverRamp: null, staffNeed: null, note: '' },
    constraints: [], risks: [], conditions: [], downside: '', reviewPoints: [], signsToChangePace: [], assumptions: [],
    trajectory: Array.from({ length: 13 }, (_, m) => ({ month: m, low: (60 + 5 * m) * 1e6 * 0.9, base: (60 + 5 * m) * 1e6, high: (60 + 5 * m) * 1e6 * 1.1 })),
    ...over,
  }
}

const version = (over: Record<string, unknown> = {}) => ({
  id: 'v-1',
  scenarios: [scenario()],
  selected_scenario: 'moderate',
  assumptions: { model: { computedAt: '2026-06-10T00:00:00Z', level: 1, kind: 'funnel', gap: { baseAnnual: 60_000_000, months: 12 } }, profiles: [{ key: 'moderate', label: 'Умеренный', rampMonths: 12, reserveMonths: 2, growthCapAnnual: 0.5 }] },
  approved_at: '2026-06-15T00:00:00Z',
  created_at: '2026-06-01T00:00:00Z',
  ...over,
})

describe('kpi verdict and tolerances', () => {
  it('on track up to a 5% shortfall, risk up to 15%, behind beyond; above the plan is on track', () => {
    expect(kpiVerdict('revenue', 100, 95, TOL).verdict).toBe('on_track')
    expect(kpiVerdict('revenue', 100, 94.9, TOL).verdict).toBe('risk')
    expect(kpiVerdict('revenue', 100, 85, TOL).verdict).toBe('risk')
    expect(kpiVerdict('revenue', 100, 84.9, TOL).verdict).toBe('behind')
    expect(kpiVerdict('revenue', 100, 130, TOL)).toMatchObject({ verdict: 'on_track', shortfallPct: -30 })
    expect(kpiVerdict('leads', 400, 380, { onTrackPct: 0, riskPct: 10 }).verdict).toBe('risk')
  })

  it('the reason names the numbers: «конверсия 11% при плане 13%»', () => {
    expect(kpiVerdict('conversion', 13, 11, TOL)).toMatchObject({ verdict: 'behind', reason: 'конверсия 11% при плане 13%', shortfallPct: 15.4 })
    expect(kpiVerdict('revenue', 10_000_000, 9_000_000, TOL).reason).toBe('выручка 9 млн ₸ при плане 10 млн ₸')
    expect(fmtKpi('conversion', 12.5)).toBe('12,5%')
  })

  it('no fact, no plan or a zero plan → no data, never behind or on track', () => {
    expect(kpiVerdict('revenue', 100, null, TOL)).toMatchObject({ verdict: 'no_data', reason: 'выручка: нет факта за месяц' })
    expect(kpiVerdict('revenue', null, 100, TOL).verdict).toBe('no_data')
    expect(kpiVerdict('cash', 0, 100, TOL).verdict).toBe('no_data')
  })

  it('cash: a negative plan (a planned gap) is compared by the shortfall against its size', () => {
    expect(kpiVerdict('cash', -1_000_000, -1_040_000, TOL).verdict).toBe('on_track')
    expect(kpiVerdict('cash', -1_000_000, -1_300_000, TOL).verdict).toBe('behind')
  })

  it('overall: the worst KPI with data, the reason names the worst two; nothing → no data with a hint', () => {
    const v = {
      revenue: kpiVerdict('revenue', 100, 97, TOL),
      conversion: kpiVerdict('conversion', 13, 11, TOL),
      leads: kpiVerdict('leads', 400, 360, TOL),
      cash: kpiVerdict('cash', 100, null, TOL),
    }
    expect(overallVerdict(v, '2026-09')).toEqual({ overall: 'behind', reason: 'Конверсия 11% при плане 13%; лиды 360 при плане 400.' })
    expect(overallVerdict({ revenue: kpiVerdict('revenue', 100, 101, TOL) }, '2026-09')).toEqual({ overall: 'on_track', reason: 'Выручка 101 ₸ при плане 100 ₸ — в пределах плана.' })
    expect(overallVerdict({ revenue: kpiVerdict('revenue', 100, null, TOL) }, '2026-09')).toEqual({
      overall: 'no_data', reason: 'Нет фактов в сентябре 2026 — внесите «Факт за месяц», и мы сравним его с планом.',
    })
    expect(overallVerdict({}, '2026-09').overall).toBe('no_data')
  })

  it('tolerances from the setting: snake_case or camelCase, invalid → 5 / 15', () => {
    expect(normalizeTolerances({ on_track_pct: 3, risk_pct: 10 })).toEqual({ onTrackPct: 3, riskPct: 10 })
    expect(normalizeTolerances({ onTrackPct: 10, riskPct: 5 })).toEqual({ onTrackPct: 5, riskPct: 15 })
    expect(normalizeTolerances(null)).toEqual({ onTrackPct: 5, riskPct: 15 })
  })
})

describe('planned values of the approved version', () => {
  it('month 0 is the month of the calculation; revenue from the trajectory, levers on the ramp, conversion in percent', () => {
    expect(planStartPeriod(version())).toBe('2026-06')
    const sep = plannedFor(version(), '2026-09') // month 3 of 12
    expect(sep.monthIndex).toBe(3)
    expect(sep.values).toEqual({ revenue: 6_250_000, leads: 330, conversion: 10.75, avg_check: 143_500 })
    expect(sep.revenueRange).toEqual({ low: 5_625_000, high: 6_875_000 })
    // after the ramp the levers stay at the target; the trajectory past its end keeps the last point
    expect(plannedFor(version(), '2027-12').values).toMatchObject({ revenue: 10_000_000, leads: 420, conversion: 13, avg_check: 154_000 })
  })

  it('a month before the plan start has no planned values; no scenario → nothing', () => {
    expect(plannedFor(version(), '2026-05')).toMatchObject({ values: {}, monthIndex: -1 })
    expect(plannedFor(version({ scenarios: [] }), '2026-09')).toMatchObject({ values: {}, monthIndex: null })
  })

  it('the KPIs of the plan: revenue and the funnel levers; cash only with the money of level 2', () => {
    expect(planKpis(version())).toEqual(['revenue', 'leads', 'conversion', 'avg_check'])
    const withCash = version({ scenarios: [scenario({ finance: { cash: [3e6, 2e6, 1e6, 5e5], ebitda: [], netProfit: [], nwc: [], minCash: { value: 5e5, month: 4 }, cashGapMonth: null, fundingNeed: 0, reserveRequired: 0, totals: { revenue: 1, ebitda: 1, netProfit: 1, operatingCashFlow: 1, capex: 0, debtService: 0 }, assumptions: [] } })] })
    expect(planKpis(withCash)).toContain('cash')
    expect(plannedFor(withCash, '2026-08').values.cash).toBe(2e6) // month 2 → cash[1]
    expect(plannedFor(withCash, '2026-06').values.cash).toBeUndefined() // month 0: no planned cash
  })

  it('the selected pace wins; without one «Умеренный»; the ramp falls back to the default of the pace', () => {
    const two = version({ scenarios: [scenario({ key: 'aggressive', label: 'Агрессивный' }), scenario()], selected_scenario: 'aggressive', assumptions: { model: { computedAt: '2026-06-10T00:00:00Z' } } })
    // aggressive: ramp 6 by default → month 3 = half way
    expect(plannedFor(two, '2026-09')).toMatchObject({ scenarioKey: 'aggressive', values: { leads: 360 } })
    expect(plannedFor({ ...two, selected_scenario: null }, '2026-09').scenarioKey).toBe('moderate')
  })

  it('works on the real model output (scenarios of the golden client)', () => {
    const result = computeModel(modelInputsL2())
    const v = version({ scenarios: result.scenarios, assumptions: { model: { computedAt: '2026-10-18T09:00:00Z' } } })
    const kpis = planKpis(v)
    expect(kpis).toEqual(expect.arrayContaining(['revenue', 'leads', 'conversion', 'avg_check', 'cash']))
    const p = plannedFor(v, '2026-11').values
    for (const k of kpis) expect(Number.isFinite(p[k]), k).toBe(true)
  })
})

describe('checkpoint', () => {
  it('planned · actual · forecast · verdict per KPI and overall, only the KPIs of the plan', () => {
    const result = computeModel(modelInputs())
    const cp = buildCheckpoint({
      version: version(), period: '2026-09', result, tolerances: TOL, now: NOW,
      actual: { revenue: 6_100_000, leads: 300, conversion: 9, cash: 1_000_000 },
      actualSources: { revenue: 'reconciliation', leads: 'facts', conversion: 'reconciliation', cash: 'reconciliation' },
    })
    expect(cp.actual).toEqual({ revenue: 6_100_000, leads: 300, conversion: 9 }) // cash is not in this plan
    expect(cp.actualSources).toEqual({ revenue: 'reconciliation', leads: 'facts', conversion: 'reconciliation' })
    expect(cp.verdict.revenue?.verdict).toBe('on_track') // 2,4% below
    expect(cp.verdict.leads?.verdict).toBe('risk') // 9,1% below
    expect(cp.verdict.conversion?.verdict).toBe('behind') // 16,3% below
    expect(cp.verdict.avg_check?.verdict).toBe('no_data')
    expect(cp.overall).toBe('behind')
    expect(cp.reason).toBe('Конверсия 9% при плане 10,8%; лиды 300 при плане 330.')
    expect(cp.forecast).toMatchObject({ basis: 'insufficient', goalAnnual: 120_000_000, deadline: '2027-10-22' })
    expect(cp.computedAt).toBe(NOW.toISOString())
  })

  it('no facts for the month → «нет данных», not «отстаём»', () => {
    const cp = buildCheckpoint({ version: version(), period: '2026-09', actual: {}, result: null, tolerances: TOL, now: NOW })
    expect(cp.overall).toBe('no_data')
    expect(cp.reason).toContain('внесите «Факт за месяц»')
  })

  it('forecast: the reach date from the model trend; none without a trend', () => {
    const r = { gap: { baseAnnual: 60e6, targetAnnual: 120e6, months: 12 }, forecast: { atCurrentPace: { low: 1, base: 90e6, high: 2 }, trendMonthlyPct: 3, basis: 'history' } } as unknown as ModelResult
    // ln 2 / ln 1,03 = 23,4 → 24 months
    expect(forecastFromResult(r, NOW)).toMatchObject({ atDeadlineAnnual: 90e6, trendMonthlyPct: 3, reachDate: '2028-10-22', basis: 'history' })
    expect(forecastFromResult({ ...r, forecast: { ...r.forecast, trendMonthlyPct: null } } as ModelResult, NOW).reachDate).toBeNull()
    expect(forecastFromResult(null, NOW).basis).toBe('insufficient')
  })

  it('the verdict strip shows the newest checkpoint with data', () => {
    const cp = (period: string, overall: Checkpoint['overall']) => ({ period, overall } as Checkpoint)
    expect(currentCheckpoint([cp('2026-08', 'risk'), cp('2026-09', 'on_track'), cp('2026-10', 'no_data')])?.period).toBe('2026-09')
    expect(currentCheckpoint([cp('2026-10', 'no_data')])?.period).toBe('2026-10')
    expect(currentCheckpoint([])).toBeNull()
  })
})

describe('goal progress', () => {
  const goal = (over: Partial<PlanGoalItem> = {}): PlanGoalItem => ({
    metricKey: REVENUE, periodLabel: '12m', label: 'Удвоить выручку', baselineValue: 60_000_000, baselinePeriod: '2026',
    targetValue: 120_000_000, deadline: null, reviewStatus: 'verified', baselineAt: '2026-06-01T00:00:00Z', ...over,
  })

  it('share of the way and share of the time side by side, the forecast date at the trend', () => {
    const [p] = goalProgress({ goals: [goal()], facts: { [REVENUE]: { value: 75_000_000, period: '2026-09' } }, revenueTrendMonthlyPct: 2, planStart: null, now: NOW })
    expect(p).toMatchObject({ base: 60_000_000, fact: 75_000_000, target: 120_000_000, pathShare: 0.25, factPeriod: '2026-09', startDate: '2026-06-01', deadline: '2027-06-01', unit: 'money_year' })
    // 143,4 days of 365
    expect(p.timeShare).toBe(0.393)
    // ln(1,6) / ln(1,02) = 23,7 → 24 months from now
    expect(p.forecastDate).toBe('2028-10-22')
    expect(p.forecastNote).toBeNull()
  })

  it('no fact → no share of the way and a note; no base → no share either', () => {
    const [p] = goalProgress({ goals: [goal()], facts: {}, revenueTrendMonthlyPct: 2, planStart: null, now: NOW })
    expect(p).toMatchObject({ fact: null, pathShare: null, forecastDate: null, forecastNote: 'Нет факта выручки — дату не оценить.' })
    const [q] = goalProgress({ goals: [goal({ baselineValue: null })], facts: { [REVENUE]: { value: 7e7, period: null } }, revenueTrendMonthlyPct: 2, planStart: null, now: NOW })
    expect(q.pathShare).toBeNull()
  })

  it('no growth, no trend, a reached goal and a non-revenue goal each say why there is no date', () => {
    const facts = { [REVENUE]: { value: 7e7, period: '2026-09' } }
    expect(goalProgress({ goals: [goal()], facts, revenueTrendMonthlyPct: -1, planStart: null, now: NOW })[0].forecastNote).toBe('При текущем темпе выручка не растёт — даты достижения нет.')
    expect(goalProgress({ goals: [goal()], facts, revenueTrendMonthlyPct: null, planStart: null, now: NOW })[0].forecastNote).toContain('12 месяцев подряд')
    expect(goalProgress({ goals: [goal()], facts: { [REVENUE]: { value: 13e7, period: '2026-09' } }, revenueTrendMonthlyPct: 1, planStart: null, now: NOW })[0])
      .toMatchObject({ forecastNote: 'Цель уже достигнута по факту.', pathShare: 1.167 })
    const conv = goalProgress({ goals: [goal({ metricKey: 'biz.marketing.konversiya_lid_klient', label: null, baselineValue: 10, targetValue: 15 })], facts: { 'biz.marketing.konversiya_lid_klient': { value: 12, period: '2026-09' } }, revenueTrendMonthlyPct: 2, planStart: null, now: NOW })[0]
    expect(conv).toMatchObject({ label: 'Конверсия лида в клиента', unit: 'percent', pathShare: 0.4, forecastNote: 'Прогноз даты считается только для цели по выручке.' })
  })

  it('a goal without its own start counts the time from the plan start; days since a date', () => {
    const [p] = goalProgress({ goals: [goal({ baselineAt: null })], facts: {}, revenueTrendMonthlyPct: null, planStart: '2026-04-22T09:00:00Z', now: NOW })
    expect(p.startDate).toBe('2026-04-22')
    expect(p.timeShare).toBeCloseTo(0.501, 2)
    expect(daysSince('2026-10-19T09:00:00Z', NOW)).toBe(3)
    expect(daysSince(null, NOW)).toBeNull()
  })
})

describe('version diff', () => {
  const row = (over: Partial<VersionRowLike> = {}): VersionRowLike => ({
    id: 'v1', version: 1, status: 'superseded',
    goals: { primary: { metricKey: REVENUE, periodLabel: '12m' }, items: [{ metricKey: REVENUE, periodLabel: '12m', label: 'Удвоить выручку', baselineValue: 6e7, baselinePeriod: '2026', targetValue: 120e6, deadline: null, reviewStatus: 'verified' }] },
    assumptions: { model: { level: 1, kind: 'funnel', gap: { baseAnnual: 60e6, months: 12 } }, profiles: [{ key: 'moderate', label: 'Умеренный', rampMonths: 12, reserveMonths: 2, growthCapAnnual: 0.5 }] },
    scenarios: [scenario()], selected_scenario: 'moderate',
    strategy: { items: [{ key: 's1', kind: 'strategy', title: 'Рост продаж' }, { key: 't1', kind: 'task', title: 'Скрипты звонков' }] },
    change_reason: 'Первый план', author_name: 'Алия', approved_at: '2026-06-15T00:00:00Z', created_at: '2026-06-01T00:00:00Z',
    ...over,
  })

  it('summarizes a version: goals, pace, assumptions, totals, strategy, approver', () => {
    const s = summarizeVersion(row(), { approverName: 'Админ' })
    expect(s).toMatchObject({
      id: 'v1', version: 1, status: 'superseded', approverName: 'Админ', changeReason: 'Первый план', primaryGoal: `${REVENUE}|12m`,
      pace: { key: 'moderate', label: 'Умеренный', rampMonths: 12, reserveMonths: 2, growthCapAnnual: 0.5 },
      totals: { timeToGoalMonths: 12, revenueAtDeadline: 120_000_000, revenueTotal: null },
    })
    expect(s.goals).toEqual([{ key: `${REVENUE}|12m`, label: 'Удвоить выручку', target: 120e6, deadline: null, status: 'проверена' }])
    expect(s.assumptions.map((a) => [a.key, a.value])).toEqual([
      ['level', 'уровень 1'], ['kind', 'воронка'], ['base', '60 млн ₸'], ['months', '12 мес.'],
      ['lever:leads', '300'], ['lever:conversion', '10,0%'], ['lever:avgCheck', '140 тыс. ₸'],
    ])
    expect(s.strategy).toHaveLength(2)
  })

  it('diff: goals, pace, assumptions, totals, strategy added / removed / renamed, the reason of the newer version', () => {
    const older = summarizeVersion(row())
    const newer = summarizeVersion(row({
      id: 'v2', version: 2, status: 'approved', change_reason: 'Факт отстаёт: снижаем темп',
      goals: { primary: { metricKey: REVENUE, periodLabel: '12m' }, items: [{ metricKey: REVENUE, periodLabel: '12m', label: 'Удвоить выручку', baselineValue: 6e7, baselinePeriod: '2026', targetValue: 100e6, deadline: '2027-06-30', reviewStatus: 'agreed' }] },
      assumptions: { model: { level: 2, kind: 'funnel', gap: { baseAnnual: 62e6, months: 12 } }, profiles: [{ key: 'cautious', label: 'Осторожный', rampMonths: 18, reserveMonths: 3, growthCapAnnual: 0.25 }] },
      scenarios: [scenario({ key: 'cautious', label: 'Осторожный', timeToGoalMonths: { low: 20, base: 18, high: 16 } })], selected_scenario: 'cautious',
      strategy: { items: [{ key: 's1', kind: 'strategy', title: 'Рост продаж через партнёров' }, { key: 'i2', kind: 'initiative', title: 'Партнёрская программа' }] },
    }))
    // order does not matter: the older one is «before»
    const d = diffVersions(newer, older)
    expect(d.from).toEqual({ id: 'v1', version: 1 })
    expect(d.to).toEqual({ id: 'v2', version: 2 })
    expect(d.goals).toEqual([
      { field: `goal:${REVENUE}|12m`, label: 'Цель «Удвоить выручку»', before: '120 млн ₸', after: '100 млн ₸ к 2027-06-30' },
      { field: `goal-status:${REVENUE}|12m`, label: 'Статус цели «Удвоить выручку»', before: 'проверена', after: 'согласована' },
    ])
    expect(d.pace.map((e) => [e.label, e.before, e.after])).toEqual([
      ['Темп плана', 'Умеренный', 'Осторожный'],
      ['Выход рычагов на целевой уровень', '12 мес.', '18 мес.'],
      ['Резерв ликвидности', '2 мес.', '3 мес.'],
      ['Потолок годового роста', '50%', '25%'],
    ])
    expect(d.assumptions.map((e) => e.field)).toEqual(['assumption:level', 'assumption:base'])
    expect(d.totals).toEqual([{ field: 'time', label: 'Срок достижения цели', before: '12 мес.', after: '18 мес.' }])
    expect(d.strategyAdded).toEqual([{ key: 'i2', kind: 'initiative', title: 'Партнёрская программа' }])
    expect(d.strategyRemoved).toEqual([{ key: 't1', kind: 'task', title: 'Скрипты звонков' }])
    expect(d.strategyRenamed).toEqual([{ key: 's1', before: 'Рост продаж', after: 'Рост продаж через партнёров' }])
    expect(d.reason).toBe('Факт отстаёт: снижаем темп')
    expect(d.unchanged).toBe(false)
  })

  it('the same content → unchanged', () => {
    const d = diffVersions(summarizeVersion(row()), summarizeVersion(row({ id: 'v2', version: 2, change_reason: 'Без изменений' })))
    expect(d.unchanged).toBe(true)
    expect(d.reason).toBe('Без изменений')
  })
})

describe('periods and the recompute schedule', () => {
  it('month helpers', () => {
    expect(lastFinishedPeriod(NOW)).toBe('2026-09')
    expect(lastFinishedPeriod(new Date('2026-01-05T00:00:00Z'))).toBe('2025-12')
    expect(addPeriods('2026-11', 3)).toBe('2027-02')
    expect(periodLabel('2026-09')).toBe('сентябрь 2026')
  })

  it('Mon and Thu 22:00 UTC by default; other hours, days and invalid expressions', () => {
    const at = (iso: string) => new Date(iso)
    expect(cronDue('0 22 * * 1,4', at('2026-10-19T22:00:00Z'))).toBe(true) // Monday
    expect(cronDue('0 22 * * 1,4', at('2026-10-22T22:00:00Z'))).toBe(true) // Thursday
    expect(cronDue('0 22 * * 1,4', at('2026-10-22T21:00:00Z'))).toBe(false)
    expect(cronDue('0 22 * * 1,4', at('2026-10-20T22:00:00Z'))).toBe(false) // Tuesday
    expect(cronDue('0 6 1 * *', at('2026-11-01T06:00:00Z'))).toBe(true)
    expect(cronDue('0 6 1 * 1', at('2026-11-02T06:00:00Z'))).toBe(true) // either day field
    expect(cronDue('0 * * * 7', at('2026-10-25T03:00:00Z'))).toBe(true) // Sunday as 7
    expect(cronDue('garbage', at('2026-10-19T22:00:00Z'))).toBe(true) // falls back to the default
    expect(isValidRecomputeCron('0 */6 * * *')).toBe(true)
    expect(isValidRecomputeCron('*/10 * * * *')).toBe(false)
    expect(isValidRecomputeCron('0 25 * * *')).toBe(false)
    expect(isValidRecomputeCron('0 22 * *')).toBe(false)
  })
})
