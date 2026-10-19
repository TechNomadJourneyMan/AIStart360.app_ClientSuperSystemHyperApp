/**
 * «Что если» routes (Point B plan Ф4, Task 3): POST /api/v1/point-b/whatif (calculate, writes nothing),
 * GET/POST …/saved, DELETE …/saved/:id, POST …/saved/:id/propose and the expert's read-only
 * GET /api/giga-admin/users/:id/point-b/whatif/saved. In-memory DB (Point B tables) + the in-memory DB of
 * lib/comm for the real recordInbound; the real store, model, engine and routes. The gates, the impersonation,
 * the rate limit and the audit are doubles. The clock is fixed at 2026-10-18.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'
import type { StaffRole } from '@/lib/admin/rbac'
import { commDb } from '../comm/_db'
import { pbDb } from './_pbdb'

const REVENUE = 'biz.finansy.vyruchka_god'
const CLIENT = 'cccccccc-0000-4000-8000-000000000001'
const OTHER_CLIENT = 'cccccccc-0000-4000-8000-000000000002'
const EXPERT = 'eeeeeeee-0000-4000-8000-000000000001'
const ADMIN = 'aaaaaaaa-0000-4000-8000-000000000001'
const COMPANY = 'company-1'
const OTHER_COMPANY = 'company-2'
const NOW = new Date('2026-10-18T09:00:00Z')

const s = vi.hoisted(() => ({
  h: null as ReturnType<typeof import('./_pbdb').pbDb> | null,
  comm: null as ReturnType<typeof import('../comm/_db').commDb> | null,
  actor: { id: 'x', role: 'admin' as StaffRole, scope: 'all' as 'all' | 'assigned' },
  user: null as { id: string } | null,
  impersonating: false,
  gate402: false,
  limited: false,
  breakInbound: false,
  limiterCalls: [] as Array<{ id: string; bucket: string; opts: unknown }>,
  gateCalls: [] as Array<{ userId: string; feature: string }>,
  notified: [] as unknown[],
}))

/** One service client over both doubles: comm_* tables go to the comm DB, everything else to the Point B DB. */
const router = () => ({
  from: (t: string) => {
    if (t.startsWith('comm_')) {
      if (s.breakInbound && t === 'comm_messages') throw new Error('comm down')
      return s.comm!.sb.from(t)
    }
    return s.h!.sb.from(t)
  },
  rpc: (fn: string, args: Record<string, unknown>) => s.comm!.sb.rpc(fn, args),
})

vi.mock('@/lib/supabase-service', () => ({ createServiceClient: () => router() }))
vi.mock('@/lib/supabase-server', () => ({
  createServerClient: () => ({ auth: { getUser: async () => ({ data: { user: s.user } }) }, from: (t: string) => s.h!.sb.from(t) }),
}))
vi.mock('@/lib/impersonation/server', () => ({ activeImpersonation: async () => (s.impersonating ? { sid: 'imp-1', uid: s.user?.id } : null) }))
vi.mock('@/lib/access/gate', () => ({
  gateFeature: async (_sb: unknown, userId: string, feature: string) => {
    s.gateCalls.push({ userId, feature })
    return s.gate402 ? NextResponse.json({ ok: false, error: 'upgrade_required', feature }, { status: 402 }) : null
  },
}))
vi.mock('@/lib/rate-limit', () => ({
  isRateLimitedKey: async (id: string, bucket: string, opts: unknown) => { s.limiterCalls.push({ id, bucket, opts }); return s.limited },
}))
vi.mock('@/lib/settings/store', () => ({
  getSetting: vi.fn(async (k: string) => (k === 'comm_escalation_minutes' ? 30 : k === 'comm_bot_auto_default' ? false : null)),
}))
vi.mock('@/lib/notifications/staff', () => ({ notifyStaff: vi.fn(async (n: unknown) => { s.notified.push(n); return { eventId: 'e', duplicate: false, deliveries: [] } }) }))
vi.mock('@/lib/telegram', () => ({ sendTelegramMessage: vi.fn(async () => true) }))
vi.mock('@/lib/events/platform', () => ({ emitPlatformEventSafely: () => undefined }))
vi.mock('@/lib/admin/audit', () => ({ recordAdminAction: async () => true }))
vi.mock('@/lib/admin/giga-actor', async () => {
  const { makeRequireGiga } = await import('../_giga-guard')
  const inner = makeRequireGiga(() => ({ id: s.actor.id, kind: 'session', role: s.actor.role }))
  return {
    requireGiga: async (req: unknown, p: Parameters<typeof inner>[1]) => {
      const g = await inner(req, p)
      return g.actor ? { actor: { ...g.actor, clientScope: s.actor.scope } } : g
    },
    forbidTarget: async () => null,
    staffMfaGate: async () => 'ok',
  }
})

