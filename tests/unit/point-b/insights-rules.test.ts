/**
 * Point B Ф6a, Task 2: the deterministic rules — invites (evaluateInsightRules), the limiting factor and the
 * contradictions of a plan. Fixtures are REAL model results (computeModel on the golden e-commerce client)
 * patched where a boundary has to be pinned.
 */
import { describe, expect, it } from 'vitest'
import { computeModel } from '@/lib/point-b/model/compute'
import type { ModelResult, ScenarioFinance, ScenarioResult } from '@/lib/point-b/model/types'
import { evaluateInsightRules, type InsightCandidate } from '@/lib/point-b/insights/rules'
import { findLimitingFactor } from '@/lib/point-b/insights/constraint'
import { findContradictions } from '@/lib/point-b/insights/contradictions'
import { allowedNumbers, extractNumbers, foreignNumbers } from '@/lib/point-b/insights/numbers'
import { modelInputs, modelInputsL2, src } from './_model'

/** The golden funnel client: base 60M, goal 120M in 12 months, 300 leads × 12% × 140 000 ₸, 10 employees. */
const funnel = (): ModelResult => computeModel(modelInputs({ levers: { avgCheck: src(140_000), headcount: src(10) } }))
const level2 = (): ModelResult => computeModel(modelInputsL2())

function patchScenario(r: ModelResult, key: string, patch: Partial<ScenarioResult>): ModelResult {
  return { ...r, scenarios: r.scenarios.map((s) => (s.key === key ? { ...s, ...patch } : s)) }
}
function patchFinance(r: ModelResult, key: string, patch: Partial<ScenarioFinance>): ModelResult {
  return { ...r, scenarios: r.scenarios.map((s) => (s.key === key && s.finance ? { ...s, finance: { ...s.finance, ...patch } } : s)) }
}
function withConversion(r: ModelResult, key: string, upliftPct: number): ModelResult {
  const s = r.scenarios.find((x) => x.key === key)!
  return patchScenario(r, key, {
    requiredUplift: s.requiredUplift.map((u) => (u.lever === 'conversion' ? { ...u, target: (u.current as number) * (1 + upliftPct / 100), upliftPct } : u)),
  })
}
/** Only the selected numbers of a result: no staff, no conversion gap — a «quiet» result to switch rules on one by one. */
function quiet(r: ModelResult): ModelResult {
  return {
    ...r,
    verdict: { key: 'on_track', headline: 'На курсе', reason: '' },
    scenarios: r.scenarios.map((s) => ({
      ...s,
      feasible: true,
      infeasibleReason: null,
      investments: { ...s.investments, staffNeed: 0 },
      requiredUplift: s.requiredUplift.map((u) => (u.lever === 'conversion' ? { ...u, upliftPct: 5, target: (u.current as number) * 1.05 } : u)),
      ...(s.finance ? { finance: { ...s.finance, cashGapMonth: null, fundingNeed: 0 } } : {}),
    })),
  }
}
const run = (result: ModelResult, over: Partial<Parameters<typeof evaluateInsightRules>[0]> = {}): InsightCandidate[] =>
  evaluateInsightRules({ result, selectedScenario: null, finmodelMissing: 0, pendingCorrection: false, ...over })
const keys = (list: InsightCandidate[]) => list.map((c) => c.ruleKey)
const one = (list: InsightCandidate[], key: string) => list.find((c) => c.ruleKey === key)

