/**
 * Model inputs, data levels and missing-input hints (Point B plan Ф2, Task 2).
 */
import { describe, expect, it } from 'vitest'
import { pbDb } from './_pbdb'
import { FUNNEL_METRICS, NOW, REVENUE, finmodelState, modelInputs, modelInputsL2, pointBInputs, src } from './_model'
import { loadRevenueHistory } from '@/lib/point-b/model/history'
import { buildModelInputs, sanitizeHistory, withDerivedActiveBase } from '@/lib/point-b/model/inputs'
import { determineLevel, templateKeyFor } from '@/lib/point-b/model/levels'
import type { PlanGoalsSnapshot } from '@/lib/point-b/plan/types'
import type { GoalReviewStatus } from '@/lib/point-b/plan/types'

const goals = (status: GoalReviewStatus = 'verified', over: Record<string, unknown> = {}): PlanGoalsSnapshot => ({
  primary: { metricKey: REVENUE, periodLabel: '12m' },
  items: [{ metricKey: REVENUE, periodLabel: '12m', label: null, baselineValue: null, baselinePeriod: null, targetValue: 120_000_000, deadline: null, reviewStatus: status, ...over }],
})

const build = (o: { metrics?: Record<string, number | null>; base?: Record<string, unknown>; goals?: PlanGoalsSnapshot | null; template?: 'ecommerce' | 'default' | 'services' | 'production' } = {}) =>
  buildModelInputs({
    pb: pointBInputs({ metrics: o.metrics, base: o.base as never }),
    history: [],
    template: o.template ?? 'ecommerce',
    goals: o.goals === undefined ? goals() : o.goals,
    now: NOW,
  })

describe('buildModelInputs', () => {
  it('levers are read from metrics and percent values become fractions', () => {
    const i = build({
      metrics: {
        ...FUNNEL_METRICS,
        'goal.02.repeat_purchase_rate': 28,
        'biz.marketing.cac': 45_000,
        'biz.klienty.aktivnykh_klientov': 500,
        'biz.hr.kol_vo_sotrudnikov': 14,
      },
    })
    expect(i.levers.leads).toEqual({ value: 300, origin: 'fact', period: null })
    expect(i.levers.conversion.value).toBeCloseTo(0.12, 12)
    expect(i.levers.repeat.value).toBeCloseTo(0.28, 12)
    expect(i.levers.avgCheck.value).toBe(185_000)
    expect(i.levers.cac.value).toBe(45_000)
    expect(i.levers.activeBase).toEqual({ value: 500, origin: 'fact', period: null })
    expect(i.levers.headcount.value).toBe(14)
    expect(i.base.revenueYear).toEqual({ value: 60_000_000, origin: 'fact', period: '2026' })
    expect(i.template).toBe('ecommerce')
    expect(i.now).toBe('2026-10-18T09:00:00.000Z')
  })

  it('the gross margin becomes a fraction and the finmodel is passed through (null when not loaded)', () => {
    const plain = build({ metrics: { ...FUNNEL_METRICS, 'biz.finansy.valovaya_marzha': 35 } })
    expect(plain.grossMargin?.value).toBeCloseTo(0.35, 12)
    expect(plain.finmodel).toBeNull()
    const fin = finmodelState()
    const withFin = buildModelInputs({ pb: pointBInputs(), history: [], template: 'ecommerce', goals: goals(), now: NOW, finmodel: fin })
    expect(withFin.finmodel).toBe(fin)
    expect(withFin.grossMargin).toEqual({ value: null, origin: null, period: null })
  })

  it('a zero, negative or missing metric is not a lever (null, no invented default)', () => {
    const i = build({ metrics: { 'biz.marketing.lidov_v_mes': 0, 'biz.prodazhi.sredniy_chek': -5, 'goal.02.repeat_purchase_rate': null } })
    expect(i.levers.leads.value).toBeNull()
    expect(i.levers.avgCheck.value).toBeNull()
    expect(i.levers.repeat).toEqual({ value: null, origin: null, period: null })
    expect(i.levers.conversion.value).toBeNull()
  })

  it('the goal is the primary revenue goal with its horizon and review status', () => {
    const i = build({ goals: goals('corrected') })
    expect(i.goal).toEqual({
      metricKey: REVENUE, targetAnnual: 120_000_000, deadline: '2027-10-18', months: 12, reviewStatus: 'corrected',
    })
  })

  it('goal review status is carried into ModelGoal.reviewStatus', () => {
    for (const status of ['owner_draft', 'verified', 'corrected', 'agreed', 'disputed'] as const) {
      expect(build({ goals: goals(status) }).goal?.reviewStatus).toBe(status)
    }
  })

  it('without goals, or without a revenue goal, goal is null', () => {
    expect(build({ goals: null }).goal).toBeNull()
    expect(build({ goals: { primary: null, items: [] } }).goal).toBeNull()
    expect(build({ goals: { primary: null, items: [{ ...goals().items[0], metricKey: 'biz.marketing.cac' }] } }).goal).toBeNull()
  })

  it('an explicit deadline of the goal is used for months and deadline', () => {
    const i = build({ goals: goals('verified', { periodLabel: '3y', deadline: '2027-04-18' }) })
    expect(i.goal?.deadline).toBe('2027-04-18')
    expect(i.goal?.months).toBe(7)
  })

  it('a missing base is a null revenue, not zero', () => {
    const i = build({ base: { revenue: null, period: null, ageMonths: null, stale: false } })
    expect(i.base.revenueYear).toEqual({ value: null, origin: null, period: null })
  })

  it('active base is derived as leads × conversion × 12 and marked derived', () => {
    const i = build({ metrics: FUNNEL_METRICS })
    expect(i.levers.activeBase.value).toBeCloseTo(432, 9)
    expect(i.levers.activeBase.origin).toBe('derived')
    // a stated active base is kept
    expect(build({ metrics: { ...FUNNEL_METRICS, 'biz.klienty.aktivnykh_klientov': 1000 } }).levers.activeBase).toEqual({ value: 1000, origin: 'fact', period: null })
    // no funnel: nothing to derive from
    expect(build({ metrics: {} }).levers.activeBase.value).toBeNull()
    // withDerivedActiveBase leaves other levers alone
    const l = modelInputs().levers
    expect(withDerivedActiveBase({ ...l, activeBase: src(null) }).leads).toBe(l.leads)
  })

  it('history is sanitised: valid months only, one per month, ascending', () => {
    expect(sanitizeHistory([
      { period: '2025-03', revenue: 3 }, { period: '2025-01', revenue: 1 }, { period: '2025-13', revenue: 9 },
      { period: '2025', revenue: 12 }, { period: '2025-02', revenue: 0 }, { period: '2025-01', revenue: 2 }, { period: '2025-04', revenue: NaN },
    ])).toEqual([{ period: '2025-01', revenue: 2 }, { period: '2025-03', revenue: 3 }])
  })
})