const calcRoute = await import('@/app/api/v1/point-b/whatif/route')
const savedRoute = await import('@/app/api/v1/point-b/whatif/saved/route')
const itemRoute = await import('@/app/api/v1/point-b/whatif/saved/[id]/route')
const proposeRoute = await import('@/app/api/v1/point-b/whatif/saved/[id]/propose/route')
const expertRoute = await import('@/app/api/giga-admin/users/[id]/point-b/whatif/saved/route')
const { runWhatIf } = await import('@/lib/point-b/model/whatif')

const req = (method: string, b?: unknown) =>
  new NextRequest('http://t/api', { method, body: b === undefined ? undefined : JSON.stringify(b), headers: { 'content-type': 'application/json', origin: 'http://t' } })
const json = async (r: Response) => ({ status: r.status, body: await r.json() })
const as = (role: StaffRole, id = role === 'admin' ? ADMIN : EXPERT, scope: 'all' | 'assigned' = 'all') => { s.actor = { id, role, scope } }

const calc = async (b: unknown) => json(await calcRoute.POST(req('POST', b)))
const list = async () => json(await savedRoute.GET())
const save = async (b: unknown) => json(await savedRoute.POST(req('POST', b)))
const del = async (id: string) => json(await itemRoute.DELETE(req('DELETE'), { params: { id } }))
const propose = async (id: string, b?: unknown) => json(await proposeRoute.POST(req('POST', b ?? {}), { params: { id } }))
const expertList = async (id = CLIENT) => json(await expertRoute.GET(req('GET'), { params: { id } }))

const saved = () => s.h!.db.pb_saved_scenarios as Array<Record<string, unknown>>
const writesOf = (table: string) => s.h!.writes.filter((w) => w.table === table)

const metric = (key: string, value: number) => ({ company_id: COMPANY, metric_key: key, metric_value: value, source: 'survey', period_year: 2026, computed_at: '2026-10-01T00:00:00Z' })
const block = (score: number) => ({ score, status: 'average', top_issues: [], recommendations: [] })