describe('evaluateInsightRules — the seven rules', () => {
  it('cash_gap: a gap in month 6 opens as a modal, in month 7 as a card; none without a gap', () => {
    const base = quiet(level2())
    expect(base.level).toBe(2)
    expect(one(run(base), 'cash_gap')).toBeUndefined()

    const m6 = run(patchFinance(base, 'moderate', { cashGapMonth: 6, minCash: { value: -256_076, month: 6 } }))
    const c6 = one(m6, 'cash_gap')!
    expect(c6).toMatchObject({ priority: 1, display: 'modal', href: '/client/point-b?tab=whatif', kind: 'insight', dedupeKey: 'cash_gap:moderate:m6' })
    expect(c6.title).toBe('Кассовый разрыв в месяце 6')
    expect(c6.body).toContain('Рассчитать безопасный резерв?')
    expect(c6.body).toContain('минимум — −256 тыс. ₸')

    const m7 = one(run(patchFinance(base, 'moderate', { cashGapMonth: 7 })), 'cash_gap')!
    expect(m7).toMatchObject({ display: 'card', dedupeKey: 'cash_gap:moderate:m7' })
  })

  it('funding_need: a need without a gap speaks; with a gap only cash_gap speaks', () => {
    const base = quiet(level2())
    const need = run(patchFinance(base, 'moderate', { fundingNeed: 76_076 }))
    expect(one(need, 'funding_need')).toMatchObject({ priority: 3, display: 'card', title: 'Для выбранного темпа нужен резерв около 76 тыс. ₸' })
    const both = run(patchFinance(base, 'moderate', { fundingNeed: 76_076, cashGapMonth: 3 }))
    expect(keys(both)).toContain('cash_gap')
    expect(keys(both)).not.toContain('funding_need')
  })

  it('staff_load: staffNeed > 0 speaks, 0 or unknown is silent', () => {
    const base = quiet(funnel())
    expect(one(run(base), 'staff_load')).toBeUndefined()
    const staff = one(run(patchScenario(base, 'moderate', { investments: { ...base.scenarios[1].investments, staffNeed: 10 } })), 'staff_load')!
    expect(staff).toMatchObject({ priority: 3, title: 'Выбранному темпу нужно около 10 новых сотрудников', href: '/client/point-b?tab=whatif' })
    expect(one(run(patchScenario(base, 'moderate', { investments: { ...base.scenarios[1].investments, staffNeed: null } })), 'staff_load')).toBeUndefined()
  })

  it('conversion_gap: +19% is silent, +20% speaks (funnel only)', () => {
    const base = quiet(funnel())
    expect(one(run(withConversion(base, 'moderate', 19)), 'conversion_gap')).toBeUndefined()
    expect(one(run(withConversion(base, 'moderate', 19.9)), 'conversion_gap')).toBeUndefined()
    const c = one(run(withConversion(base, 'moderate', 20)), 'conversion_gap')!
    expect(c).toMatchObject({ priority: 2, href: '/client/point-b?tab=strategy' })
    expect(c.title).toBe('Цель требует роста конверсии с 12,0% до 14,4%')
    expect(c.body).toContain('Построить план улучшения продаж?')
    // the real golden scenario needs +25,8%
    expect(one(run(funnel()), 'conversion_gap')?.title).toBe('Цель требует роста конверсии с 12,0% до 15,1%')
    // the growth model has no conversion lever
    expect(one(run({ ...withConversion(base, 'moderate', 40), kind: 'growth' }), 'conversion_gap')).toBeUndefined()
  })

  it('finmodel_gap: level 1 with a missing finmodel key, never at level 2', () => {
    const l1 = quiet(funnel())
    expect(one(run(l1, { finmodelMissing: 0 }), 'finmodel_gap')).toBeUndefined()
    expect(one(run(l1, { finmodelMissing: 1 }), 'finmodel_gap')).toMatchObject({
      priority: 4, expiresInDays: 30, href: '/client/point-b?tab=finmodel', dedupeKey: 'finmodel_gap',
      title: 'Добавьте данные о деньгах — покажем кассовый разрыв',
    })
    expect(one(run(quiet(level2()), { finmodelMissing: 3 }), 'finmodel_gap')).toBeUndefined()
  })

  it('pace_behind: behind and at_risk speak with the forecast and the goal; on_track and no_data are silent', () => {
    const base = quiet(funnel())
    const forecast = { atCurrentPace: { low: 70_000_000, base: 84_000_000, high: 96_000_000 }, trendMonthlyPct: 2.9, basis: 'history' as const }
    const behind = run({ ...base, forecast, verdict: { key: 'behind', headline: 'Отстаём от цели', reason: 'При текущем ходе к 2027-10-18 выручка выйдет на 84 млн ₸ в год — это 70% от цели в 120 млн ₸.' } })
    expect(one(behind, 'pace_behind')).toMatchObject({ priority: 2, dedupeKey: 'pace_behind:behind', href: '/client/point-b?tab=strategy', title: 'Текущий ход отстаёт от цели' })
    expect(one(behind, 'pace_behind')!.body).toBe('Прогноз при текущем ходе — 84 млн ₸ в год при цели 120 млн ₸. Пересмотреть стратегию?')
    expect(one(run({ ...base, forecast, verdict: { ...base.verdict, key: 'at_risk' } }), 'pace_behind')?.dedupeKey).toBe('pace_behind:at_risk')
    expect(one(run({ ...base, forecast, verdict: { ...base.verdict, key: 'on_track' } }), 'pace_behind')).toBeUndefined()
    expect(one(run({ ...base, verdict: { ...base.verdict, key: 'no_data' } }), 'pace_behind')).toBeUndefined()
  })

  it('infeasible: the selected scenario that is not feasible speaks with its reason', () => {
    const base = quiet(funnel())
    const r = patchScenario(base, 'aggressive', { feasible: false, infeasibleReason: 'Лиды: нужен рост в ×4,2, потолок реализуемости — ×3.' })
    expect(one(run(r), 'infeasible')).toBeUndefined() // the moderate one is feasible
    const c = one(run(r, { selectedScenario: 'aggressive' }), 'infeasible')!
    expect(c).toMatchObject({ priority: 1, dedupeKey: 'infeasible:aggressive', title: 'Выбранный темп недостижим', href: '/client/point-b?tab=scenarios' })
    expect(c.body).toBe('Темп «Агрессивный»: Лиды: нужен рост в ×4,2, потолок реализуемости — ×3.')
  })

  it('goal_correction: an expert correction waiting for the owner', () => {
    const c = one(run(quiet(funnel()), { pendingCorrection: true }), 'goal_correction')!
    expect(c).toMatchObject({ priority: 2, dedupeKey: 'goal_correction', display: 'card' })
    expect(one(run(quiet(funnel())), 'goal_correction')).toBeUndefined()
  })
})