describe('determineLevel', () => {
  it('a goal without a base revenue is level 0 with missing base revenue', () => {
    const d = determineLevel(modelInputs({ base: { revenueYear: src(null), ageMonths: null, stale: false } }))
    expect(d.level).toBe(0)
    expect(d.kind).toBe('none')
    expect(d.missing.map((m) => m.key)).toEqual(['revenue_base'])
    expect(d.missing[0].actions).toEqual(['survey', 'documents', 'expert'])
  })

  it('no goal gives level 0 and missing goal with the survey and expert actions', () => {
    const d = determineLevel(modelInputs({ goal: null }))
    expect(d.level).toBe(0)
    expect(d.missing).toHaveLength(1)
    expect(d.missing[0]).toMatchObject({ key: 'goal', actions: ['survey', 'expert'] })
    expect(d.missing[0].unlocks.length).toBeGreaterThan(10)
    // neither goal nor base
    expect(determineLevel(modelInputs({ goal: null, base: { revenueYear: src(null), ageMonths: null, stale: false } })).missing.map((m) => m.key)).toEqual(['goal', 'revenue_base'])
  })

  it('base, goal and funnel levers give level 1 funnel', () => {
    const d = determineLevel(modelInputs())
    expect(d).toMatchObject({ level: 1, kind: 'funnel' })
    // optional extras are offered, the funnel inputs are not missing
    expect(d.missing.map((m) => m.key)).toEqual(['repeat', 'cac', 'headcount'])
    const full = determineLevel(modelInputs({ levers: { repeat: src(0.28), cac: src(45_000), headcount: src(14) } }))
    expect(full.missing).toEqual([])
    // a services business has a funnel too
    expect(determineLevel(modelInputs({ template: 'services' })).kind).toBe('funnel')
  })

  it('no funnel metrics give level 1 growth with missing leads/conversion/check listed and unlocking text', () => {
    const d = determineLevel(modelInputs({ levers: { leads: src(null), conversion: src(null), avgCheck: src(null), activeBase: src(null) } }))
    expect(d).toMatchObject({ level: 1, kind: 'growth' })
    expect(d.missing.map((m) => m.key)).toEqual(['leads', 'conversion', 'avgCheck', 'headcount'])
    for (const m of d.missing) {
      expect(m.level).toBe(1)
      expect(m.label.length).toBeGreaterThan(3)
      expect(m.unlocks.length).toBeGreaterThan(10)
      expect(m.actions.length).toBeGreaterThan(0)
    }
    // a single missing lever is enough to stay on the growth model
    expect(determineLevel(modelInputs({ levers: { avgCheck: src(null) } })).kind).toBe('growth')
  })

  it('production and default templates use the growth model even with a funnel', () => {
    expect(determineLevel(modelInputs({ template: 'production' })).kind).toBe('growth')
    expect(determineLevel(modelInputs({ template: 'default' })).kind).toBe('growth')
    // with the levers present they are not reported as missing
    expect(determineLevel(modelInputs({ template: 'production' })).missing.map((m) => m.key)).toEqual(['headcount'])
  })

  it('level 2 is not issued by the levers alone: it needs a complete finmodel and a margin', () => {
    const levels = [modelInputs(), modelInputs({ goal: null }), modelInputs({ template: 'production' })].map((i) => determineLevel(i).level)
    expect(levels.every((l) => l === 0 || l === 1)).toBe(true)
    expect(determineLevel(modelInputsL2())).toMatchObject({ level: 2, kind: 'funnel' })
    expect(determineLevel(modelInputsL2({ template: 'production' }, {}, { template: 'production' }))).toMatchObject({ level: 2, kind: 'growth' })
    // a goalless client cannot reach level 2 whatever the finmodel says
    expect(determineLevel(modelInputsL2({ goal: null })).level).toBe(0)
  })
})