function seed(rows: Array<Record<string, unknown>> = []) {
  return pbDb({
    companies: [
      { id: COMPANY, user_id: CLIENT, name: 'Ромашка', industry: 'Интернет-магазин', target_revenue_12m_kzt: null, target_revenue_3y_kzt: null, created_at: '2026-01-01T00:00:00Z' },
      { id: OTHER_COMPANY, user_id: OTHER_CLIENT, name: 'Лютик', industry: null, target_revenue_12m_kzt: null, target_revenue_3y_kzt: null, created_at: '2026-01-01T00:00:00Z' },
    ],
    profiles: [
      { id: CLIENT, role: 'client', full_name: 'Клиент Один', email: 'one@example.com' },
      { id: OTHER_CLIENT, role: 'client', full_name: 'Клиент Два', email: 'two@example.com' },
      { id: EXPERT, role: 'expert', full_name: 'Алия Эксперт' },
      { id: ADMIN, role: 'admin', full_name: 'Админ Главный' },
    ],
    user_assignments: [{ user_id: CLIENT, assignee_id: EXPERT }, { user_id: OTHER_CLIENT, assignee_id: 'someone-else' }],
    metric_targets: [{
      id: 'mt-1', company_id: COMPANY, metric_key: REVENUE, period_label: '12m', target_value: 120_000_000, direction: 'higher_is_better',
      source: 'owner', deadline: null, label: null, note: null, baseline_value: 60_000_000, baseline_period: '2026', baseline_at: NOW.toISOString(), created_at: NOW.toISOString(),
    }],
    metrics: [
      metric(REVENUE, 60_480_000),
      metric('biz.marketing.lidov_v_mes', 300), metric('biz.marketing.konversiya_lid_klient', 12), metric('biz.prodazhi.sredniy_chek', 140_000),
    ],
    diagnostics: [{
      id: 'diag-1', user_id: CLIENT, company_id: COMPANY, is_current: true, calculated_at: '2026-10-01T00:00:00Z',
      overall_score: 55, health_index: 50, stage: 'growth',
      finance_score: block(60), sales_score: block(50), operations_score: block(55), marketing_score: block(45), strategy_score: block(40),
    }],
    point_a_snapshots: [{ id: 'snap-1', company_id: COMPANY, engine: 'v4', confidence: 0.6, coverage: 0.7, created_at: '2026-10-10T00:00:00Z', blocks: [{ key: 'finance', score: 60 }], inputs: {} }],
    point_b_versions: [],
    pb_saved_scenarios: rows,
  })
}

const savedRow = (n: number, over: Record<string, unknown> = {}) => ({
  id: `5a5a5a5a-1111-4000-8000-${String(n).padStart(12, '0')}`, company_id: COMPANY, user_id: CLIENT, name: `Сценарий ${n}`, note: null,
  changes: [{ kind: 'conversion', pp: 1 }], summary: { level: 1, delta: {} }, model_version: 'pb-model-2', proposed_at: null, proposal_message_id: null,
  created_at: `2026-10-1${n % 10}T00:00:00Z`, updated_at: `2026-10-1${n % 10}T00:00:00Z`, ...over,
})

const CHECK = { kind: 'avg_check', pct: 10 }
const CONV = { kind: 'conversion', pp: 2 }

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  s.h = seed()
  s.comm = commDb()
  s.user = { id: CLIENT }
  s.impersonating = false
  s.gate402 = false
  s.limited = false
  s.breakInbound = false
  s.limiterCalls.length = 0
  s.gateCalls.length = 0
  s.notified.length = 0
  as('admin')
})

afterEach(() => {
  vi.useRealTimers()
})