describe('evaluateInsightRules — general', () => {
  it('rules are silent at level 0 and without scenarios', () => {
    const l0 = computeModel(modelInputs({ goal: null }))
    expect(l0.level).toBe(0)
    expect(run(l0, { finmodelMissing: 5, pendingCorrection: true })).toEqual([])
    const noScenarios: ModelResult = { ...funnel(), scenarios: [], verdict: { key: 'behind', headline: '', reason: '' } }
    expect(run(noScenarios, { finmodelMissing: 5, pendingCorrection: true })).toEqual([])
    // a growth-model result without finmodel, staff or verdict is quiet too (no invite from nothing)
    expect(run(quiet(funnel()))).toEqual([])
  })

  it('dedupeKey differs by scenario and month', () => {
    const base = quiet(level2())
    const gap = (key: string, month: number) => one(run(patchFinance(base, key, { cashGapMonth: month }), { selectedScenario: key }), 'cash_gap')!.dedupeKey
    expect(gap('moderate', 5)).toBe('cash_gap:moderate:m5')
    expect(gap('moderate', 8)).toBe('cash_gap:moderate:m8')
    expect(gap('cautious', 5)).toBe('cash_gap:cautious:m5')
    expect(new Set([gap('moderate', 5), gap('moderate', 8), gap('cautious', 5)]).size).toBe(3)
    // the same subject → the same key (a repeat is caught by the active-invite index)
    expect(gap('moderate', 5)).toBe(gap('moderate', 5))
  })

  it('texts contain only numbers present in the result', () => {
    const forecast = { atCurrentPace: { low: 70_000_000, base: 84_000_000, high: 96_000_000 }, trendMonthlyPct: 2.9, basis: 'history' as const }
    const cases: Array<{ result: ModelResult; selected: string | null }> = [
      { result: { ...funnel(), forecast, verdict: { key: 'behind', headline: 'Отстаём', reason: 'Прогноз 84 млн ₸.' } }, selected: null },
      { result: patchFinance(level2(), 'moderate', { cashGapMonth: 4, minCash: { value: -256_076, month: 4 } }), selected: 'moderate' },
      { result: patchScenario(level2(), 'cautious', { feasible: false, infeasibleReason: 'Лиды: нужен рост в ×4,2, потолок реализуемости — ×3.' }), selected: 'cautious' },
    ]
    let checked = 0
    for (const { result, selected } of cases) {
      const allowed = allowedNumbers(result)
      for (const c of run(result, { selectedScenario: selected, finmodelMissing: 2, pendingCorrection: true })) {
        for (const text of [c.title, c.body, c.why]) {
          expect(foreignNumbers(text, allowed), `${c.ruleKey}: «${text}»`).toEqual([])
          checked += extractNumbers(text).length
        }
      }
    }
    expect(checked).toBeGreaterThan(5)
    // the checker itself catches an invented number
    expect(foreignNumbers('Нужен резерв 9 876 543 ₸ к месяцу 4', allowedNumbers(level2()))).toEqual(['9876543'])
  })

  it('candidates are sorted by priority', () => {
    const forecast = { atCurrentPace: { low: 70_000_000, base: 84_000_000, high: 96_000_000 }, trendMonthlyPct: 2.9, basis: 'history' as const }
    let r = patchFinance(level2(), 'moderate', { cashGapMonth: 9, fundingNeed: 1_000_000 })
    r = { ...r, forecast, verdict: { key: 'behind', headline: '', reason: '' } }
    r = patchScenario(r, 'moderate', { feasible: false, infeasibleReason: 'причина' })
    const list = run(r)
    expect(list.map((c) => c.priority)).toEqual([...list.map((c) => c.priority)].sort((a, b) => a - b))
    expect(keys(list).slice(0, 2)).toEqual(['cash_gap', 'infeasible'])
    expect(list.length).toBeGreaterThanOrEqual(4)
    // JSON-safe
    expect(JSON.parse(JSON.stringify(list))).toEqual(list)
  })
})