describe('templateKeyFor', () => {
  it('maps «Интернет-магазин» to ecommerce and unknown to default', () => {
    expect(templateKeyFor('Интернет-магазин')).toBe('ecommerce')
    expect(templateKeyFor('Розница и маркетплейсы')).toBe('ecommerce')
    expect(templateKeyFor('IT-консалтинг')).toBe('services')
    expect(templateKeyFor('Производство мебели')).toBe('production')
    expect(templateKeyFor('Космический туризм')).toBe('default')
    expect(templateKeyFor(null)).toBe('default')
    expect(templateKeyFor('')).toBe('default')
  })
})

describe('loadRevenueHistory', () => {
  const fact = (period_key: string, value: number, extra: Record<string, unknown> = {}) => ({
    company_id: 'c1', metric_key: REVENUE, period_key, value, source_kind: 'survey', flags: [], confidence: 0.9, ...extra,
  })

  it('loadRevenueHistory returns monthly facts sorted and skips quarterly and annual periods', async () => {
    const h = pbDb({
      metric_facts: [
        fact('2025-03', 3_000_000, { source_kind: 'integration' }),
        fact('2024', 36_000_000),
        fact('2025-Q2', 9_000_000),
        fact('2025-01', 1_000_000, { source_kind: 'integration' }),
        fact('2026-YTD', 40_000_000),
        fact('unknown', 5),
        fact('2025-02', 2_000_000, { source_kind: 'integration' }),
        { ...fact('2025-01', 1, { source_kind: 'integration' }), company_id: 'other' },
        { ...fact('2025-01', 7, { source_kind: 'integration' }), metric_key: 'biz.marketing.cac' },
      ],
    })
    expect(await loadRevenueHistory(h.sb, 'c1')).toEqual([
      { period: '2025-01', revenue: 1_000_000 },
      { period: '2025-02', revenue: 2_000_000 },
      { period: '2025-03', revenue: 3_000_000 },
    ])
  })

  it('a monthly figure stored ×12 (flag rescaled) is brought back to the month; source priority and invalid facts are respected', async () => {
    const h = pbDb({
      metric_facts: [
        // yearly metric ← monthly document: ×12 and flagged rescaled
        fact('2025-01', 12_000_000, { source_kind: 'document', flags: ['rescaled'], confidence: 0.8 }),
        // the survey wins over the integration; the invalid one is skipped
        fact('2025-02', 2_000_000, { source_kind: 'integration' }),
        fact('2025-02', 24_000_000, { source_kind: 'survey', flags: ['rescaled'] }),
        fact('2025-03', 999, { source_kind: 'manual', flags: ['invalid'] }),
        fact('2025-04', 0, { source_kind: 'manual' }),
        fact('2025-05', 5_000_000, { source_kind: 'document', confidence: 0.5 }),
        fact('2025-05', 5_500_000, { source_kind: 'document', confidence: 0.9 }),
      ],
    })
    expect(await loadRevenueHistory(h.sb, 'c1')).toEqual([
      { period: '2025-01', revenue: 1_000_000 },
      { period: '2025-02', revenue: 2_000_000 },
      { period: '2025-05', revenue: 5_500_000 },
    ])
  })

  it('a read error gives an empty history and a log, not a throw', async () => {
    const sb = { from: () => ({ select: () => ({ eq: () => ({ eq: () => ({ limit: async () => ({ data: null, error: { code: '42P01' } }) }) }) }) }) }
    expect(await loadRevenueHistory(sb as never, 'c1')).toEqual([])
  })
})