describe('POST /api/v1/point-b/whatif', () => {
  it('POST whatif: 401, 402 for free tier with gates on, 400 with field for invalid changes, 429 over the limit', async () => {
    s.user = null
    expect((await calc({ changes: [] })).status).toBe(401)
    s.user = { id: CLIENT }

    s.gate402 = true
    const locked = await calc({ changes: [CHECK] })
    expect(locked.status).toBe(402)
    expect(s.gateCalls.at(-1)).toEqual({ userId: CLIENT, feature: 'point_b' })
    s.gate402 = false

    const bad = await calc({ changes: [CHECK, { kind: 'conversion', pp: 30 }] })
    expect(bad.status).toBe(400)
    expect(bad.body).toMatchObject({ ok: false, code: 'invalid_request', field: 'changes[1].pp' })
    expect(bad.body.error).toMatch(/[А-Яа-я]/)
    expect((await calc({ changes: 'nope' })).body.field).toBe('changes')
    expect((await calc({})).body.field).toBe('changes')
    expect((await calc({ changes: [], scenario: 'reckless' })).body.field).toBe('scenario')
    // a start beyond the horizon of THIS client is refused with the field too (horizon 24 months)
    const far = await calc({ changes: [{ kind: 'revenue_shock', pct: -10, startMonth: 40, durationMonths: 2 }] })
    expect(far.status).toBe(400)
    expect(far.body.field).toBe('changes[0].startMonth')

    s.limited = true
    const limited = await calc({ changes: [CHECK] })
    expect(limited.status).toBe(429)
    expect(s.limiterCalls.at(-1)).toMatchObject({ id: CLIENT, bucket: 'point-b:whatif', opts: { max: 60, windowMs: 10 * 60_000 } })
  })

  it('POST whatif returns the result for a level-1 client and never writes', async () => {
    const r = await calc({ changes: [CHECK, CONV] })
    expect(r.status, JSON.stringify(r.body)).toBe(200)
    expect(r.body.ok).toBe(true)
    const d = r.body.data
    expect(d.level).toBe(1)
    expect(d.baseline.annualRunRateAtDeadline).toBe(60_480_000)
    expect(d.changed.annualRunRateAtDeadline).toBe(75_287_520)
    expect(d.contributions.map((c: { kind: string }) => c.kind)).toEqual(['avg_check', 'conversion'])
    expect(d.interaction.annualRunRateAtDeadline).toBe(675_360)
    expect(d.applicable.marketing.ok).toBe(true)
    expect(d.baseline.minCash).toBeNull()
    expect(d.series.target).toBe(120_000_000)
    expect(d.computedAt).toBe(NOW.toISOString())
    // the answer is the engine's own
    expect(JSON.parse(JSON.stringify(d))).toEqual(d)

    // the empty set is the probe the tab opens with: the baseline and what applies
    const probe = await calc({ changes: [] })
    expect(probe.status).toBe(200)
    expect(probe.body.data.changed).toEqual(probe.body.data.baseline)
    expect(probe.body.data.horizonMonths).toBe(24)

    // the pace profile is chosen by `scenario`: cautious = 18 months → a longer horizon (max(12, 18) + 12)
    const slow = await calc({ changes: [], scenario: 'cautious' })
    expect(slow.body.data.horizonMonths).toBe(30)

    // nothing was written anywhere: no row, no message, no event
    expect(s.h!.writes).toEqual([])
    expect(s.comm!.writes).toEqual([])
    expect(s.notified).toEqual([])
  })

  it('POST whatif works while impersonating (read)', async () => {
    s.impersonating = true
    const r = await calc({ changes: [CHECK] })
    expect(r.status).toBe(200)
    expect(r.body.data.changed.annualRunRateAtDeadline).toBeGreaterThan(r.body.data.baseline.annualRunRateAtDeadline)
    expect((await list()).status).toBe(200)
  })

  it('a client without a goal gets a level-0 answer that explains, not an error', async () => {
    s.h = seed()
    s.h.db.metric_targets = []
    const r = await calc({ changes: [CHECK] })
    expect(r.status).toBe(200)
    expect(r.body.data.level).toBe(0)
    expect(Object.values(r.body.data.applicable).every((a) => (a as { ok: boolean }).ok === false)).toBe(true)
    expect(r.body.data.explanation.join(' ')).toMatch(/цел/i)
  })
})

