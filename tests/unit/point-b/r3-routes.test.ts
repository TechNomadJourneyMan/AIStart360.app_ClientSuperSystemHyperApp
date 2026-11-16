/**
 * R3-PB routes and consumers:
 *   GET / PUT /api/v1/point-b/revenue-history (M2) — the session's own company only, Pro gate, read-only «от имени»,
 *     validation with the field, the table back;
 *   the PDF of Точка Б renders the report of the page (M3) — before and after the approval;
 *   the chat tool get_point_b answers from the same report, never from the V2 snapshot (M3).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

const CLIENT = 'cccccccc-0000-4000-8000-000000000001'
const OTHER = 'cccccccc-0000-4000-8000-000000000002'
const s = vi.hoisted(() => ({
  h: null as ReturnType<typeof import('./_pbdb').pbDb> | null,
  user: null as { id: string } | null,
  gate402: false,
  impersonating: false,
  limited: false,
}))

vi.mock('@/lib/supabase-service', () => ({ createServiceClient: () => s.h!.sb }))
vi.mock('@/lib/supabase-server', () => ({
  createServerClient: () => ({ auth: { getUser: async () => ({ data: { user: s.user } }) }, from: (t: string) => s.h!.sb.from(t) }),
}))
vi.mock('@/lib/access/gate', () => ({
  gateFeature: async () => (s.gate402 ? NextResponse.json({ ok: false, error: 'upgrade_required' }, { status: 402 }) : null),
}))
vi.mock('@/lib/impersonation/server', () => ({ activeImpersonation: async () => (s.impersonating ? { id: 'imp' } : null) }))
vi.mock('@/lib/rate-limit', () => ({ isRateLimitedKey: async () => s.limited }))
vi.mock('@/lib/events/platform', () => ({ emitPlatformEventSafely: () => undefined }))

const { pbDb } = await import('./_pbdb')
const route = await import('@/app/api/v1/point-b/revenue-history/route')
const { revenueHistoryPeriods } = await import('@/lib/point-b/finmodel/revenue-history')

const json = async (r: Response) => ({ status: r.status, body: await r.json() })
const put = (b: unknown) => new NextRequest('http://t/api/v1/point-b/revenue-history', { method: 'PUT', body: JSON.stringify(b), headers: { 'content-type': 'application/json' } })

function seed() {
  return pbDb({
    companies: [
      { id: 'co-1', user_id: CLIENT, name: 'Ромашка', createdAt: '2026-01-01T00:00:00Z' },
      { id: 'co-2', user_id: OTHER, name: 'Лютик', createdAt: '2026-01-01T00:00:00Z' },
    ],
    pb_monthly_facts: [{ company_id: 'co-2', period: revenueHistoryPeriods(new Date())[23], metric: 'revenue', value: 9, source: 'revenue_history', entered_role: 'owner' }],
    metric_facts: [],
  })
}

beforeEach(() => {
  s.h = seed()
  s.user = { id: CLIENT }
  s.gate402 = false
  s.impersonating = false
  s.limited = false
})

describe('/api/v1/point-b/revenue-history (R3, M2)', () => {
  it('GET: 401 without a session, 402 for a Free client, the 24 months of the OWN company otherwise', async () => {
    s.user = null
    expect((await json(await route.GET())).status).toBe(401)
    s.user = { id: CLIENT }
    s.gate402 = true
    expect((await json(await route.GET())).status).toBe(402)
    s.gate402 = false
    const r = await json(await route.GET())
    expect(r.status).toBe(200)
    expect(r.body.data.months).toHaveLength(24)
    expect(r.body.data.months.every((m: { revenue: unknown }) => m.revenue === null)).toBe(true) // not the other company's month
    expect(r.body.data).toMatchObject({ run: 0, needed: 12, minMonths: 12 })
  })

  it('PUT saves the owner\'s months (source revenue_history), clears with null, answers the new table', async () => {
    const periods = revenueHistoryPeriods(new Date())
    const months = periods.slice(-12).map((period) => ({ period, revenue: '4 000 000' }))
    const r = await json(await route.PUT(put({ months })))
    expect(r.status, JSON.stringify(r.body)).toBe(200)
    expect(r.body.data).toMatchObject({ run: 12, needed: 0 })
    const mine = s.h!.db.pb_monthly_facts.filter((x) => x.company_id === 'co-1')
    expect(mine).toHaveLength(12)
    expect(mine.every((x) => x.source === 'revenue_history' && x.entered_role === 'owner' && x.entered_by === CLIENT && Number(x.value) === 4_000_000)).toBe(true)
    const cleared = await json(await route.PUT(put({ months: [{ period: periods[23], revenue: null }] })))
    expect(cleared.body.data).toMatchObject({ run: 11, needed: 1 }) // the run now ends at the month before
    expect(s.h!.db.pb_monthly_facts.filter((x) => x.company_id === 'co-1')).toHaveLength(11)
    // the other company's month is untouched
    expect(s.h!.db.pb_monthly_facts.filter((x) => x.company_id === 'co-2')).toHaveLength(1)
  })

  it('R3-PB review M1: a month reconciled through «Факт за месяц» is not changed or cleared from the table (400 with the field)', async () => {
    const P = revenueHistoryPeriods(new Date())[23]
    s.h!.db.pb_monthly_facts.push({ company_id: 'co-1', period: P, metric: 'revenue', value: 7_000_000, source: 'monthly_reconciliation', entered_role: 'expert' })
    for (const revenue of [1_000_000, null]) {
      const r = await json(await route.PUT(put({ months: [{ period: P, revenue }] })))
      expect(r.status).toBe(400)
      expect(r.body).toMatchObject({ code: 'invalid', field: 'months[0].revenue' })
      expect(r.body.error).toMatch(/Факт за месяц/)
    }
    expect(s.h!.db.pb_monthly_facts.find((x) => x.company_id === 'co-1' && x.period === P)).toMatchObject({ value: 7_000_000, entered_role: 'expert' })
    // the table shows it as the reconciliation's month
    const g = await json(await route.GET())
    expect(g.body.data.months.find((m: { period: string }) => m.period === P)).toEqual({ period: P, revenue: 7_000_000, source: 'reconciliation' })
  })

  it('PUT: 400 with the field, 403 «от имени», 402 Free, 429 the limit — nothing written', async () => {
    const bad = await json(await route.PUT(put({ months: [{ period: '2020-01', revenue: 1 }] })))
    expect(bad.status).toBe(400)
    expect(bad.body).toMatchObject({ code: 'invalid', field: 'months[0].period' })
    s.impersonating = true
    expect((await json(await route.PUT(put({ months: [] })))).status).toBe(403)
    s.impersonating = false
    s.gate402 = true
    expect((await json(await route.PUT(put({ months: [] })))).status).toBe(402)
    s.gate402 = false
    s.limited = true
    expect((await json(await route.PUT(put({ months: [] })))).status).toBe(429)
    expect(s.h!.db.pb_monthly_facts.filter((x) => x.company_id === 'co-1')).toHaveLength(0)
  })
})

describe('the PDF of Точка Б renders the report of the page (R3, M3)', () => {
  it('a published plan and a plan in the works both render a PDF (no V2 field needed)', async () => {
    const { renderPointBPdf } = await import('@/lib/reports/pdf')
    const report = {
      computedAt: '2026-11-15T00:00:00Z', level: 1 as const, kind: 'funnel' as const, automatic: true as const,
      verdict: { key: 'at_risk' as const, headline: 'Есть риск не дойти до цели', reason: 'При текущем ходе — 82% цели.' },
      gap: { baseAnnual: 60_000_000, targetAnnual: 120_000_000, absolute: 60_000_000, multiplier: 2, requiredCagrPct: 100, months: 12 },
      forecast: { atCurrentPace: 98_000_000, trendMonthlyPct: 4.1, basis: 'history' as const },
      missing: ['Повторные покупки'],
      plan: {
        status: 'published' as const, prep: 'published' as const, prepMissing: [] as string[], version: 1, approvedAt: '2026-11-10T00:00:00Z', authorName: 'Админ', selectedScenario: 'moderate',
        scenarios: [
          { key: 'cautious', label: 'Осторожный', selected: false, feasible: true, infeasibleReason: null, timeToGoalMonths: 18, revenueAtDeadline: 100_000_000, levers: [] },
          { key: 'moderate', label: 'Умеренный', selected: true, feasible: true, infeasibleReason: null, timeToGoalMonths: 12, revenueAtDeadline: 120_000_000, levers: [] },
          { key: 'aggressive', label: 'Ускоренный', selected: false, feasible: false, infeasibleReason: 'Лиды выше потолка', timeToGoalMonths: null, revenueAtDeadline: null, levers: [] },
        ],
        strategy: [{ title: 'Больше заявок', description: 'Рычаг', initiatives: ['Новый канал'], tasks: 2 }],
        milestones: [{ title: 'Сверка', date: '2027-02-15' }],
      },
      recommendations: [{ title: 'Проверенная', kind: 'lever', nextAction: 'Сделать' }],
    }
    const meta = { companyName: 'Ромашка' }
    const pdf = await renderPointBPdf({ meta, report })
    expect(pdf.subarray(0, 4).toString()).toBe('%PDF')
    const draft = await renderPointBPdf({ meta, report: { ...report, plan: { ...report.plan, status: 'preparing', prep: 'in_work', scenarios: [], strategy: [], milestones: [] } } })
    expect(draft.subarray(0, 4).toString()).toBe('%PDF')
  }, 30_000)
})

describe('the chat tool get_point_b (R3, M3)', () => {
  it('answers from the page report of the company owner, never from the V2 snapshot of point_b_analysis', async () => {
    const report = await import('@/lib/point-b/report')
    const spy = vi.spyOn(report, 'loadPointBReport')
    s.h = pbDb({
      companies: [{ id: 'co-1', user_id: CLIENT, name: 'Ромашка', createdAt: '2026-01-01T00:00:00Z' }],
      point_b_analysis: [{ diagnostic_id: 'd', is_current: true, roadmap: { gap: 'V2-MARK' } }],
    })
    const { toolsFor } = await import('@/lib/chat/tools')
    const tool = toolsFor(false).find((t) => t.name === 'get_point_b')!
    const out = await tool.run({}, { companyId: 'co-1', userId: CLIENT, ownerId: CLIENT, sb: s.h.sb, canManage: false, now: new Date('2026-11-15T00:00:00Z'), propose: async () => 'x' }) as Record<string, unknown>
    expect(JSON.stringify(out)).not.toContain('V2-MARK')
    expect(out).toMatchObject({ level: 0, plan: { status: 'none' } })
    expect(String(out.summary)).toMatch(/Автоматический расчёт Точки Б/)
    expect(spy).toHaveBeenCalled()
    // another company of the same owner has no Point B of its own: nothing is mixed in
    const other = await tool.run({}, { companyId: 'co-x', userId: CLIENT, ownerId: CLIENT, sb: s.h.sb, canManage: false, now: new Date(), propose: async () => 'x' })
    expect(other).toEqual({ status: 'not_calculated' })
  })
})
