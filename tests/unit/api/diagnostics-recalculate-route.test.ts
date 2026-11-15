/**
 * POST /api/v1/diagnostics/recalculate
 *   • a company recalculates ONLY through the snapshot path; a snapshot that
 *     wrote nothing is an honest answer, never a direct v1 row WITH a score
 *     (R3-PA, B4 / R-070 — the old fallback scored an incomplete survey);
 *   • without a company the row is stored with the service role (the session
 *     client cannot UPDATE diagnostics under RLS) and WITHOUT a score;
 *   • a failed insert puts the previous current row back.
 * The session double models RLS on diagnostics: no UPDATE, INSERT own rows only.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

type Row = Record<string, unknown>
const h = vi.hoisted(() => ({
  tables: {} as Record<string, Row[]>,
  user: { id: 'client-1' } as { id: string } | null,
  role: 'client',
  failRead: null as string | null,
  failInsert: false,
  enqueued: [] as Array<Record<string, unknown>>,
  pending: [] as Array<Promise<unknown>>,
  seq: 0,
  notified: [] as Array<{ to: string; overallScore: unknown; stage?: unknown }>,
}))

function fakeClient(kind: 'session' | 'service') {
  return {
    auth: { getUser: async () => ({ data: { user: h.user }, error: null }) },
    from(table: string) {
      let op: 'select' | 'update' | 'insert' = 'select'
      let payload: Row = {}
      const filters: Array<(r: Row) => boolean> = []
      const rows = () => (h.tables[table] ?? []).filter((r) => filters.every((f) => f(r)))
      const run = async (single: boolean) => {
        if (table === 'profiles') return { data: { role: h.role }, error: null }
        if (op === 'select' && h.failRead === table) return { data: null, error: { message: 'statement timeout', code: '57014' } }
        if (op === 'update') {
          // RLS: no UPDATE policy on diagnostics for API roles → 0 rows, no error.
          if (!(kind === 'session' && table === 'diagnostics')) for (const r of rows()) Object.assign(r, payload)
          return { data: null, error: null }
        }
        if (op === 'insert') {
          if (kind === 'session' && table === 'diagnostics' && payload.user_id !== h.user?.id) {
            return { data: null, error: { message: 'new row violates row-level security policy', code: '42501' } }
          }
          if (h.failInsert) return { data: null, error: { message: 'check violation', code: '23514' } }
          const row = { id: `diag-${++h.seq}`, ...payload }
          ;(h.tables[table] ??= []).push(row)
          return { data: row, error: null }
        }
        const found = rows()
        return single ? { data: found[0] ?? null, error: null } : { data: found, error: null }
      }
      const b: Record<string, unknown> = {
        select: () => b,
        update: (p: Row) => { op = 'update'; payload = p; return b },
        insert: (p: Row) => { op = 'insert'; payload = p; return b },
        eq: (c: string, v: unknown) => { filters.push((r) => r[c] === v); return b },
        in: (c: string, v: unknown[]) => { filters.push((r) => v.includes(r[c])); return b },
        order: () => b,
        maybeSingle: () => run(true),
        single: () => run(true),
        then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => run(false).then(res, rej),
      }
      return b
    },
  }
}

vi.mock('@/lib/supabase-server', () => ({ createServerClient: () => fakeClient('session') }))
vi.mock('@/lib/supabase-service', () => ({ createServiceClient: () => fakeClient('service') }))
vi.mock('@/lib/rate-limit', () => ({ isRateLimitedKey: async () => false }))
// The staff session in this test passed its second factor (R-005 rules: tests/unit/api/api-identity-staff-stepup.test.ts).
vi.mock('@/lib/mfa/api-staff-gate', () => ({ staffApiSecondFactor: async () => 'ok' }))
// The staff member is a staff_roles admin (migration 140 rule — tests/unit/access/actor-scope-routes.test.ts).
vi.mock('@/lib/access/actor', async () => {
  const real = await vi.importActual<typeof import('@/lib/access/actor')>('@/lib/access/actor')
  return { ...real, resolveActor: async (id: string) => real.actorFromRows(id, { profile: { role: 'admin', status: 'approved' }, staff: { role: 'admin' } }) }
})
vi.mock('@/lib/notifications', () => ({ notifyAdmins: (_k: string, p: { overallScore: unknown; stage?: unknown }) => { h.notified.push({ to: 'admins', overallScore: p.overallScore, stage: p.stage }) } }))
vi.mock('@/lib/notifications/product', () => ({ notifyPointARecalculated: async (_u: string, p: { overallScore: unknown }) => { h.notified.push({ to: 'client', overallScore: p.overallScore }) } }))
vi.mock('@/lib/events/track', () => ({ trackEvent: async () => undefined }))
vi.mock('@/lib/background', () => ({ runInBackground: (_l: string, work: () => Promise<unknown>) => { const p = work(); h.pending.push(p); return p } }))
vi.mock('@/lib/agents/queue', () => ({ enqueueAgentTask: async (t: Record<string, unknown>) => { h.enqueued.push(t); return { id: 't1' } } }))
// The snapshot path (lib/point-a/snapshot.ts) has its own tests; here it is
// «before migration 111» unless a test switches it on — the direct path below.
const snap = vi.hoisted(() => ({ result: { status: 'skipped', reason: 'not_migrated' } as Record<string, unknown>, calls: [] as unknown[][], throws: false }))
vi.mock('@/lib/point-a/snapshot', () => ({ buildPointASnapshot: async (...args: unknown[]) => { snap.calls.push(args); if (snap.throws) throw new Error('boom'); return snap.result } }))

const { POST } = await import('@/app/api/v1/diagnostics/recalculate/route')

const post = (body: Row = {}) => POST(new NextRequest('http://localhost/api/v1/diagnostics/recalculate', {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
}))
const current = () => (h.tables.diagnostics ?? []).filter((r) => r.is_current === true)

beforeEach(() => {
  delete process.env.OPENROUTER_API_KEY
  h.user = { id: 'client-1' }
  h.role = 'client'
  h.failRead = null
  h.failInsert = false
  h.enqueued = []
  h.pending = []
  h.seq = 0
  snap.result = { status: 'skipped', reason: 'not_migrated' }
  snap.calls = []
  snap.throws = false
  h.notified = []
  h.tables = {
    survey_answers: [{ user_id: 'client-1', question_key: 's2_revenue_2025', answer: { value: 95_000_000 } }],
    companies: [{ id: 'co-1', user_id: 'client-1' }],
    metrics: [],
    diagnostics: [{ id: 'diag-old', user_id: 'client-1', company_id: 'co-1', is_current: true }],
  }
})

describe('POST /api/v1/diagnostics/recalculate', () => {
  it('a company recalculates through the snapshot path (forced, manual) and answers with its diagnostic', async () => {
    snap.result = { status: 'written', snapshotId: 's1', diagnosticId: 'diag-v4', diagnostic: { id: 'diag-v4' }, engine: 'v4', written: { overall_score: 61, stage: 'early' }, v4: {}, changes: [] }
    const res = await post()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data).toMatchObject({ diagnostic: { id: 'diag-v4' }, point_a: { overall_score: 61 }, snapshot_id: 's1', engine: 'v4' })
    expect(snap.calls[0][0]).toBe('co-1')
    expect(snap.calls[0][1]).toMatchObject({ trigger: 'manual', force: true })
    // the direct path did not run
    expect(current().map((r) => r.id)).toEqual(['diag-old'])
  })

  // R3-PA (B4, R-070): the snapshot wrote nothing → no direct v1 calculation for a company.
  it('a company whose snapshot wrote nothing gets an honest answer and NO v1 row with a score', async () => {
    process.env.OPENROUTER_API_KEY = 'k'
    const fetchMock = vi.fn(async () => new Response('{}'))
    vi.stubGlobal('fetch', fetchMock)
    try {
      for (const [reason, status] of [['no_answers', 422], ['not_migrated', 503], ['no_owner', 422], ['busy', 409]] as const) {
        snap.result = { status: 'skipped', reason }
        const res = await post()
        expect(res.status, reason).toBe(status)
        const body = await res.json()
        expect(body, reason).toMatchObject({ ok: false, reason })
        expect(body.error, reason).toMatch(/[а-яё]/i)
      }
      // the current row stays, nothing scored was written, no paid call, no notification
      expect(h.tables.diagnostics.map((r) => r.id)).toEqual(['diag-old'])
      expect(current().map((r) => r.id)).toEqual(['diag-old'])
      expect(fetchMock).not.toHaveBeenCalled()
      expect(h.notified).toEqual([])
      expect(h.enqueued).toEqual([])
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('an unchanged snapshot is a success without a new row', async () => {
    snap.result = { status: 'unchanged', snapshotId: 's0' }
    const res = await post()
    expect(res.status).toBe(200)
    expect((await res.json()).data).toEqual({ unchanged: true, snapshot_id: 's0' })
    expect(h.tables.diagnostics).toHaveLength(1)
  })

  it('without a company a repeated recalculation leaves exactly one current diagnostic', async () => {
    h.tables.companies = []
    expect((await post()).status).toBe(200)
    expect((await post()).status).toBe(200)
    expect(current().map((r) => r.id)).toEqual(['diag-2'])
    expect(h.tables.diagnostics.find((r) => r.id === 'diag-old')?.is_current).toBe(false)
  })

  it('staff can recalculate for a client: the client\'s company goes through the snapshot path', async () => {
    h.user = { id: 'staff-1' }
    h.role = 'expert'
    snap.result = { status: 'written', snapshotId: 's1', diagnosticId: 'diag-v4', diagnostic: { id: 'diag-v4' }, engine: 'v4', assessment: 'full', scored: true, written: { overall_score: 61, stage: 'early' }, v4: {}, changes: [] }
    const res = await post({ user_id: 'client-1' })
    await Promise.all(h.pending)
    expect(res.status).toBe(200)
    expect(snap.calls[0][0]).toBe('co-1')
  })

  it('without a company: a failed insert puts the previous current row back', async () => {
    h.tables.companies = []
    h.failInsert = true
    const res = await post()
    expect(res.status).toBe(500)
    expect(current().map((r) => r.id)).toEqual(['diag-old'])
  })

  it('a failed company read is a 500, not «no company»', async () => {
    h.failRead = 'companies'
    expect((await post()).status).toBe(500)
    expect(current().map((r) => r.id)).toEqual(['diag-old'])
  })

  // I2 (R-033): no official score → no number anywhere.
  it('snapshot written WITHOUT an official score (scored: false) → no point_a and no score in the notifications', async () => {
    snap.result = { status: 'written', snapshotId: 's1', diagnosticId: 'diag-v1', diagnostic: { id: 'diag-v1' }, engine: 'v1', assessment: 'full', scored: false, written: { overall_score: 31, stage: 'seed' }, v4: {}, changes: [] }
    const res = await post()
    await Promise.all(h.pending)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data.point_a).toBeNull()
    expect(body.data.scored).toBe(false)
    expect(h.notified).toHaveLength(2)
    expect(h.notified).toEqual(expect.arrayContaining([{ to: 'client', overallScore: null }, { to: 'admins', overallScore: null, stage: null }]))
  })

  it('a scored snapshot tells its score', async () => {
    snap.result = { status: 'written', snapshotId: 's1', diagnosticId: 'diag-v4', diagnostic: { id: 'diag-v4' }, engine: 'v4', assessment: 'full', scored: true, written: { overall_score: 61, stage: 'early' }, v4: {}, changes: [] }
    await post()
    await Promise.all(h.pending)
    expect(h.notified.map((n) => n.overallScore)).toEqual([61, 61])
  })

  it('a failed snapshot is a 503 and the current diagnostic stays (no v1 recalculation)', async () => {
    snap.throws = true
    const res = await post()
    expect(res.status).toBe(503)
    expect(current().map((r) => r.id)).toEqual(['diag-old'])
    expect(h.tables.diagnostics).toHaveLength(1)
  })

  it('no company → the row is stored without a score, no fan-out, no score in the notifications', async () => {
    h.tables.companies = []
    process.env.OPENROUTER_API_KEY = 'k'
    process.env.NEXT_PUBLIC_APP_URL = 'https://app.example.kz'
    const fetchMock = vi.fn(async () => new Response('{}'))
    vi.stubGlobal('fetch', fetchMock)
    try {
      const res = await post()
      await Promise.all(h.pending)
      expect(res.status).toBe(200)
      expect((await res.json()).data.point_a).toBeNull()
      expect(current()[0]).toMatchObject({ overall_score: null, stage: null, finance_score: null, ai_status: 'none' })
      expect(fetchMock).not.toHaveBeenCalled()
      expect(h.notified.every((n) => n.overallScore === null)).toBe(true)
    } finally {
      vi.unstubAllGlobals()
      delete process.env.NEXT_PUBLIC_APP_URL
    }
  })
})