describe('saved scenarios', () => {
  it('saved: save computes the summary on the server and ignores a client summary', async () => {
    const r = await save({ name: '  Чек плюс конверсия  ', note: 'Если получится', changes: [CHECK, CONV], summary: { level: 9, delta: { annualRunRateAtDeadline: 1 } }, userId: OTHER_CLIENT, company_id: OTHER_COMPANY })
    expect(r.status, JSON.stringify(r.body)).toBe(200)
    const item = r.body.data
    expect(item).toMatchObject({ name: 'Чек плюс конверсия', note: 'Если получится', modelVersion: 'pb-model-2', proposedAt: null })
    expect(item.changes).toEqual([CHECK, CONV])
    expect(item.summary.level).toBe(1)
    expect(item.summary.delta.annualRunRateAtDeadline).toBe(14_807_520)
    expect(item.summary.changed.annualRunRateAtDeadline).toBe(75_287_520)

    // what is stored is the same, under the session user and his company
    expect(saved()).toHaveLength(1)
    expect(saved()[0]).toMatchObject({ company_id: COMPANY, user_id: CLIENT, name: 'Чек плюс конверсия', model_version: 'pb-model-2' })
    expect((saved()[0].summary as { level: number }).level).toBe(1)
    expect(s.limiterCalls.at(-1)).toMatchObject({ bucket: 'point-b:whatif-save', opts: { max: 30 } })

    // …and it is exactly what the calculation route says for these changes
    const calcd = await calc({ changes: [CHECK, CONV] })
    expect(item.summary.delta).toEqual(calcd.body.data.delta)

    // the list: the owner's own, with the camelCase view
    const l = await list()
    expect(l.body.data).toHaveLength(1)
    expect(Object.keys(l.body.data[0]).sort()).toEqual(['changes', 'createdAt', 'id', 'modelVersion', 'name', 'note', 'proposedAt', 'summary'])
  })

  it('the list holds only the owner’s scenarios, the newest first', async () => {
    s.h = seed([
      savedRow(1), savedRow(3), savedRow(2),
      savedRow(4, { user_id: OTHER_CLIENT, company_id: OTHER_COMPANY }),
      savedRow(5, { company_id: OTHER_COMPANY }),
    ])
    const l = await list()
    expect(l.body.data.map((x: { name: string }) => x.name)).toEqual(['Сценарий 3', 'Сценарий 2', 'Сценарий 1'])
  })

  it('name longer than 80 or profane → 400 with field', async () => {
    const ok = [CHECK]
    const long = await save({ name: 'я'.repeat(81), changes: ok })
    expect(long.status).toBe(400)
    expect(long.body).toMatchObject({ field: 'name' })
    expect((await save({ name: 'я'.repeat(80), changes: ok })).status).toBe(200)

    expect((await save({ name: '   ', changes: ok })).body).toMatchObject({ field: 'name' })
    expect((await save({ changes: ok })).body).toMatchObject({ field: 'name' })
    expect((await save({ name: 'ok', note: 'я'.repeat(501), changes: ok })).body).toMatchObject({ field: 'note' })
    expect((await save({ name: 'ok', note: 42, changes: ok })).body).toMatchObject({ field: 'note' })

    const profaneName = await save({ name: 'какая-то хуйня', changes: ok })
    expect(profaneName.status).toBe(400)
    expect(profaneName.body).toMatchObject({ ok: false, code: 'profanity', field: 'name' })
    const profaneNote = await save({ name: 'ok', note: 'это пиздец', changes: ok })
    expect(profaneNote.body).toMatchObject({ code: 'profanity', field: 'note' })

    expect((await save({ name: 'ok', changes: [] })).body).toMatchObject({ field: 'changes' })
    expect((await save({ name: 'ok', changes: [{ kind: 'conversion', pp: 99 }] })).body).toMatchObject({ field: 'changes[0].pp' })
    expect((await save({ name: 'ok', changes: [CHECK, CHECK] })).body).toMatchObject({ field: 'changes[1].kind' })
    expect(saved()).toHaveLength(1) // only the one valid save of 80 characters
  })

  it('21st saved scenario → 409 limit', async () => {
    s.h = seed(Array.from({ length: 20 }, (_, i) => savedRow(i + 1)))
    const r = await save({ name: 'Двадцать первый', changes: [CHECK] })
    expect(r.status).toBe(409)
    expect(r.body).toMatchObject({ ok: false, code: 'limit' })
    expect(r.body.error).toMatch(/20/)
    expect(saved()).toHaveLength(20)
    // after deleting one there is room again
    expect((await del(saved()[0].id as string)).status).toBe(200)
    expect((await save({ name: 'Двадцатый', changes: [CHECK] })).status).toBe(200)
    expect(saved()).toHaveLength(20)
  })

  it('DELETE of another user’s or another company’s scenario → 404 and no delete', async () => {
    const theirs = savedRow(1, { user_id: OTHER_CLIENT, company_id: OTHER_COMPANY })
    const otherCompany = savedRow(2, { company_id: OTHER_COMPANY }) // the same user id, but another company
    const mine = savedRow(3)
    s.h = seed([theirs, otherCompany, mine])
    for (const row of [theirs, otherCompany]) {
      const r = await del(row.id)
      expect(r.status).toBe(404)
      expect(r.body).toMatchObject({ ok: false, code: 'not_found' })
    }
    expect((await del('not-a-uuid')).status).toBe(404)
    expect((await del('5a5a5a5a-9999-4000-8000-000000000999')).status).toBe(404)
    expect(saved().map((r) => r.id).sort()).toEqual([theirs.id, otherCompany.id, mine.id].sort())
    expect(writesOf('pb_saved_scenarios').filter((w) => w.op === 'delete' && (w.payload as unknown[]).length > 0)).toEqual([])

    const own = await del(mine.id)
    expect(own.status).toBe(200)
    expect(saved().map((r) => r.id)).not.toContain(mine.id)
  })

  it('save and delete while impersonating → 403', async () => {
    s.h = seed([savedRow(1)])
    s.impersonating = true
    const a = await save({ name: 'x', changes: [CHECK] })
    expect(a.status).toBe(403)
    expect(a.body.code).toBe('impersonation')
    expect((await del(saved()[0].id as string)).status).toBe(403)
    expect((await propose(saved()[0].id as string)).status).toBe(403)
    expect(saved()).toHaveLength(1)
    expect(saved()[0].proposed_at).toBeNull()
    expect(s.comm!.db.comm_messages).toHaveLength(0)
  })

  it('save and delete are Pro features: 402 without Pro, 401 without a session', async () => {
    s.h = seed([savedRow(1)])
    s.gate402 = true
    expect((await save({ name: 'x', changes: [CHECK] })).status).toBe(402)
    expect((await list()).status).toBe(402)
    expect((await del(saved()[0].id as string)).status).toBe(402)
    expect((await propose(saved()[0].id as string)).status).toBe(402)
    s.gate402 = false
    s.user = null
    expect((await save({ name: 'x', changes: [CHECK] })).status).toBe(401)
    expect((await list()).status).toBe(401)
    expect(saved()).toHaveLength(1)
  })

  it('a client without a company: an empty list, a clear error on save', async () => {
    s.user = { id: OTHER_CLIENT }
    s.h!.db.companies = (s.h!.db.companies as Array<Record<string, unknown>>).filter((c) => c.user_id !== OTHER_CLIENT)
    expect((await list()).body.data).toEqual([])
    const r = await save({ name: 'x', changes: [CHECK] })
    expect(r.status).toBe(404)
    expect(r.body.code).toBe('no_company')
  })

  it('the table of migration 127 is not there yet: the list is empty, saving says «недоступно»', async () => {
    const real = s.h!.sb.from.bind(s.h!.sb)
    s.h = { ...s.h!, sb: { ...s.h!.sb, from: (t: string) => {
      if (t !== 'pb_saved_scenarios') return real(t)
      const q: Record<string, unknown> = {}
      for (const m of ['select', 'eq', 'order', 'limit', 'insert', 'delete', 'update', 'is']) q[m] = () => q
      q.maybeSingle = async () => ({ data: null, error: { code: '42P01' } })
      q.single = async () => ({ data: null, error: { code: '42P01' } })
      q.then = (res: (v: unknown) => unknown) => Promise.resolve({ data: null, error: { code: '42P01' } }).then(res)
      return q
    } } as never }
    expect((await list()).body).toEqual({ ok: true, data: [] })
    const r = await save({ name: 'x', changes: [CHECK] })
    expect(r.status).toBe(503)
    expect(r.body.code).toBe('unavailable')
  })
})

