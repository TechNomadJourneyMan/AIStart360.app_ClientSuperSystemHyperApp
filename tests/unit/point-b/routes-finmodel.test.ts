/**
 * Finmodel routes (Point B plan Ф3, Task 4): the owner's GET / PUT /api/v1/point-b/finmodel, the expert's
 * GET / PUT /api/giga-admin/users/:id/point-b/finmodel and POST …/verify, and the completeness field of
 * GET /api/v1/point-b/state. In-memory DB, the real store / merge / routes; the audit, the gates, the
 * impersonation and the rate limit are doubles.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'
import type { StaffRole } from '@/lib/admin/rbac'
import { pbDb } from './_pbdb'

const REVENUE = 'biz.finansy.vyruchka_god'
const CLIENT = 'cccccccc-0000-4000-8000-000000000001'
const OTHER_CLIENT = 'cccccccc-0000-4000-8000-000000000002'
const EXPERT = 'eeeeeeee-0000-4000-8000-000000000001'
const ADMIN = 'aaaaaaaa-0000-4000-8000-000000000001'
const COMPANY = 'company-1'
const OTHER_COMPANY = 'company-2'

const s = vi.hoisted(() => ({
  h: null as ReturnType<typeof import('./_pbdb').pbDb> | null,
  actor: { id: 'x', role: 'admin' as StaffRole, scope: 'all' as 'all' | 'assigned' },
  user: null as { id: string } | null,
  impersonating: false,
  gate402: false,
  limited: false,
  limiterCalls: [] as Array<{ id: string; bucket: string; opts: unknown }>,
  gateCalls: [] as Array<{ userId: string; feature: string }>,
  audits: [] as Array<{ action: string; entityId?: string | null; targetUserId?: string | null; metadata?: Record<string, unknown>; oldValue?: unknown; newValue?: unknown }>,
  recalcs: [] as unknown[],
  events: [] as unknown[],
}))

vi.mock('@/lib/supabase-service', () => ({ createServiceClient: () => s.h!.sb }))
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
// Anything that would start a Point A recalculation or an event must not be reached by a finmodel write.
vi.mock('@/lib/point-a/recalc-queue', () => ({ requestPointARecalc: async (...a: unknown[]) => { s.recalcs.push(a) } }))
vi.mock('@/lib/events/platform', () => ({
  emitPlatformEvent: async (e: unknown) => { s.events.push(e); return { id: 1, duplicate: false } },
  emitPlatformEventSafely: (e: unknown) => { s.events.push(e) },
}))
vi.mock('@/lib/events/server', () => ({ trackUserAction: async (e: unknown) => { s.events.push(e) } }))
vi.mock('@/lib/admin/audit', () => ({
  recordAdminAction: async (_actor: unknown, entry: { action: string; entityId?: string | null; targetUserId?: string | null; metadata?: Record<string, unknown>; oldValue?: unknown; newValue?: unknown }) => { s.audits.push(entry); return true },
}))
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

const clientRoute = await import('@/app/api/v1/point-b/finmodel/route')
const expertRoute = await import('@/app/api/giga-admin/users/[id]/point-b/finmodel/route')
const verifyRoute = await import('@/app/api/giga-admin/users/[id]/point-b/finmodel/verify/route')
const stateRoute = await import('@/app/api/v1/point-b/state/route')

const req = (method: string, b?: unknown) =>
  new NextRequest('http://t/api', { method, body: b === undefined ? undefined : JSON.stringify(b), headers: { 'content-type': 'application/json', origin: 'http://t' } })
const idp = (id: string) => ({ params: { id } })
const json = async (r: Response) => ({ status: r.status, body: await r.json() })
const rows = () => s.h!.db.pb_finmodel_inputs as Array<Record<string, unknown>>
const as = (role: StaffRole, id = role === 'admin' ? ADMIN : EXPERT, scope: 'all' | 'assigned' = 'all') => { s.actor = { id, role, scope } }

const clientGet = async () => json(await clientRoute.GET())
const clientPut = async (b: unknown) => json(await clientRoute.PUT(req('PUT', b)))
const expertGet = async (id = CLIENT) => json(await expertRoute.GET(req('GET'), idp(id)))
const expertPut = async (b: unknown, id = CLIENT) => json(await expertRoute.PUT(req('PUT', b), idp(id)))
const verify = async (b: unknown, id = CLIENT) => json(await verifyRoute.POST(req('POST', b), idp(id)))

const metric = (key: string, value: number) => ({ company_id: COMPANY, metric_key: key, metric_value: value, source: 'survey', period_year: 2026, computed_at: '2026-10-01T00:00:00Z' })

function seed() {
  return pbDb({
    companies: [
      { id: COMPANY, user_id: CLIENT, name: 'Ромашка', industry: 'Интернет-магазин', target_revenue_12m_kzt: null, target_revenue_3y_kzt: null, created_at: '2026-01-01T00:00:00Z' },
      { id: OTHER_COMPANY, user_id: OTHER_CLIENT, name: 'Лютик', industry: null, target_revenue_12m_kzt: null, target_revenue_3y_kzt: null, created_at: '2026-01-01T00:00:00Z' },
    ],
    profiles: [
      { id: CLIENT, role: 'client', full_name: 'Клиент Один' },
      { id: OTHER_CLIENT, role: 'client', full_name: 'Клиент Два' },
      { id: EXPERT, role: 'expert', full_name: 'Алия Эксперт' },
      { id: ADMIN, role: 'admin', full_name: 'Админ Главный' },
    ],
    user_assignments: [{ user_id: CLIENT, assignee_id: EXPERT }, { user_id: OTHER_CLIENT, assignee_id: 'someone-else' }],
    metric_targets: [{
      id: 'mt-1', company_id: COMPANY, metric_key: REVENUE, period_label: '12m', target_value: 120_000_000, direction: 'higher_is_better',
      source: 'owner', deadline: null, label: null, note: null, baseline_value: 60_000_000, baseline_period: '2026', baseline_at: '2026-10-01T00:00:00Z', created_at: '2026-10-01T00:00:00Z',
    }],
    metrics: [metric(REVENUE, 60_000_000)],
    survey_answers: [],
    pb_finmodel_inputs: [],
  })
}

const FULL = [
  { key: 'cash_balance', value: 4_000_000 }, { key: 'fixed_costs_month', value: 500_000 }, { key: 'payroll_month', value: 1_000_000 },
  { key: 'debt_total', value: 0 }, { key: 'capex_year', value: 0 },
]

beforeEach(() => {
  s.h = seed()
  s.user = { id: CLIENT }
  s.impersonating = false
  s.gate402 = false
  s.limited = false
  s.limiterCalls.length = 0
  s.gateCalls.length = 0
  s.audits.length = 0
  s.recalcs.length = 0
  s.events.length = 0
  as('admin')
})

describe('client GET /api/v1/point-b/finmodel', () => {
  it('client GET returns defs and the merged state; 401 without session; 402 for free tier with gates on', async () => {
    const r = await clientGet()
    expect(r.status, JSON.stringify(r.body)).toBe(200)
    expect(r.body.ok).toBe(true)
    const { defs, state } = r.body.data
    expect(defs).toHaveLength(11)
    expect(defs[0]).toMatchObject({ key: 'cash_balance', unit: '₸', required: true })
    expect(Object.keys(defs[0]).sort()).toEqual(['conditional', 'group', 'hint', 'key', 'label', 'max', 'min', 'required', 'unit', 'unlocks'])
    expect(defs.find((d: { key: string }) => d.key === 'debt_service_month')).toMatchObject({ required: false, conditional: true })
    // nothing typed: the hard inputs are missing, tax and the days are industry assumptions
    expect(state.complete).toBe(false)
    expect([...state.missing].sort()).toEqual(['capex_year', 'cash_balance', 'debt_total', 'fixed_costs_month', 'payroll_month'])
    expect([...state.defaulted].sort()).toEqual(['dio_days', 'dpo_days', 'dso_days', 'tax_rate'])
    expect(state.values.tax_rate).toMatchObject({ value: 0.1, origin: 'default', status: 'auto' })
    expect(state.values.dio_days.value).toBe(45) // e-commerce

    s.user = null
    expect((await clientGet()).status).toBe(401)
    s.user = { id: CLIENT }
    s.gate402 = true
    const locked = await clientGet()
    expect(locked.status).toBe(402)
    expect(s.gateCalls.at(-1)).toEqual({ userId: CLIENT, feature: 'point_b' })
  })

  it('the questionnaire fills debt and fixed costs, and a client sees only his own company', async () => {
    s.h = pbDb({
      ...Object.fromEntries(Object.entries(s.h!.db)),
      survey_answers: [
        { user_id: CLIENT, question_key: 's9n_debts_amount', answer: { value: 0 } },
        { user_id: CLIENT, question_key: 's9n_expense_rent', answer: { value: '6 000 000' } },
        { user_id: CLIENT, question_key: 's9n_expense_other', answer: { value: '600 000' } },
      ],
      pb_finmodel_inputs: [{ id: 'f1', company_id: OTHER_COMPANY, key: 'cash_balance', value: 777, origin: 'owner', status: 'entered' }],
    })
    const { state } = (await clientGet()).body.data
    expect(state.values.debt_total).toMatchObject({ value: 0, origin: 'survey', status: 'auto' })
    expect(state.values.fixed_costs_month).toMatchObject({ value: 550_000, origin: 'survey' })
    expect(state.values.cash_balance).toBeUndefined()
    expect(JSON.stringify(state)).not.toContain('777')
  })
})

describe('client PUT /api/v1/point-b/finmodel', () => {
  it('PUT saves owner values and returns the merged state; a value out of range → 400 with the field', async () => {
    const r = await clientPut({ values: [{ key: 'cash_balance', value: 4_000_000, asOf: '2026-10-15', note: 'по выписке' }, { key: 'tax_rate', value: 0.2 }] })
    expect(r.status, JSON.stringify(r.body)).toBe(200)
    expect(Object.keys(r.body.data)).toEqual(['state'])
    expect(r.body.data.state.values.cash_balance).toMatchObject({ value: 4_000_000, origin: 'owner', status: 'entered', asOf: '2026-10-15', note: 'по выписке' })
    expect(r.body.data.state.values.tax_rate).toMatchObject({ value: 0.2, origin: 'owner' })
    expect(r.body.data.state.defaulted).not.toContain('tax_rate')
    expect(rows()).toHaveLength(2)
    expect(rows().find((x) => x.key === 'cash_balance')).toMatchObject({ company_id: COMPANY, origin: 'owner', status: 'entered', updated_by: CLIENT })

    for (const [bad, field] of [
      [{ key: 'tax_rate', value: 1.5 }, 'tax_rate'],
      [{ key: 'cash_balance', value: -5 }, 'cash_balance'],
      [{ key: 'dso_days', value: 4000 }, 'dso_days'],
      [{ key: 'cash_balance', value: '5 млн' }, 'cash_balance'],
      [{ key: 'cash_balance', value: null }, 'cash_balance'],
    ] as const) {
      const e = await clientPut({ values: [bad] })
      expect(e.status, JSON.stringify(bad)).toBe(400)
      expect(e.body).toMatchObject({ ok: false, code: 'invalid_value', field })
      expect(e.body.error.length).toBeGreaterThan(5)
    }
    const unknown = await clientPut({ values: [{ key: 'revenue', value: 5 }] })
    expect(unknown.status).toBe(400)
    expect(unknown.body).toMatchObject({ code: 'unknown_key', field: 'revenue' })
    expect(rows()).toHaveLength(2) // nothing from the failed requests
  })

  it('a bad request body is a 400 without a write: empty, not an array, too many values, junk items', async () => {
    for (const b of [{}, { values: [] }, { values: 'x' }, { values: [5] }, { values: [{ value: 1 }] }, null, { values: Array.from({ length: 21 }, () => ({ key: 'cash_balance', value: 1 })) }]) {
      const e = await clientPut(b)
      expect(e.status, JSON.stringify(b)).toBe(400)
      expect(e.body.ok).toBe(false)
    }
    expect(rows()).toHaveLength(0)
    // exactly 20 are fine
    const twenty = Array.from({ length: 20 }, (_, i) => ({ key: 'cash_balance', value: i, period: `2026-${String((i % 12) + 1).padStart(2, '0')}` }))
    expect((await clientPut({ values: twenty })).status).toBe(200)
  })

  it('PUT while impersonating → 403 and no write', async () => {
    s.impersonating = true
    const r = await clientPut({ values: [{ key: 'cash_balance', value: 1 }] })
    expect(r.status).toBe(403)
    expect(r.body.error).toMatch(/от имени/)
    expect(rows()).toHaveLength(0)
    // reading «от имени» is fine
    expect((await clientGet()).status).toBe(200)
  })

  it('PUT without the Pro feature (gates on) → 402 and no write; without a session → 401', async () => {
    s.gate402 = true
    expect((await clientPut({ values: [{ key: 'cash_balance', value: 1 }] })).status).toBe(402)
    s.gate402 = false
    s.user = null
    expect((await clientPut({ values: [{ key: 'cash_balance', value: 1 }] })).status).toBe(401)
    expect(rows()).toHaveLength(0)
  })

  it('PUT does not enqueue a Point A recalculation or emit an event', async () => {
    const r = await clientPut({ values: FULL })
    expect(r.status).toBe(200)
    expect(s.recalcs).toEqual([])
    expect(s.events).toEqual([])
    // and it touches no table of Point A
    const touched = new Set(s.h!.writes.map((w) => w.table))
    expect([...touched]).toEqual(['pb_finmodel_inputs'])
  })

  it('rate limit → 429', async () => {
    const ok = await clientPut({ values: [{ key: 'cash_balance', value: 1 }] })
    expect(ok.status).toBe(200)
    expect(s.limiterCalls[0]).toEqual({ id: CLIENT, bucket: 'point-b:finmodel', opts: { max: 30, windowMs: 600_000 } })
    s.limited = true
    const r = await clientPut({ values: [{ key: 'cash_balance', value: 2 }] })
    expect(r.status).toBe(429)
    expect(rows()[0].value).toBe(1)
  })

  it('profanity in note → 400 with field note', async () => {
    const r = await clientPut({ values: [{ key: 'cash_balance', value: 1, note: 'тут полная хуйня' }] })
    expect(r.status).toBe(400)
    expect(r.body).toMatchObject({ ok: false, code: 'profanity', field: 'note' })
    expect(rows()).toHaveLength(0)
  })

  it('a client without a company gets 404 and nothing is written', async () => {
    s.h!.db.companies.length = 0
    const r = await clientPut({ values: [{ key: 'cash_balance', value: 1 }] })
    expect(r.status).toBe(404)
    expect(r.body.code).toBe('no_company')
    expect(rows()).toHaveLength(0)
    // reading still works: defaults and what is missing
    expect((await clientGet()).body.data.state.complete).toBe(false)
  })

  it('the client writes only to his own company, whatever the body says', async () => {
    const r = await clientPut({ values: [{ key: 'cash_balance', value: 1 }], companyId: OTHER_COMPANY, userId: OTHER_CLIENT })
    expect(r.status).toBe(200)
    expect(rows().map((x) => x.company_id)).toEqual([COMPANY])
  })

  it('owner re-entering a verified value returns it to entered', async () => {
    await expertPut({ values: [{ key: 'cash_balance', value: 100 }] })
    expect((await verify({ keys: ['cash_balance'] })).status).toBe(200)
    expect((await clientGet()).body.data.state.values.cash_balance).toMatchObject({ status: 'verified', origin: 'expert', verifiedByName: 'Админ Главный' })
    const r = await clientPut({ values: [{ key: 'cash_balance', value: 120 }] })
    expect(r.body.data.state.values.cash_balance).toMatchObject({ value: 120, status: 'entered', origin: 'owner', verifiedByName: null, verifiedAt: null })
    expect(rows()[0]).toMatchObject({ status: 'entered', verified_by: null, verified_by_name: null, verified_at: null })
  })
})

describe('expert routes', () => {
  it('expert PUT works only for the expert’s clients; another client → 403', async () => {
    as('super_expert', EXPERT, 'assigned')
    const mine = await expertPut({ values: [{ key: 'payroll_month', value: 1_000_000 }] })
    expect(mine.status, JSON.stringify(mine.body)).toBe(200)
    expect(mine.body.data.state.values.payroll_month).toMatchObject({ value: 1_000_000, origin: 'expert', status: 'entered' })
    expect(rows()).toHaveLength(1)
    expect(rows()[0]).toMatchObject({ company_id: COMPANY, origin: 'expert', updated_by: EXPERT })

    const other = await expertPut({ values: [{ key: 'payroll_month', value: 5 }] }, OTHER_CLIENT)
    expect(other.status).toBe(403)
    expect(rows()).toHaveLength(1)
    expect((await expertGet(OTHER_CLIENT)).status).toBe(403)
    expect((await verify({ keys: ['payroll_month'] }, OTHER_CLIENT)).status).toBe(403)

    // staff without clients.review cannot even read
    as('analyst')
    expect((await expertGet()).status).toBe(403)
    expect((await expertPut({ values: [{ key: 'payroll_month', value: 5 }] })).status).toBe(403)
    expect((await verify({ keys: ['payroll_month'] })).status).toBe(403)
  })

  it('expert GET returns defs, the state and the warnings of the calculation', async () => {
    const r = await expertGet()
    expect(r.status, JSON.stringify(r.body)).toBe(200)
    expect(r.body.data.defs).toHaveLength(11)
    expect(r.body.data.state.complete).toBe(false)
    expect(r.body.data.warnings).toEqual([])

    // a complete finmodel + margin: the model month (1 000 000 + 500 000) against the platform fact 3 000 000 → the expert is told
    s.h!.db.metrics.push(metric('biz.finansy.valovaya_marzha', 40), metric('biz.finansy.operatsionnye_raskhody', 36_000_000))
    await expertPut({ values: FULL })
    const warned = await expertGet()
    expect(warned.body.data.state.complete).toBe(true)
    expect(warned.body.data.warnings.some((w: string) => /^Расходы по модели расходятся с фактом на 50%/.test(w))).toBe(true)
    expect(warned.body.data.warnings.some((w: string) => /допущения по отрасли/.test(w))).toBe(true)
  })

  it('expert PUT is audited with the changed keys and values', async () => {
    as('super_expert', EXPERT, 'assigned')
    await expertPut({ values: [{ key: 'cash_balance', value: 10, note: 'уточнил по телефону' }] })
    await expertPut({ values: [{ key: 'cash_balance', value: 20 }] })
    expect(s.audits).toHaveLength(2)
    expect(s.audits[0]).toMatchObject({ action: 'point_b.finmodel.updated', targetUserId: CLIENT, entityId: COMPANY, oldValue: { cash_balance: null }, newValue: { cash_balance: 10 } })
    expect(s.audits[1]).toMatchObject({ oldValue: { cash_balance: 10 }, newValue: { cash_balance: 20 } })
    expect(s.audits[0].metadata).toMatchObject({ keys: ['cash_balance'], notes: 1 })
    // a refused write is not audited
    await expertPut({ values: [{ key: 'cash_balance', value: -1 }] })
    expect(s.audits).toHaveLength(2)
  })

  it('expert PUT: errors name the field; profanity is refused; a client without a company is a 400', async () => {
    expect((await expertPut({ values: [{ key: 'interest_rate_annual', value: 3 }] })).body).toMatchObject({ code: 'invalid_value', field: 'interest_rate_annual' })
    expect((await expertPut({ values: [{ key: 'cash_balance', value: 1, note: 'какая-то хуйня' }] })).body).toMatchObject({ code: 'profanity', field: 'note' })
    expect((await expertPut({})).status).toBe(400)
    expect(rows()).toHaveLength(0)
    s.h!.db.companies.length = 0
    expect((await expertPut({ values: [{ key: 'cash_balance', value: 1 }] })).status).toBe(400)
    expect(s.audits).toHaveLength(0)
  })

  it('expert verify marks entered values verified and refuses auto/default keys with 400', async () => {
    as('super_expert', EXPERT, 'assigned')
    await clientPut({ values: [{ key: 'cash_balance', value: 100 }, { key: 'payroll_month', value: 200 }] })
    const ok = await verify({ keys: ['cash_balance'] })
    expect(ok.status, JSON.stringify(ok.body)).toBe(200)
    expect(ok.body.data.state.values.cash_balance).toMatchObject({ status: 'verified', verifiedByName: 'Алия Эксперт' })
    expect(ok.body.data.state.values.cash_balance.verifiedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(ok.body.data.state.values.payroll_month.status).toBe('entered')
    expect(rows().find((x) => x.key === 'cash_balance')).toMatchObject({ status: 'verified', verified_by: EXPERT })
    expect(s.audits.at(-1)).toMatchObject({ action: 'point_b.finmodel.verified', targetUserId: CLIENT, metadata: { keys: ['cash_balance'] } })
    const auditCount = s.audits.length

    // a default (tax) and a key with nothing at all: 400 not_found, and the valid key in the same request is NOT verified
    const before = JSON.stringify(rows())
    const refused = await verify({ keys: ['payroll_month', 'tax_rate'] })
    expect(refused.status).toBe(400)
    expect(refused.body).toMatchObject({ ok: false, code: 'not_found', field: 'tax_rate' })
    expect(JSON.stringify(rows())).toBe(before)
    expect((await verify({ keys: ['debt_total'] })).status).toBe(400)
    expect(s.audits).toHaveLength(auditCount)

    // a value from the questionnaire is not typed by a person either
    s.h!.db.survey_answers.push({ user_id: CLIENT, question_key: 's9n_debts_amount', answer: { value: 0 } })
    expect((await verify({ keys: ['debt_total'] })).body.code).toBe('not_found')
  })

  it('verify validates its body', async () => {
    for (const b of [{}, { keys: [] }, { keys: 'cash_balance' }, { keys: ['nope'] }, null]) {
      const r = await verify(b)
      expect(r.status, JSON.stringify(b)).toBe(400)
    }
    expect(s.audits).toHaveLength(0)
  })
})

describe('GET /api/v1/point-b/state — finmodel completeness', () => {
  it('state exposes finmodel completeness without values', async () => {
    const empty = await json(await stateRoute.GET())
    expect(empty.status, JSON.stringify(empty.body)).toBe(200)
    expect(empty.body.data.finmodel).toEqual({
      complete: false,
      missing: ['cash_balance', 'fixed_costs_month', 'payroll_month', 'debt_total', 'capex_year'],
      defaulted: ['dso_days', 'dio_days', 'dpo_days', 'tax_rate'],
    })
    // level 1 hints: the missing keys of level 2 are in the result as well
    expect(empty.body.data.overview.result.missing.map((m: { key: string }) => m.key)).toEqual(expect.arrayContaining(['finmodel:cash_balance', 'finmodel:payroll_month']))

    await clientPut({ values: [...FULL, { key: 'tax_rate', value: 0.2 }] })
    const full = await json(await stateRoute.GET())
    expect(full.body.data.finmodel).toEqual({ complete: true, missing: [], defaulted: ['dso_days', 'dio_days', 'dpo_days'] })
    expect(Object.keys(full.body.data.finmodel).sort()).toEqual(['complete', 'defaulted', 'missing'])
    // no number of the finmodel leaks into the completeness field
    expect(JSON.stringify(full.body.data.finmodel)).not.toMatch(/4000000|500000|0\.2/)
  })

  it('state keeps working when the finmodel table is not there yet (migration 126 not applied)', async () => {
    const real = s.h!.sb.from.bind(s.h!.sb)
    const broken = { ...s.h!.sb, from: (t: string) => {
      if (t !== 'pb_finmodel_inputs') return real(t)
      const q: Record<string, unknown> = {}
      for (const m of ['select', 'eq', 'in']) q[m] = () => q
      q.then = (res: (v: unknown) => unknown) => Promise.resolve({ data: null, error: { code: '42P01' } }).then(res)
      return q
    } }
    s.h = { ...s.h!, sb: broken as never }
    const r = await json(await stateRoute.GET())
    expect(r.status).toBe(200)
    expect(r.body.data.finmodel.complete).toBe(false)
    const g = await clientGet()
    expect(g.status).toBe(200)
  })
})