describe('findLimitingFactor', () => {
  const blocks = [{ key: 'marketing', score: 45 }, { key: 'sales', score: 50 }, { key: 'finance', score: 60 }]

  it('findLimitingFactor picks the lever with the highest required-to-cap ratio and returns null without data', () => {
    // golden: leads +37,9% of ×3 (0,19 of the headroom), conversion 12% → 15,1% of 24% (0,26), check +14,8% of ×2 (0,15)
    const f = findLimitingFactor(funnel(), blocks)!
    expect(f.lever).toBe('conversion')
    expect(f.label).toBe('Конверсия лида в клиента')
    expect(f.reason).toContain('с 12,0% до 15,1%')
    expect(f.sourceRefs).toEqual(expect.arrayContaining([
      { type: 'scenario', ref: 'moderate', label: 'Сценарий «Умеренный»' },
      { type: 'metric', ref: 'biz.marketing.konversiya_lid_klient', label: 'Конверсия лида в клиента' },
      { type: 'snapshot', ref: 'block:sales', label: 'Блок Точки А «Продажи»' },
    ]))
    // the sales block is not the weakest (marketing 45) → not said
    expect(f.reason).not.toContain('самый слабый')
    expect(foreignNumbers(f.reason, allowedNumbers(funnel()))).toEqual([])

    // leads close to their cap (+180% of +200%) → leads
    const r = funnel()
    const leadsHeavy = patchScenario(r, 'moderate', { requiredUplift: r.scenarios[1].requiredUplift.map((u) => (u.lever === 'leads' ? { ...u, target: 840, upliftPct: 180 } : u)) })
    const g = findLimitingFactor(leadsHeavy, blocks)!
    expect(g.lever).toBe('leads')
    expect(g.reason).toContain('Связанный блок Точки А «Маркетинг» — самый слабый.')

    // a tie of ratios: the lever of the weakest block wins (check vs leads, both use half of their headroom)
    const tie = patchScenario(r, 'moderate', {
      requiredUplift: [
        { lever: 'leads', label: 'Лиды в месяц', current: 300, target: 600, upliftPct: 100 },
        { lever: 'avgCheck', label: 'Средний чек', current: 140_000, target: 210_000, upliftPct: 50 },
      ],
    })
    expect(findLimitingFactor(tie, [{ key: 'marketing', score: 70 }, { key: 'sales', score: 40 }])!.lever).toBe('avgCheck')
    expect(findLimitingFactor(tie, [{ key: 'marketing', score: 30 }, { key: 'sales', score: 40 }])!.lever).toBe('leads')

    // no data → null
    expect(findLimitingFactor(computeModel(modelInputs({ goal: null })), blocks)).toBeNull()
    expect(findLimitingFactor({ ...funnel(), scenarios: [] }, blocks)).toBeNull()
    expect(findLimitingFactor({ ...funnel(), kind: 'growth' }, blocks)).toBeNull()
    expect(findLimitingFactor(patchScenario(r, 'moderate', { requiredUplift: [] }), blocks)).toBeNull()
  })
})