describe('propose to the expert', () => {
  it('propose sends one inbound message to the owner’s thread, sets proposed_at, and a second propose → 409 without a second message', async () => {
    s.h = seed([savedRow(1, { name: 'Чек и конверсия', changes: [CHECK, CONV] })])
    const id = saved()[0].id as string
    const r = await propose(id, { comment: 'Хочу проверить в Q1' })
    expect(r.status, JSON.stringify(r.body)).toBe(200)
    expect(r.body.data.id).toBe(id)
    expect(r.body.data.proposedAt).toBe(NOW.toISOString())

    const messages = s.comm!.db.comm_messages
    expect(messages).toHaveLength(1)
    expect(messages[0]).toMatchObject({ direction: 'in', channel: 'app', author_kind: 'user', author_id: CLIENT, status: 'delivered' })
    expect(messages[0].body).toBe('Предлагаю учесть в плане сценарий «Чек и конверсия»: средний чек +10% (эластичность 0,3), конверсия +2 п.п. Хочу проверить в Q1')
    expect(messages[0].metadata).toMatchObject({ source: 'point_b_whatif', scenarioId: id })
    expect(s.comm!.db.comm_threads).toHaveLength(1)
    expect(s.comm!.db.comm_threads[0]).toMatchObject({ user_id: CLIENT, status: 'waiting_staff' })
    expect(s.notified).toHaveLength(1) // the staff inbox is told

    expect(saved()[0].proposed_at).toBe(NOW.toISOString())
    expect(saved()[0].proposal_message_id).toBe(messages[0].id)
    // the plan was not touched
    expect(writesOf('pb_plans')).toEqual([])
    expect(writesOf('pb_plan_versions')).toEqual([])

    const again = await propose(id, { comment: 'ещё раз' })
    expect(again.status).toBe(409)
    expect(again.body).toMatchObject({ ok: false, code: 'already_proposed' })
    expect(s.comm!.db.comm_messages).toHaveLength(1)

    // the list shows the mark
    expect((await list()).body.data[0].proposedAt).toBe(NOW.toISOString())
  })

  it('parallel proposals of the same scenario send exactly one message', async () => {
    s.h = seed([savedRow(1)])
    const id = saved()[0].id as string
    const [a, b] = await Promise.all([propose(id), propose(id)])
    expect([a.status, b.status].sort()).toEqual([200, 409])
    expect(s.comm!.db.comm_messages).toHaveLength(1)
  })

  it('propose without a thread creates the thread (recordInbound) and does not fail', async () => {
    s.h = seed([savedRow(1)])
    // no expert assigned either
    s.h.db.user_assignments = []
    expect(s.comm!.db.comm_threads).toHaveLength(0)
    const r = await propose(saved()[0].id as string)
    expect(r.status, JSON.stringify(r.body)).toBe(200)
    expect(s.comm!.db.comm_threads).toHaveLength(1)
    expect(s.comm!.db.comm_threads[0]).toMatchObject({ user_id: CLIENT, company_id: COMPANY, assignee_id: null })
    expect(s.comm!.db.comm_messages).toHaveLength(1)
    // without a comment the message ends with the description
    expect(s.comm!.db.comm_messages[0].body).toBe('Предлагаю учесть в плане сценарий «Сценарий 1»: конверсия +1 п.п.')

    // an existing thread gets the message appended, no second thread
    s.h.db.pb_saved_scenarios.push(savedRow(2))
    expect((await propose(savedRow(2).id)).status).toBe(200)
    expect(s.comm!.db.comm_threads).toHaveLength(1)
    expect(s.comm!.db.comm_messages).toHaveLength(2)
  })

  it('a profane or over-long comment is refused and nothing is sent or marked', async () => {
    s.h = seed([savedRow(1)])
    const id = saved()[0].id as string
    expect((await propose(id, { comment: 'это пиздец' })).body).toMatchObject({ code: 'profanity', field: 'comment' })
    const long = await propose(id, { comment: 'я'.repeat(501) })
    expect(long.status).toBe(400)
    expect(long.body.field).toBe('comment')
    expect((await propose(id, { comment: 42 })).body.field).toBe('comment')
    expect(s.comm!.db.comm_messages).toHaveLength(0)
    expect(saved()[0].proposed_at).toBeNull()
  })

  it('someone else’s, another company’s or an unknown scenario → 404, nothing sent', async () => {
    const theirs = savedRow(1, { user_id: OTHER_CLIENT, company_id: OTHER_COMPANY })
    const otherCompany = savedRow(2, { company_id: OTHER_COMPANY })
    s.h = seed([theirs, otherCompany])
    for (const id of [theirs.id, otherCompany.id, 'nope', '5a5a5a5a-9999-4000-8000-000000000999']) {
      expect((await propose(id)).status).toBe(404)
    }
    expect(s.comm!.db.comm_messages).toHaveLength(0)
    expect(saved().every((r) => r.proposed_at === null)).toBe(true)
  })

  it('when the message cannot be sent the mark is given back and the client can try again', async () => {
    s.h = seed([savedRow(1)])
    const id = saved()[0].id as string
    s.breakInbound = true
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const r = await propose(id)
    err.mockRestore()
    expect(r.status).toBe(500)
    expect(saved()[0].proposed_at).toBeNull()
    expect(saved()[0].proposal_message_id).toBeNull()
    s.breakInbound = false
    expect((await propose(id)).status).toBe(200)
    expect(s.comm!.db.comm_messages).toHaveLength(1)
  })
})

