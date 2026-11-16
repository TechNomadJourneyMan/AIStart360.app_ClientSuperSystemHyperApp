/**
 * R3-PB — the fixes of the independent review (~/.a360-test/reports/R3-PB-REVIEW.md):
 *   M2  the chat tool get_point_b follows the rule of RLS: the owner and staff in scope — a member of the company gets
 *       «no_access»;
 *   M3  the smart assistant (and the mascot, which reads the same snapshot) takes Point B from the model and the approved
 *       plan — the same numbers as «Обзор», not V2;
 *   L3–L5, L7  revenue months: > 0, strict numbers, the Almaty month; the PDF / share «нужны данные» list.
 * In-memory DB of the plan tests (tests/unit/point-b/_pbdb.ts); the clock is fixed.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const CLIENT = 'cccccccc-0000-4000-8000-000000000001'
const MEMBER = 'cccccccc-0000-4000-8000-000000000009'
const STAFF = 'aaaaaaaa-0000-4000-8000-000000000001'
const COMPANY = 'company-1'
const REVENUE = 'biz.finansy.vyruchka_god'
const NOW = new Date('2026-10-18T09:00:00Z')

const s = vi.hoisted(() => ({ h: null as ReturnType<typeof import('./_pbdb').pbDb> | null, staff: [] as string[] }))
vi.mock('@/lib/supabase-service', () => ({ createServiceClient: () => s.h!.sb }))
vi.mock('@/lib/events/platform', () => ({ emitPlatformEventSafely: () => undefined }))
vi.mock('@/lib/api-identity', async (orig) => ({
  ...(await orig<typeof import('@/lib/api-identity')>()),
  // self, or staff in scope (the real rule needs the session and the second factor)
  mayActOnUser: async (_sb: unknown, caller: string, target: string) => caller === target || s.staff.includes(caller),
}))

const { pbDb } = await import('./_pbdb')
const { toolsFor } = await import('@/lib/chat/tools')
const { loadPointBState } = await import('@/lib/point-b/model/load')
const { loadPointBReport, pointBReportFrom, pointBReportText } = await import('@/lib/point-b/report')
const { buildAssistantContext } = await import('@/lib/assistant/context')
const { ALL_SECTIONS_OPEN, ALL_SECTIONS_CLOSED } = await import('@/lib/assistant/paid-context')
const { assistantPointBFrom } = await import('@/lib/assistant/point-b')
const { serializeSnapshot } = await import('@/lib/assistant/answer')
const { validateRevenueHistory, revenueHistoryPeriods, parseAmount } = await import('@/lib/point-b/finmodel/revenue-history')
const { periodOf, lastFinishedPeriod } = await import('@/lib/point-b/planfact/kpis')
const { describeHistory } = await import('@/lib/point-b/model/forecast')
const { periodInAlmaty } = await import('@/lib/point-b/period')
const { changedMonths } = await import('@/components/point-b/revenueHistoryController')

const metric = (key: string, value: number) => ({ company_id: COMPANY, metric_key: key, metric_value: value, source: 'survey', period_year: 2026, computed_at: '2026-10-01T00:00:00Z' })
const block = (score: number) => ({ score, status: 'average', top_issues: [], recommendations: [] })

function seed(over: Record<string, unknown[]> = {}) {
  return pbDb({
    companies: [{ id: COMPANY, user_id: CLIENT, name: 'Ромашка', industry: 'Интернет-магазин', stage: 'growth', employee_count: 12, target_revenue_12m_kzt: 120_000_000, target_revenue_3y_kzt: null, createdAt: '2026-01-01T00:00:00Z' }],
    profiles: [{ id: CLIENT, role: 'client', full_name: 'Клиент' }],
    metric_targets: [{
      id: 'mt-1', company_id: COMPANY, metric_key: REVENUE, period_label: '12m', target_value: 120_000_000, direction: 'higher_is_better',
      source: 'owner', deadline: null, label: null, note: null, baseline_value: 60_000_000, baseline_period: '2026', baseline_at: NOW.toISOString(), created_at: NOW.toISOString(),
    }],
    metrics: [metric(REVENUE, 60_000_000), metric('biz.marketing.lidov_v_mes', 300), metric('biz.marketing.konversiya_lid_klient', 12), metric('biz.prodazhi.sredniy_chek', 140_000)],
    diagnostics: [{
      id: 'diag-1', user_id: CLIENT, company_id: COMPANY, is_current: true, calculated_at: '2026-10-01T00:00:00Z', overall_score: 55, health_index: 50, stage: 'growth',
      finance_score: block(60), sales_score: block(45), operations_score: block(55), marketing_score: block(40), strategy_score: block(70),
    }],
    point_a_snapshots: [],
    survey_answers: [],
    gri_assessments: [{ user_id: CLIENT, is_current: true, gri_index: 5.5, top_5_limits: [{ rank: 1, title: 'Нет системы продаж', block: 'operations' }] }],
    point_b_versions: [],
    point_b_analysis: [{ diagnostic_id: 'diag-1', is_current: true, roadmap: { gap: 'V2-MARK' }, ai_strategy: { s: 'V2-AI' }, ai_status: 'completed' }],
    ...over,
  })
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  s.h = seed()
  s.staff = []
})
afterEach(() => { vi.useRealTimers() })

// ── M2: the chat follows the rule of RLS ────────────────────────────────

describe('get_point_b (review M2): the owner and staff in scope — a member of the company does not get the plan', () => {
  const tool = toolsFor(false).find((t) => t.name === 'get_point_b')!
  const ask = (userId: string) => tool.run({}, { companyId: COMPANY, userId, ownerId: CLIENT, sb: s.h!.sb, canManage: false, now: NOW, propose: async () => 'x' }) as Promise<Record<string, unknown>>

  it('the owner gets the model report; a member of the company gets «no_access»; staff in scope get the report', async () => {
    const owner = await ask(CLIENT)
    expect(owner).toMatchObject({ level: 1, gap: { baseAnnual: 60_000_000, targetAnnual: 120_000_000 } })
    expect(JSON.stringify(owner)).not.toMatch(/V2-MARK|V2-AI/)
    expect(await ask(MEMBER)).toEqual({ status: 'no_access' })
    s.staff = [STAFF]
    expect(await ask(STAFF)).toMatchObject({ level: 1 })
  })

  it('a company that is not the owner\'s (a wrong tenant) answers «not_calculated», nothing mixed in', async () => {
    const out = await tool.run({}, { companyId: 'company-x', userId: CLIENT, ownerId: CLIENT, sb: s.h!.sb, canManage: false, now: NOW, propose: async () => 'x' })
    expect(out).toEqual({ status: 'not_calculated' })
  })
})

// ── M3: the assistant and the mascot read the same numbers as «Обзор» ────

describe('the assistant snapshot (review M3): Точка Б from the model and the approved plan, the numbers of «Обзор»', () => {
  const build = (sections = ALL_SECTIONS_OPEN) => buildAssistantContext(CLIENT, s.h!.sb, {
    sections, pointBReport: (u, c) => loadPointBReport(s.h!.sb, u, { now: NOW, companyId: c }),
  })

  it('gap, required growth, base and the verdict are exactly the overview\'s; no V2 field is read', async () => {
    const state = await loadPointBState(s.h!.sb, CLIENT, { now: NOW })
    const r = state.overview.result
    const ctx = await build()
    expect(ctx.pointB.current_revenue_year).toBe(r.gap.baseAnnual)
    expect(ctx.pointB.gap.multiplier).toBe(r.gap.multiplier)
    expect(ctx.pointB.gap.required_cagr).toBe(r.gap.requiredCagrPct)
    expect(ctx.pointB.gap.data_complete).toBe(true)
    expect(ctx.pointB.realism).toMatchObject({ level: 'unknown', score: null }) // the verdict «нельзя сказать» (no monthly history)
    expect(ctx.pointB.realism.rationale[0]).toContain(r.verdict.headline)
    expect(ctx.pointB.data_sufficiency).toMatchObject({ sufficient: true, confidence: r.level / 2 })
    expect(ctx.pointB.data_sufficiency.missing).toEqual(r.missing.map((m) => m.label))
    // before the approval no lever of the automatic scenarios reaches the assistant (решение PO)
    expect(ctx.pointB.levers).toEqual([])
    expect(ctx.pointB.top5_limits).toEqual([{ rank: 1, title: 'Нет системы продаж', block: 'operations', severity: 'high' }])
    expect(JSON.stringify(ctx)).not.toMatch(/V2-MARK|V2-AI/)
    // the prompt of the assistant (and the mascot's snapshot) carries the same multiplier
    expect(serializeSnapshot(ctx, 'ru')).toContain(String(r.gap.multiplier))
    const { readFileSync } = await import('node:fs')
    expect(readFileSync('lib/assistant/context.ts', 'utf8')).not.toMatch(/calculatePointBV2/)
  })

  it('a closed Точка Б: no calculation at all, the honest empty slice (then scrubbed)', async () => {
    const report = vi.fn()
    const ctx = await buildAssistantContext(CLIENT, s.h!.sb, { sections: ALL_SECTIONS_CLOSED, pointBReport: report })
    expect(report).not.toHaveBeenCalled()
    expect(ctx.pointB.realism.level).toBe('locked')
  })

  it('the realism follows the overview verdict; an approved pace that cannot reach the goal is «unrealistic»; levers only of the approved pace', async () => {
    const state = await loadPointBState(s.h!.sb, CLIENT, { now: NOW })
    const base = pointBReportFrom(state)
    const x = { goal12m: 120_000_000, goal3y: null, griTop5: [], blocks: [{ label: 'Маркетинг', score: 40 }, { label: 'Финансы', score: 60 }] }
    for (const [key, level] of [['on_track', 'realistic'], ['at_risk', 'ambitious'], ['behind', 'aggressive'], ['no_data', 'unknown']] as const) {
      expect(assistantPointBFrom({ ...base, verdict: { ...base.verdict, key } }, x).realism.level).toBe(level)
    }
    expect(assistantPointBFrom(base, x).realism.weak_blocks).toEqual(['Маркетинг'])
    const published = {
      ...base,
      plan: {
        ...base.plan, status: 'published' as const, prep: 'published' as const, selectedScenario: 'moderate',
        scenarios: [{
          key: 'moderate', label: 'Умеренный', selected: true, feasible: false, infeasibleReason: 'Лиды выше потолка', timeToGoalMonths: null, revenueAtDeadline: null,
          levers: [{ lever: 'leads', label: 'Заявки в месяц', current: 300, target: 450, upliftPct: 50 }, { lever: 'growth', label: 'Рост', current: 0.1, target: 0.2, upliftPct: null }],
        }],
      },
    }
    const b = assistantPointBFrom(published, x)
    expect(b.realism.level).toBe('unrealistic')
    expect(b.realism.rationale[1]).toMatch(/Лиды выше потолка/)
    expect(b.levers).toEqual([{ key: 'leads', label: 'Заявки в месяц', expected_effect: '300 в месяц → 450 в месяц (темп плана «Умеренный»)', data_available: true }])
  })
})

// ── L3–L5: revenue months ──────────────────────────────────────────────

describe('revenue months (review L3–L5)', () => {
  it('a month is > 0 and a strict number on the server and in the form (no 0, no 1e5 / 0x1F)', () => {
    const now = new Date('2026-11-15T10:00:00Z')
    const fieldOf = (revenue: unknown) => { try { validateRevenueHistory({ months: [{ period: '2026-10', revenue }] }, now); return null } catch (e) { return (e as { field?: string }).field } }
    expect(fieldOf(0)).toBe('months[0].revenue')
    expect(fieldOf('0')).toBe('months[0].revenue')
    expect(fieldOf('1e5')).toBe('months[0].revenue')
    expect(fieldOf('0x1F')).toBe('months[0].revenue')
    expect(fieldOf('1 250 000,5')).toBeNull()
    expect(parseAmount('1e5')).toBeNaN()
    expect(changedMonths([{ period: '2026-10', label: '', text: '0', original: null, source: null }]).invalid).toBe('2026-10')
    // a month reconciled through «Факт за месяц» is never sent from the table
    expect(changedMonths([{ period: '2026-10', label: '', text: '5', original: 7, source: 'reconciliation' }])).toEqual({ months: [], invalid: null })
  })

  it('the month is the Almaty month: on 1 November 01:00 in Almaty (31 October 20:00 UTC) October is over', () => {
    const earlyNov = new Date('2026-10-31T20:00:00Z')
    expect(periodInAlmaty(earlyNov)).toBe('2026-11')
    expect(periodOf(earlyNov)).toBe('2026-11')
    expect(lastFinishedPeriod(earlyNov)).toBe('2026-10')
    expect(revenueHistoryPeriods(earlyNov).at(-1)).toBe('2026-10')
    expect(validateRevenueHistory({ months: [{ period: '2026-10', revenue: 1 }] }, earlyNov)).toEqual([{ period: '2026-10', revenue: 1 }])
    // the forecast counts the same month: October is 1 month ago, not 0
    expect(describeHistory([{ period: '2026-10', revenue: 1 }], earlyNov.toISOString()).lagMonths).toBe(1)
    // the last hours of a month in Almaty are still that month
    expect(periodOf(new Date('2026-11-30T18:30:00Z'))).toBe('2026-11')
  })
})

// ── L7: «нужны данные» says what ────────────────────────────────────────

describe('the report says what the plan needs (review L7)', () => {
  it('needs_data carries the list; the text names it; the PDF prints it under the sentence', async () => {
    s.h = seed({ metric_targets: [], companies: [{ id: COMPANY, user_id: CLIENT, name: 'Ромашка', target_revenue_12m_kzt: null, target_revenue_3y_kzt: null, createdAt: '2026-01-01T00:00:00Z' }] })
    const report = await loadPointBReport(s.h.sb, CLIENT, { now: NOW })
    expect(report.plan.prep).toBe('needs_data')
    expect(report.plan.prepMissing.length).toBeGreaterThan(0)
    expect(pointBReportText(report)).toContain(`Для плана нужны данные: ${report.plan.prepMissing.join(', ')}`)
    const { readFileSync } = await import('node:fs')
    const pdf = readFileSync('lib/reports/pdf.ts', 'utf8')
    expect(pdf).not.toMatch(/список ниже/)
    expect(pdf).toMatch(/r\.plan\.prepMissing/)
    const { renderPointBPdf } = await import('@/lib/reports/pdf')
    expect((await renderPointBPdf({ meta: { companyName: 'Ромашка' }, report })).subarray(0, 4).toString()).toBe('%PDF')
  }, 30_000)
})
