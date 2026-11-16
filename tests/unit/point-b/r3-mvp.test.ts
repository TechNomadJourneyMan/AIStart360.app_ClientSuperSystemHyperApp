/**
 * R3-PB — the pure parts of the minimal working Точка Б:
 *   M1  the rule strategy of the one-click draft (strategy/draft.ts) and the AI wording guard (strategy/ai-wording.ts):
 *       numbers only from the data, the rules' text kept when the AI invents a figure, no AI without a key / budget;
 *   S1  where the plan honestly stands for the client and the sign «клиент ждёт план» (plan/waiting.ts) with the scan
 *       the next round's queue plugs in;
 *   M2  «Выручка по месяцам»: validation, the table, ONE history for the model (finmodel/revenue-history.ts,
 *       model/history.ts) and the client controller;
 *   M3  one calculation for the PDF / share / chat (report.ts).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const s = vi.hoisted(() => ({ budget: null as Error | null, usage: [] as unknown[] }))
vi.mock('@/lib/ai/budget', () => ({
  assertAiBudget: async () => { if (s.budget) throw s.budget },
  isAiBudgetError: (e: unknown) => e instanceof Error && e.message === 'budget',
}))
vi.mock('@/lib/ai/usage', () => ({ recordAiUsage: async (u: unknown) => { s.usage.push(u) } }))
vi.mock('@/lib/ai/gateway', async (orig) => ({ ...(await orig<typeof import('@/lib/ai/gateway')>()), hasLlmKey: () => false }))

const { fixtureModelResult } = await import('@/lib/point-b/fixtures')
const { buildRuleStrategy, draftCounts, DRAFT_MAX_TASKS } = await import('@/lib/point-b/strategy/draft')
const { wordStrategyWithAi } = await import('@/lib/point-b/strategy/ai-wording')
const { validateStrategy } = await import('@/lib/point-b/strategy/validate')
const { buildRecsContext } = await import('@/lib/point-b/recs/context')
const { foreignNumbers } = await import('@/lib/point-b/insights/numbers')
const { pickDraftPace } = await import('@/lib/point-b/plan/quick-draft')
const { planPrepState, isWaitingForPlan, listClientsWaitingForPlan } = await import('@/lib/point-b/plan/waiting')
const { revenueHistoryPeriods, revenueTableFrom, validateRevenueHistory, RevenueHistoryError } = await import('@/lib/point-b/finmodel/revenue-history')
const { loadRevenueHistory, mergeMonthly } = await import('@/lib/point-b/model/history')
const { RevenueHistoryController, changedMonths, parseAmount, runText } = await import('@/components/point-b/revenueHistoryController')
const { pointBReportFrom, pointBReportText } = await import('@/lib/point-b/report')
const { parsePlanPrep, planPrepView } = await import('@/components/point-b/planPrep')
const { quickDraftNotice } = await import('@/components/giga-panel/user360/point-b/planController')
const { pbDb } = await import('./_pbdb')

import type { ModelResult, PointBState } from '@/lib/point-b/model/types'

const NOW = new Date('2026-11-15T10:00:00Z')
const keys = () => { let i = 0; return () => `node-key-${String(++i).padStart(4, '0')}` }
const blocks = [{ key: 'marketing', title: 'Маркетинг', score: 40 }, { key: 'sales', title: 'Продажи', score: 55 }]
const GRI = [
  { rank: 1, title: 'Нет системы продаж', block: 'operations', severity: 'critical' },
  { rank: 2, title: 'Слабое позиционирование', block: 'trust-positioning', severity: 'high' },
  { rank: 3, title: 'Нет финансового резерва', block: 'cash-stability', severity: 'high' },
  { rank: 4, title: 'Команда перегружена', block: 'team', severity: 'medium' },
]

beforeEach(() => { s.budget = null; s.usage = [] })

// ── M1: the rule strategy ───────────────────────────────────────────────

describe('buildRuleStrategy — the draft strategy of the rules (M1)', () => {
  const full = fixtureModelResult('full')

  it('is a valid tree of the levers of the model, the limiting factor first, TOP GRI as initiatives, 3–7 tasks', () => {
    const tree = buildRuleStrategy({ result: full, selectedScenario: 'moderate', blocks, griTop5: GRI, now: NOW, newKey: keys() })
    const checked = validateStrategy(tree)
    expect(checked.ok, JSON.stringify(checked)).toBe(true)
    const c = draftCounts(tree)
    expect(c.tasks).toBeGreaterThanOrEqual(3)
    expect(c.tasks).toBeLessThanOrEqual(DRAFT_MAX_TASKS)
    expect(c.milestones).toBeGreaterThanOrEqual(1)
    const strategies = tree.items.filter((n) => n.kind === 'strategy')
    expect(strategies[0].impact).toBe(5)
    expect(strategies[0].description).toMatch(/Ограничивающий фактор роста/)
    expect(strategies[0].metricId).toBeTruthy()
    expect(strategies[0].kpi).not.toBeNull()
    // every task has a due date within ~6 weeks and a parent initiative
    for (const t of tree.items.filter((n) => n.kind === 'task')) {
      expect(t.dueDate! > '2026-11-15' && t.dueDate! <= '2026-12-31').toBe(true)
      expect(tree.items.find((n) => n.key === t.parentKey)!.kind).toBe('initiative')
    }
    // GRI limits become initiatives of their own strategy (as many as the task budget allows)
    expect(strategies.some((n) => n.title === 'Снять ограничения роста (GRI)')).toBe(c.tasks < DRAFT_MAX_TASKS || tree.items.some((n) => n.title.startsWith('Ограничение:')))
  })

  it('writes no number that is not in the data of the model (the AI and the staff build on the same figures)', () => {
    const tree = buildRuleStrategy({ result: full, selectedScenario: 'moderate', blocks, griTop5: [], now: NOW, newKey: keys() })
    const ctx = buildRecsContext({ result: full, selectedScenario: 'moderate', blocks, strategyOutline: [], goalText: null })
    for (const n of tree.items) {
      expect(foreignNumbers(`${n.title} ${n.description ?? ''}`, ctx.allowedNumbers), n.title).toEqual([])
    }
  })

  it('the growth model (no levers) gets one strategy on the gap; level 0 gets nothing — never an invented plan', () => {
    const growth = fixtureModelResult('full')
    const g: ModelResult = { ...growth, kind: 'growth' }
    const tree = buildRuleStrategy({ result: g, selectedScenario: null, blocks, griTop5: null, now: NOW, newKey: keys() })
    expect(tree.items.filter((n) => n.kind === 'strategy').map((n) => n.title)).toEqual(['Рост выручки до цели'])
    expect(validateStrategy(tree).ok).toBe(true)
    expect(buildRuleStrategy({ result: fixtureModelResult('no-goal'), selectedScenario: null, blocks, now: NOW })).toEqual({ items: [], milestones: [] })
  })

  it('the pace of the draft: a calculated chosen one is kept, else «умеренный», else the first feasible', () => {
    expect(pickDraftPace(full, null)).toBe('moderate')
    expect(pickDraftPace(full, 'aggressive')).toBe('aggressive')
    expect(pickDraftPace(full, 'nonsense')).toBe('moderate')
    const onlyTwo = { ...full, scenarios: full.scenarios.filter((x) => x.key !== 'moderate') }
    expect(pickDraftPace(onlyTwo, null)).toBe(onlyTwo.scenarios.find((x) => x.feasible)?.key ?? onlyTwo.scenarios[0].key)
  })
})

// ── M1: the AI wording ──────────────────────────────────────────────────

describe('wordStrategyWithAi — the AI words the draft, never a number (M1)', () => {
  const full = fixtureModelResult('full')
  const tree = buildRuleStrategy({ result: full, selectedScenario: 'moderate', blocks, griTop5: [], now: NOW, newKey: keys() })
  const ctx = buildRecsContext({ result: full, selectedScenario: 'moderate', blocks, strategyOutline: [], goalText: null })
  const [a, b] = tree.items

  it('takes a clean text, drops a text with a figure that is not in the data (the rules stay), ignores unknown keys', async () => {
    const call = vi.fn(async () => ({
      ok: true as const,
      data: { items: [
        { key: a.key, title: 'Главный рычаг: больше заявок', description: 'Начните с привлечения — остальные рычаги упрутся в него.' },
        { key: b.key, title: 'Поднять конверсию до 87%', description: 'Скрипты продаж и контроль воронки.' },
        { key: 'not-a-node-key', title: 'Лишнее', description: null },
      ] },
      usage: { model: 'test-model', tier: 'standard' as const, tokensIn: 1, tokensOut: 1, costUsd: 0.001, costSource: 'estimate' as never, latencyMs: 5, attempts: 1 },
    }))
    const r = await wordStrategyWithAi({ strategy: tree, context: ctx, actorId: 'aaaaaaaa-0000-4000-8000-000000000001', call: call as never })
    expect(r.reworded).toBe(1)
    expect(r.strategy.items[0].title).toBe('Главный рычаг: больше заявок')
    expect(r.strategy.items[1]).toEqual(b) // kept as the rules wrote it
    expect(r.warnings.join(' ')).toMatch(/число не из данных \(87\)/)
    expect(r.strategy.items).toHaveLength(tree.items.length)
    expect(r.strategy.items.map((n) => n.key)).toEqual(tree.items.map((n) => n.key))
    expect(validateStrategy(r.strategy).ok).toBe(true)
    // the prompt carries the data and the nodes; the usage is recorded under the strategy feature
    expect((call.mock.calls[0] as unknown[])[0]).toMatchObject({ label: 'point-b:strategy-draft' })
    expect(s.usage).toEqual([expect.objectContaining({ feature: 'point_b_strategy', ok: true })])
  })

  it('no key → the rules as they are with «no_api_key»; a refused budget → «budget_exceeded»; a gateway failure → its code; no retry', async () => {
    expect(await wordStrategyWithAi({ strategy: tree, context: ctx, actorId: 'x' })).toMatchObject({ strategy: tree, warnings: ['no_api_key'], reworded: 0 })
    s.budget = new Error('budget')
    const call = vi.fn()
    expect(await wordStrategyWithAi({ strategy: tree, context: ctx, actorId: 'x', call: call as never })).toMatchObject({ warnings: ['budget_exceeded'] })
    expect(call).not.toHaveBeenCalled()
    s.budget = null
    const failing = vi.fn(async () => ({ ok: false as const, error: 'TIMEOUT' as const, message: 'slow', usage: null }))
    expect(await wordStrategyWithAi({ strategy: tree, context: ctx, actorId: 'x', call: failing as never })).toMatchObject({ strategy: tree, warnings: ['timeout'] })
    expect(failing).toHaveBeenCalledTimes(1)
  })
})

// ── S1: the honest state of the plan and «клиент ждёт план» ──────────────

describe('planPrepState / isWaitingForPlan (S1, without the SLA)', () => {
  const ready = fixtureModelResult('full')
  const none = fixtureModelResult('no-goal')

  it('published > a draft (the team works) > in review > waiting (data enough, nobody started) > needs data', () => {
    expect(planPrepState({ published: true, open: { status: 'draft', createdAt: 'x', submittedAt: null }, result: ready }).kind).toBe('published')
    expect(planPrepState({ published: false, open: { status: 'draft', createdAt: '2026-11-14T00:00:00Z', submittedAt: null }, result: ready }))
      .toEqual({ kind: 'in_work', missing: [], since: '2026-11-14T00:00:00Z' })
    expect(planPrepState({ published: false, open: { status: 'in_review', createdAt: 'a', submittedAt: 'b' }, result: ready })).toEqual({ kind: 'in_review', missing: [], since: 'b' })
    const waiting = planPrepState({ published: false, open: null, result: ready })
    expect(waiting).toEqual({ kind: 'waiting', missing: [], since: null })
    expect(isWaitingForPlan(waiting)).toBe(true)
    const needs = planPrepState({ published: false, open: null, result: none })
    expect(needs.kind).toBe('needs_data')
    expect(needs.missing.map((m) => m.key)).toContain('goal')
    expect(isWaitingForPlan(needs)).toBe(false)
    // level 1 but no scenarios (a goal whose deadline has passed): still «нужны данные», with a fallback item
    expect(planPrepState({ published: false, open: null, result: { ...ready, scenarios: [], missing: [] } }).missing).toHaveLength(1)
  })

  it('listClientsWaitingForPlan: a goal, Point B access, no approved / open version, the model can plan; oldest goal first', async () => {
    const C1 = 'c1', C2 = 'c2', C3 = 'c3', C4 = 'c4', C5 = 'c5'
    const h = pbDb({
      companies: [
        { id: 'co1', user_id: C1, target_revenue_12m_kzt: null, target_revenue_3y_kzt: null, createdAt: '2026-01-01T00:00:00Z' },
        { id: 'co2', user_id: C2, target_revenue_12m_kzt: 100, target_revenue_3y_kzt: null, createdAt: '2026-02-01T00:00:00Z' },
        { id: 'co3', user_id: C3, target_revenue_12m_kzt: null, target_revenue_3y_kzt: null, createdAt: '2026-01-01T00:00:00Z' },
        { id: 'co4', user_id: C4, target_revenue_12m_kzt: null, target_revenue_3y_kzt: null, createdAt: '2026-01-01T00:00:00Z' },
        { id: 'co5', user_id: C5, target_revenue_12m_kzt: null, target_revenue_3y_kzt: null, createdAt: '2026-01-01T00:00:00Z' },
      ],
      metric_targets: [
        { id: 't1', company_id: 'co1', metric_key: 'biz.finansy.vyruchka_god', period_label: '12m', target_value: 1, created_at: '2026-03-01T00:00:00Z' },
        { id: 't3', company_id: 'co3', metric_key: 'biz.finansy.vyruchka_god', period_label: '12m', target_value: 1, created_at: '2026-01-05T00:00:00Z' },
        { id: 't4', company_id: 'co4', metric_key: 'biz.finansy.vyruchka_god', period_label: '12m', target_value: 1, created_at: '2026-01-06T00:00:00Z' },
        { id: 't5', company_id: 'co5', metric_key: 'biz.finansy.vyruchka_god', period_label: '12m', target_value: 1, created_at: '2026-01-07T00:00:00Z' },
      ],
      pb_plans: [
        { id: 'p3', company_id: 'co3', user_id: C3, published_version_id: 'v3' },
        { id: 'p4', company_id: 'co4', user_id: C4, published_version_id: null },
      ],
      pb_plan_versions: [{ id: 'v4', plan_id: 'p4', version: 1, status: 'draft' }],
    })
    const model = vi.fn(async (_u: string, companyId: string) => (companyId === 'co5' ? none : ready))
    const r = await listClientsWaitingForPlan(h.sb, { now: NOW, hasAccess: async () => true, model })
    // co3 has an approved plan, co4 a draft in the works, co5 lacks data: only co1 and co2 wait — oldest goal first
    // (co2's goal lives in the companies columns of the survey: it counts from the company's creation)
    expect(r.waiting.map((w) => w.companyId)).toEqual(['co2', 'co1'])
    expect(r.waiting[1]).toEqual({ companyId: 'co1', userId: C1, since: '2026-03-01T00:00:00Z' })
    expect(r).toMatchObject({ checked: 3, truncated: false })
    // no access (Free) → never in the queue; the limit truncates
    expect((await listClientsWaitingForPlan(h.sb, { now: NOW, hasAccess: async (u) => u === C1, model })).waiting.map((w) => w.userId)).toEqual([C1])
    expect(await listClientsWaitingForPlan(h.sb, { now: NOW, hasAccess: async () => true, model, limit: 1 })).toMatchObject({ checked: 1, truncated: true })
    // R3-SLA (152): why the checked ones do not wait — the pass closes their plan_prep tasks; every candidate is listed
    expect(r.dropped).toEqual([{ companyId: 'co5', userId: C5, reason: 'needs_data' }])
    expect([...r.candidates].sort()).toEqual(['co1', 'co2', 'co5'])
    const free = await listClientsWaitingForPlan(h.sb, { now: NOW, hasAccess: async (u) => u !== C2, model })
    expect(free.dropped).toContainEqual({ companyId: 'co2', userId: C2, reason: 'no_access' })
    // a model that failed: neither waiting nor dropped (an open task stays as it is)
    const broken = await listClientsWaitingForPlan(h.sb, { now: NOW, hasAccess: async () => true, model: async (_u, c) => { if (c === 'co1') throw new Error('x'); return ready } })
    expect(broken.dropped.map((d) => d.companyId)).not.toContain('co1')
    expect(broken.waiting.map((w) => w.companyId)).not.toContain('co1')
  })
})

describe('planPrep wording (client) — never «эксперт готовит» when nobody does', () => {
  it('parses the server state and words every kind; unknown → nothing', () => {
    expect(parsePlanPrep({ kind: 'nonsense' })).toBeNull()
    expect(parsePlanPrep(null)).toBeNull()
    const p = parsePlanPrep({ kind: 'needs_data', missing: [{ key: 'goal', label: 'Цель', actions: ['survey', 'hack'] }, { key: 'x' }], since: null })!
    expect(p.missing).toEqual([{ key: 'goal', label: 'Цель', actions: ['survey'] }])
    expect(planPrepView(null, 'banner')).toBeNull()
    expect(planPrepView({ kind: 'published', missing: [], since: null }, 'banner')).toBeNull()
    for (const kind of ['in_work', 'in_review', 'waiting', 'needs_data'] as const) {
      const v = planPrepView({ kind, missing: [], since: null }, 'scenarios')!
      expect(`${v.title} ${v.text}`).not.toMatch(/Эксперт готовит|ничего не требуется/)
    }
    expect(planPrepView({ kind: 'in_work', missing: [], since: null }, 'history')!.text).toMatch(/Сверка «план — факт» по месяцам появятся/)
  })
})

// ── M2: revenue by month ────────────────────────────────────────────────

describe('«Выручка по месяцам» (M2)', () => {
  it('the table is the last 24 FINISHED months; the current month and older months are refused', () => {
    const periods = revenueHistoryPeriods(NOW)
    expect(periods).toHaveLength(24)
    expect(periods[0]).toBe('2024-11')
    expect(periods[23]).toBe('2026-10')
    expect(validateRevenueHistory({ months: [{ period: '2026-10', revenue: '1 250 000,5' }, { period: '2026-09', revenue: null }] }, NOW))
      .toEqual([{ period: '2026-10', revenue: 1250000.5 }, { period: '2026-09', revenue: null }])
    const bad = (body: unknown) => { try { validateRevenueHistory(body, NOW); return null } catch (e) { return e instanceof RevenueHistoryError ? e.field : 'other' } }
    expect(bad({ months: [{ period: '2026-11', revenue: 1 }] })).toBe('months[0].period') // the current month is not over
    expect(bad({ months: [{ period: '2024-10', revenue: 1 }] })).toBe('months[0].period') // older than 24 months
    expect(bad({ months: [{ period: '2026-10', revenue: -5 }] })).toBe('months[0].revenue')
    expect(bad({ months: [{ period: '2026-10', revenue: 'много' }] })).toBe('months[0].revenue')
    expect(bad({ months: [{ period: '2026-10', revenue: 1 }, { period: '2026-10', revenue: 2 }] })).toBe('months[1].period')
    expect(bad({ months: [] })).toBe('months')
    expect(bad(null)).toBe('months')
  })

  it('the table: the owner / reconciliation month wins over the documents; the run counts months in a row; a stale run is said', () => {
    const periods = revenueHistoryPeriods(NOW)
    const stored = periods.slice(-12).map((period) => ({ period, value: '5000000', source: 'revenue_history' }))
    stored[11] = { period: periods[23], value: '7000000', source: 'monthly_reconciliation' }
    const t = revenueTableFrom(NOW, stored, [{ period: periods[23], revenue: 1 }, { period: periods[0], revenue: 3_000_000 }])
    expect(t.months[23]).toEqual({ period: '2026-10', revenue: 7_000_000, source: 'reconciliation' })
    expect(t.months[0]).toEqual({ period: '2024-11', revenue: 3_000_000, source: 'data' })
    expect(t.months[12].source).toBe('owner')
    expect(t).toMatchObject({ run: 12, needed: 0, stale: false, minMonths: 12 })
    const gap = revenueTableFrom(NOW, stored.filter((r) => r.period !== periods[18]), [])
    expect(gap).toMatchObject({ run: 5, needed: 7 })
    const old = revenueTableFrom(NOW, periods.slice(0, 12).map((period) => ({ period, value: 1, source: 'revenue_history' })), [])
    expect(old).toMatchObject({ run: 12, stale: true })
  })

  it('ONE history for the model: the owner / reconciliation months win over the data layer; `monthly: false` = data layer only', async () => {
    const h = pbDb({
      metric_facts: [
        { company_id: 'co', metric_key: 'biz.finansy.vyruchka_god', period_key: '2026-08', value: 60_000_000, source_kind: 'document', flags: ['rescaled'], confidence: 0.8 },
        { company_id: 'co', metric_key: 'biz.finansy.vyruchka_god', period_key: '2026-09', value: 4_000_000, source_kind: 'integration', flags: [], confidence: 0.9 },
        { company_id: 'co', metric_key: 'biz.finansy.vyruchka_god', period_key: '2025', value: 50_000_000, source_kind: 'survey', flags: [], confidence: 0.5 },
      ],
      pb_monthly_facts: [
        { company_id: 'co', period: '2026-09', metric: 'revenue', value: 4_500_000, source: 'revenue_history', entered_role: 'owner' },
        { company_id: 'co', period: '2026-10', metric: 'revenue', value: 4_700_000, source: 'monthly_reconciliation', entered_role: 'owner' },
        { company_id: 'co', period: '2026-10', metric: 'leads', value: 300, source: 'monthly_reconciliation', entered_role: 'owner' },
      ],
    })
    expect(await loadRevenueHistory(h.sb, 'co')).toEqual([
      { period: '2026-08', revenue: 5_000_000 }, { period: '2026-09', revenue: 4_500_000 }, { period: '2026-10', revenue: 4_700_000 },
    ])
    expect(await loadRevenueHistory(h.sb, 'co', { monthly: false })).toEqual([{ period: '2026-08', revenue: 5_000_000 }, { period: '2026-09', revenue: 4_000_000 }])
    expect(mergeMonthly([{ period: '2026-01', revenue: 1 }], [{ period: '2025-12', revenue: 2 }])).toEqual([{ period: '2025-12', revenue: 2 }, { period: '2026-01', revenue: 1 }])
  })

  it('the client controller: loads, sends only the changed months (an emptied one as null), shows the server field error, reloads the page', async () => {
    const periods = revenueHistoryPeriods(NOW)
    const table = (rev: Record<string, number>) => ({ ok: true, data: { months: periods.map((p) => ({ period: p, revenue: rev[p] ?? null, source: rev[p] ? 'owner' : null })), run: Object.keys(rev).length, needed: 12 - Object.keys(rev).length, stale: false, minMonths: 12 } })
    const puts: unknown[] = []
    let answer: { status: number; body: unknown } = { status: 200, body: table({ '2026-10': 5_000_000, '2026-09': 4_000_000 }) }
    const fetchFn = vi.fn(async (_u: string, init?: RequestInit) => {
      if (init?.method === 'PUT') { puts.push(JSON.parse(String(init.body))); return { ok: answer.status < 400, status: answer.status, json: async () => answer.body } }
      return { ok: true, status: 200, json: async () => table({ '2026-10': 4_000_000, '2026-08': 3_000_000 }) }
    })
    const onSaved = vi.fn()
    const ctl = new RevenueHistoryController(fetchFn as unknown as typeof fetch, { onSaved })
    await ctl.load()
    expect(ctl.getSnapshot()).toMatchObject({ phase: 'ready', run: 2 })
    expect(ctl.getSnapshot().rows.find((r) => r.period === '2026-10')!.text).toBe('4 000 000')
    ctl.setValue('2026-10', '5 000 000')
    ctl.setValue('2026-09', '4000000')
    ctl.setValue('2026-08', '')
    ctl.setValue('2026-07', '')
    expect(await ctl.save()).toBe(true)
    expect(puts).toEqual([{ months: [{ period: '2026-08', revenue: null }, { period: '2026-09', revenue: 4_000_000 }, { period: '2026-10', revenue: 5_000_000 }] }])
    expect(onSaved).toHaveBeenCalledTimes(1)
    expect(ctl.getSnapshot().message).toMatch(/Сохранено/)

    ctl.setValue('2026-06', 'десять')
    expect(await ctl.save()).toBe(false)
    expect(ctl.getSnapshot()).toMatchObject({ field: '2026-06' })
    ctl.setValue('2026-06', '100')
    answer = { status: 400, body: { ok: false, error: 'Выручка за месяц — число в тенге, не меньше нуля', field: 'months[0].revenue' } }
    expect(await ctl.save()).toBe(false)
    expect(ctl.getSnapshot()).toMatchObject({ field: '2026-06', error: 'Выручка за месяц — число в тенге, не меньше нуля' })
    expect(onSaved).toHaveBeenCalledTimes(1)
  })

  it('amount parsing and the run text', () => {
    expect(parseAmount('1 250 000')).toBe(1_250_000)
    expect(parseAmount('')).toBeNull()
    expect(Number.isNaN(parseAmount('1e6') as number)).toBe(true)
    expect(changedMonths([{ period: '2026-10', label: '', text: '-1', original: null, source: null }]).invalid).toBe('2026-10')
    expect(runText({ run: 12, needed: 0, stale: false, minMonths: 12 })).toMatch(/достаточно для прогноза/)
    expect(runText({ run: 5, needed: 7, stale: false, minMonths: 12 })).toMatch(/5 из 12.*ещё 7/)
  })
})

// ── M3: one report ──────────────────────────────────────────────────────

describe('pointBReportFrom — one calculation for the PDF, the share link and the chat (M3)', () => {
  const r = fixtureModelResult('full')
  const strategy = {
    items: [
      { key: 'k-strategy-1', kind: 'strategy', parentKey: null, title: 'Больше заявок', description: 'Рычаг', order: 0 },
      { key: 'k-init-0001', kind: 'initiative', parentKey: 'k-strategy-1', title: 'Новый канал', description: null, order: 1 },
      { key: 'k-task-0001', kind: 'task', parentKey: 'k-init-0001', title: 'Запустить', description: null, order: 2 },
      { key: 'k-task-0002', kind: 'task', parentKey: 'k-init-0001', title: 'Замерить', description: null, order: 3 },
    ],
    milestones: [{ key: 'm-1', title: 'Сверка', date: '2027-02-15', description: null, kpi: null }],
    progress: {}, matrix: { points: [], unrated: 0 },
  }
  const state = (published: boolean): PointBState => ({
    access: 'ok',
    overview: { result: { ...r, scenarios: [] }, labelledAutomatic: true },
    finmodel: { complete: false, missing: [], defaulted: [] },
    plan: {
      status: published ? 'published' : 'preparing', version: published ? 2 : null, selectedScenario: published ? 'moderate' : null,
      scenarios: published ? r.scenarios : [], approvedAt: published ? '2026-11-01T00:00:00Z' : null, authorName: published ? 'Админ' : null,
      strategy: published ? (strategy as never) : null,
      prep: published ? { kind: 'published', missing: [], since: null } : { kind: 'in_work', missing: [], since: null },
    },
    recommendations: {
      verified: [
        { id: 'r1', kind: 'lever', title: 'Проверенная', nextAction: 'Сделать', state: 'verified' } as never,
        { id: 'r2', kind: 'lever', title: 'Устаревшая', nextAction: null, state: 'stale' } as never,
      ],
      pendingCount: 3,
    },
    invites: [], nextStep: null, planFact: null,
  })

  it('a published plan: the pace marked, the strategy with its initiatives and task counts, verified recommendations only', () => {
    const rep = pointBReportFrom(state(true))
    expect(rep).toMatchObject({ automatic: true, level: r.level, gap: { baseAnnual: r.gap.baseAnnual, targetAnnual: r.gap.targetAnnual } })
    expect(rep.plan).toMatchObject({ status: 'published', prep: 'published', version: 2, selectedScenario: 'moderate' })
    expect(rep.plan.scenarios.filter((x) => x.selected).map((x) => x.key)).toEqual(['moderate'])
    expect(rep.plan.strategy).toEqual([{ title: 'Больше заявок', description: 'Рычаг', initiatives: ['Новый канал'], tasks: 2 }])
    expect(rep.plan.milestones).toEqual([{ title: 'Сверка', date: '2027-02-15' }])
    expect(rep.recommendations).toEqual([{ title: 'Проверенная', kind: 'lever', nextAction: 'Сделать' }])
    const text = pointBReportText(rep)
    expect(text).toMatch(/План v2 одобрен 2026-11-01/)
    expect(text).toMatch(/Сценарий «Умеренный» \(выбран\)/)
    expect(text).not.toMatch(/NaN|undefined/)
  })

  it('before the approval: no scenarios, no strategy — the honest state of the plan', () => {
    const rep = pointBReportFrom(state(false))
    expect(rep.plan).toMatchObject({ status: 'preparing', prep: 'in_work', scenarios: [], strategy: [] })
    expect(pointBReportText(rep)).toMatch(/План: План готовит команда AIStart360/)
  })
})

describe('the staff notice of «Собрать черновик плана»', () => {
  it('says what was built and every warning', () => {
    const t = quickDraftNotice({ ok: true, data: { created: true, scenarios: 3, selectedScenario: 'moderate', strategy: { filled: true, strategies: 3, initiatives: 4, tasks: 6 }, recommendations: { created: 2 }, warnings: ['ИИ не подключён'] } })
    expect(t).toBe('Черновик собран: сценариев — 3, темп — умеренный; стратегия — направлений 3, инициатив 4, задач 6; рекомендаций на проверку — 2. Проверьте цель и стратегию, затем отправьте на одобрение. ИИ не подключён')
    expect(quickDraftNotice({ ok: true, data: { created: false, strategy: { filled: false } } })).toMatch(/^Черновик дополнен: сценариев — 0, темп — не выбран; стратегия не менялась/)
  })
})