describe('GET /api/giga-admin/users/:id/point-b/whatif/saved', () => {
  it('expert GET works only for the expert’s clients; another client → 403', async () => {
    s.h = seed([savedRow(1, { proposed_at: NOW.toISOString() }), savedRow(2, { user_id: OTHER_CLIENT, company_id: OTHER_COMPANY, name: 'Чужой' })])
    as('super_expert', EXPERT, 'assigned')
    const mine = await expertList(CLIENT)
    expect(mine.status, JSON.stringify(mine.body)).toBe(200)
    expect(mine.body.data.map((x: { name: string }) => x.name)).toEqual(['Сценарий 1'])
    expect(mine.body.data[0].proposedAt).toBe(NOW.toISOString())
    expect(mine.body.data[0]).not.toHaveProperty('user_id')

    const other = await expertList(OTHER_CLIENT)
    expect(other.status).toBe(403)
    expect(JSON.stringify(other.body)).not.toContain('Чужой')

    // an admin reads any client; a malformed id is a 404; a client without a company has an empty list
    as('admin')
    expect((await expertList(OTHER_CLIENT)).body.data.map((x: { name: string }) => x.name)).toEqual(['Чужой'])
    expect((await expertList('nope')).status).toBe(404)
    // read-only: there is no write handler
    expect('POST' in expertRoute).toBe(false)
    expect('PUT' in expertRoute).toBe(false)
    expect('DELETE' in expertRoute).toBe(false)
  })

  it('a role without clients.review is refused', async () => {
    as('analyst')
    const r = await expertList(CLIENT)
    expect(r.status).toBe(403)
  })
})

describe('the engine and the route agree', () => {
  it('the route answer equals runWhatIf on the same inputs', async () => {
    const { loadWhatIfInputs } = await import('@/lib/point-b/whatif-store')
    const { inputs } = await loadWhatIfInputs(router() as never, CLIENT, NOW)
    const direct = runWhatIf(inputs, [CHECK as never])
    const viaRoute = (await calc({ changes: [CHECK] })).body.data
    expect(viaRoute).toEqual(JSON.parse(JSON.stringify(direct)))
  })
})