describe('findContradictions', () => {
  it('contradictions (a)–(e) trigger and stay silent on consistent data', () => {
    // consistent: the selected moderate pace reaches the goal in 12 of 12 months, no money, goal verified
    const clean = quiet(funnel())
    expect(findContradictions({ result: { ...clean, gap: { ...clean.gap, multiplier: 1.5 } }, selectedScenario: 'moderate', goalMonths: 12 })).toEqual([])

    // (a) the cautious pace needs 18 months for a 12-month goal
    const a = findContradictions({ result: { ...clean, gap: { ...clean.gap, multiplier: 1.5 } }, selectedScenario: 'cautious', goalMonths: 12 })
    expect(a.map((c) => c.key)).toEqual(['deadline_vs_pace'])
    expect(a[0].reason).toBe('При темпе «Осторожный» цель достигается через 18 мес., а срок цели — 12 мес.')

    // (b) the selected scenario has a cash gap
    const l2 = patchFinance(quiet(level2()), 'moderate', { cashGapMonth: 5 })
    expect(findContradictions({ result: { ...l2, gap: { ...l2.gap, multiplier: 1.5 } }, selectedScenario: 'moderate', goalMonths: 12 }).map((c) => c.key)).toEqual(['cash_gap_selected'])
    // not selected → the scenario is not the plan, no contradiction
    expect(findContradictions({ result: { ...l2, gap: { ...l2.gap, multiplier: 1.5 } }, selectedScenario: null, goalMonths: 12 })).toEqual([])

    // (c) ×2 with 10 new employees needed
    const c = patchScenario(clean, 'moderate', { investments: { ...clean.scenarios[1].investments, staffNeed: 10 } })
    const cc = findContradictions({ result: c, selectedScenario: 'moderate', goalMonths: 12 })
    expect(cc.map((x) => x.key)).toEqual(['growth_without_staff'])
    expect(cc[0].reason).toContain('рост выручки в ×2')
    // ×1,5 is not «в разы»; unknown headcount (staffNeed null) is silent
    expect(findContradictions({ result: { ...c, gap: { ...c.gap, multiplier: 1.5 } }, selectedScenario: 'moderate', goalMonths: 12 })).toEqual([])
    expect(findContradictions({ result: patchScenario(clean, 'moderate', { investments: { ...clean.scenarios[1].investments, staffNeed: null } }), selectedScenario: 'moderate', goalMonths: 12 })).toEqual([])

    // (d) the model warns that the funnel does not agree with the fact
    const d = { ...clean, gap: { ...clean.gap, multiplier: 1.5 }, warnings: ['Расчёт по воронке не сходится с фактом на 33%: сценарии построены по упрощённой модели роста.'] }
    expect(findContradictions({ result: d, selectedScenario: null, goalMonths: 12 }).map((x) => x.key)).toEqual(['goal_vs_base'])

    // (e) a pace is selected while the goal is not verified
    const e = { ...clean, gap: { ...clean.gap, multiplier: 1.5 }, warnings: ['Цель не проверена экспертом: расчёт может измениться после проверки.'] }
    expect(findContradictions({ result: e, selectedScenario: 'moderate', goalMonths: 12 }).map((x) => x.key)).toEqual(['goal_not_verified'])
    expect(findContradictions({ result: e, selectedScenario: null, goalMonths: 12 })).toEqual([])

    // level 0 / no scenarios → nothing
    expect(findContradictions({ result: computeModel(modelInputs({ goal: null })), selectedScenario: 'moderate', goalMonths: 12 })).toEqual([])

    // every text only with numbers of its result
    for (const [result, sel] of [[{ ...clean, gap: { ...clean.gap, multiplier: 1.5 } }, 'cautious'], [l2, 'moderate'], [c, 'moderate'], [d, null]] as const) {
      for (const x of findContradictions({ result, selectedScenario: sel, goalMonths: 12 })) {
        expect(foreignNumbers(x.reason, allowedNumbers(result).add('12')), x.key).toEqual([])
      }
    }
  })
})
