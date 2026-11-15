/**
 * R2-A review fixes on «neighbour» paths of the paid sections, each with the
 * case that failed before the fix:
 *   M-1  /api/v1/action-plan (+ PATCH routes) — GRI 90-day tasks / Point B tasks only with the section;
 *   L-1  /api/v1/gri/pulse baseline, /api/v1/nba signals — no full GRI / Point A for Free;
 *   H-3  /metrics loader — gri_assessments not read when the full GRI is closed, explicit columns;
 *   M-3  /api/v1/diagnostics/ai-analyze — the direct (session) path is gated;
 *   L-3  the «Сообщения» bot facts — no Point A score / weak blocks for Free.
 * The decision itself is mocked here (tested in decision.test.ts).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

type Row = Record<string, unknown>
const s = vi.hoisted(() => ({
  sections: { point_a: false, point_b: false, market: false, gri_full: false } as Record<string, boolean>,
  user: { id: 'u-1' } as { id: string } | null,
  tables: {} as Record<string, Row[]>,
  reads: [] as string[],
  inserts: [] as Array<{ table: string; rows: unknown }>,
  updates: [] as Array<{ table: string; patch: unknown }>,
  fetched: [] as string[],
}))

function client() {
  return {
    auth: { getUser: async () => ({ data: { user: s.user }, error: null }) },
    from(table: string) {
      s.reads.push(table)
      const st = { op: 'select', filters: [] as Array<[string, unknown]>, payload: null as unknown }
      const rows = () => (s.tables[table] ?? []).filter((r) => st.filters.every(([c, v]) => r[c] === v))
      const exec = async () => {
        if (st.op === 'insert') { s.inserts.push({ table, rows: st.payload }); return { data: null, error: null } }
        if (st.op === 'update') { s.updates.push({ table, patch: st.payload }); return { data: rows().map((r) => ({ id: r.id })), error: null } }
        return { data: rows(), error: null, count: rows().length }
      }
      const b: Record<string, unknown> = {}
      const self = () => b
      Object.assign(b, {
        select: self, order: self, limit: self, in: self, is: self, lt: self, gte: self, neq: self, contains: self, or: self,
        eq: (c: string, v: unknown) => { st.filters.push([c, v]); return b },
        insert: (p: unknown) => { st.op = 'insert'; st.payload = p; return b },
        update: (p: unknown) => { st.op = 'update'; st.payload = p; return b },
        maybeSingle: async () => { const r = await exec(); return { data: Array.isArray(r.data) ? r.data[0] ?? null : r.data, error: null } },
        single: async () => { const r = await exec(); return { data: Array.isArray(r.data) ? r.data[0] ?? null : r.data, error: null } },
        then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => exec().then(res, rej),
      })
      return b
    },
  }
}

vi.mock('@/lib/supabase-server', () => ({ createServerClient: () => client() }))
vi.mock('@/lib/supabase-service', () => ({ createServiceClient: () => client(), requireServiceRoleKey: () => 'k' }))
vi.mock('@/lib/access/decision', async () => {
  const real = await vi.importActual<typeof import('@/lib/access/decision')>('@/lib/access/decision')
  return {
    ...real,
    resolveAccess: async () => ({ gatesEnabled: true, ent: {}, staff: false, sections: { ...s.sections } }),
    resolveFeature: async (_sb: unknown, _u: string, f: string) => ({ allowed: !!s.sections[f], reason: s.sections[f] ? 'entitled' : 'upgrade_required', ent: {}, gatesEnabled: true }),
  }
})
vi.mock('@/lib/api-identity', async () => ({
  ...(await vi.importActual<Record<string, unknown>>('@/lib/api-identity')),
  mayActOnUser: async () => true,
  getSessionUser: async () => s.user,
}))
vi.mock('@/lib/rate-limit', () => ({ isRateLimitedKey: async () => false, isRateLimited: async () => false }))
vi.mock('@/lib/events/server', () => ({ trackUserAction: async () => undefined }))
vi.mock('@/lib/audit', () => ({ logAudit: async () => undefined }))
vi.mock('@/lib/internal-auth', async () => ({ ...(await vi.importActual<Record<string, unknown>>('@/lib/internal-auth')), hasValidInternalToken: () => false }))

const json = (url: string, method: string, body?: unknown) =>
  new NextRequest(url, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })

beforeEach(() => {
  s.sections = { point_a: false, point_b: false, market: false, gri_full: false }
  s.user = { id: 'u-1' }
  s.tables = {
    action_items: [
      { id: 't-gri', user_id: 'u-1', title: 'GRI step', source: 'plan', status: 'open', priority: 1 },
      { id: 't-pb', user_id: 'u-1', title: 'Point B step', source: 'point_b', status: 'open', priority: 2 },
    ],
    gri_assessments: [{ id: 'g-1', user_id: 'u-1', is_current: true, gri_index: 6.5, section_avgs: { s1: 7 }, top_5_limits: [{ criterionText: 'ПЛАТНОЕ_ОГРАНИЧЕНИЕ', blockName: 'Продажи' }], action_plan_90d: { '1-30': ['ПЛАТНЫЙ ШАГ'] }, created_at: '2026-11-01' }],
    gri_pulse_responses: [],
  }
  s.reads = []
  s.inserts = []
  s.updates = []
  s.fetched = []
})

describe('M-1 /api/v1/action-plan', () => {
  it('Free (both closed) → 402, nothing materialised from the GRI plan (before: the 90-day plan and Point B tasks)', async () => {
    const { GET } = await import('@/app/api/v1/action-plan/route')
    const res = await GET(json('http://t/api/v1/action-plan', 'GET'))
    expect(res.status).toBe(402)
    expect(s.inserts).toEqual([])
  })

  it('only Point B open → only Point B tasks, the GRI plan is not read', async () => {
    s.sections.point_b = true
    const { GET } = await import('@/app/api/v1/action-plan/route')
    const body = await (await GET(json('http://t/api/v1/action-plan', 'GET'))).json()
    expect(body.data.map((i: Row) => i.id)).toEqual(['t-pb'])
    expect(s.reads).not.toContain('gri_assessments')
  })

  it('both open (Pro) → every task as before', async () => {
    s.sections = { point_a: true, point_b: true, market: true, gri_full: true }
    const { GET } = await import('@/app/api/v1/action-plan/route')
    const body = await (await GET(json('http://t/api/v1/action-plan', 'GET'))).json()
    expect(body.data.map((i: Row) => i.id).sort()).toEqual(['t-gri', 't-pb'])
  })

  it('staff reading a client (?userId, mayActOnUser) — as before, not limited by the staff member\'s own tariff', async () => {
    const { GET } = await import('@/app/api/v1/action-plan/route')
    s.tables.action_items.push({ id: 't-c', user_id: 'client-2', title: 'x', source: 'plan', status: 'open', priority: 1 })
    const res = await GET(json('http://t/api/v1/action-plan?userId=client-2', 'GET'))
    expect(res.status).toBe(200)
    expect((await res.json()).data.map((i: Row) => i.id)).toEqual(['t-c'])
  })

  it('PATCH of the owner\'s GRI task with the full GRI closed → 402, nothing written', async () => {
    s.sections.point_b = true
    const { PATCH } = await import('@/app/api/v1/action-plan/[id]/route')
    const res = await PATCH(json('http://t/api/v1/action-plan/t-gri', 'PATCH', { status: 'done' }), { params: { id: 't-gri' } })
    expect(res.status).toBe(402)
    expect(s.updates).toEqual([])
    const ok = await PATCH(json('http://t/api/v1/action-plan/t-pb', 'PATCH', { status: 'done' }), { params: { id: 't-pb' } })
    expect(ok.status).toBe(200)
  })

  it('PATCH /action-plan/tasks/[id] the same way', async () => {
    const { PATCH } = await import('@/app/api/v1/action-plan/tasks/[id]/route')
    const res = await PATCH(json('http://t/x', 'PATCH', { status: 'done' }), { params: Promise.resolve({ id: 't-gri' }) })
    expect(res.status).toBe(402)
    expect(s.updates).toEqual([])
  })
})

describe('L-1 free routes give no full-GRI / Point A results', () => {
  it('Pulse: baseline null and gri_assessments not read for Free (before: gri_index + section_avgs)', async () => {
    const { GET } = await import('@/app/api/v1/gri/pulse/route')
    const body = await (await GET()).json()
    expect(body.ok).toBe(true)
    expect(body.data.baseline).toBeNull()
    expect(s.reads).not.toContain('gri_assessments')
    s.sections.gri_full = true
    s.reads = []
    const pro = await (await GET()).json()
    expect(pro.data.baseline).toMatchObject({ gri_index: 6.5 })
  })

  it('NBA: no «main GRI limitation» and no paid plan task for Free', async () => {
    const { GET } = await import('@/app/api/v1/nba/route')
    const body = await (await GET(new NextRequest('http://t/api/v1/nba'))).json()
    expect(JSON.stringify(body)).not.toContain('ПЛАТНОЕ_ОГРАНИЧЕНИЕ')
    expect(JSON.stringify(body)).not.toContain('GRI step')
    expect(s.reads).not.toContain('gri_assessments')
  })
})

describe('H-3 /metrics loader', () => {
  it('without the full GRI: gri_assessments is not requested; with it: explicit columns (never select=*)', async () => {
    const fetchMock = vi.fn(async (url: string) => { s.fetched.push(url); return new Response('[]', { status: 200 }) })
    vi.stubGlobal('fetch', fetchMock)
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:1'
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'k'
    const { loadMetricsPageData } = await import('@/lib/metrics/page-data')
    const closed = await loadMetricsPageData('u-1', { includeGri: false })
    expect(closed.griAssessment).toBeNull()
    expect(s.fetched.some((u) => u.includes('gri_assessments'))).toBe(false)
    s.fetched = []
    await loadMetricsPageData('u-1', { includeGri: true })
    const gri = s.fetched.find((u) => u.includes('gri_assessments'))!
    expect(gri).not.toContain('select=*')
    expect(gri).not.toContain('action_plan_90d')
    vi.unstubAllGlobals()
  })

  it('the page decides with the one decision and fails closed', async () => {
    const { readFileSync } = await import('node:fs')
    const src = readFileSync('app/(dashboard)/metrics/page.tsx', 'utf8')
    expect(src).toContain('getRequestAccess(userId)')
    expect(src).toMatch(/catch[\s\S]*return false/)
  })
})

describe('M-3 ai-analyze: the direct session path is gated', () => {
  it('Free caller without the internal token → 402 before any paid call', async () => {
    const { POST } = await import('@/app/api/v1/diagnostics/ai-analyze/route')
    const res = await POST(json('http://t/api/v1/diagnostics/ai-analyze', 'POST', { diagnostic_id: 'd-1', user_id: 'u-1' }))
    expect(res.status).toBe(402)
  })
})

describe('L-3 «Сообщения» bot facts', () => {
  it('Free: «рассчитана, в платном доступе», no score, no weak blocks (before: «Точка А: 61/100», «Слабые разделы»)', async () => {
    s.tables.profiles = [{ id: 'u-1', full_name: 'Иван' }]
    s.tables.companies = [{ id: 'c-1', user_id: 'u-1', name: 'ООО' }]
    s.tables.point_a_snapshots = [{ id: 'snap', company_id: 'c-1', overall: 61, stage: 'growth', created_at: '2026-11-01', blocks: [{ title: 'Продажи', score: 31 }] }]
    s.tables.survey_answers = []
    const { loadUserFacts } = await import('@/lib/comm/bot')
    const facts = (await loadUserFacts(client() as never, 'u-1')).join('\n')
    expect(facts).toContain('в платном доступе')
    expect(facts).not.toContain('61')
    expect(facts).not.toContain('Продажи — 31')
    s.sections.point_a = true
    const pro = (await loadUserFacts(client() as never, 'u-1')).join('\n')
    expect(pro).toContain('61/100')
  })
})
