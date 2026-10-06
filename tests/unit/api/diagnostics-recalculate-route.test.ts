/**
 * POST /api/v1/diagnostics/recalculate
 *   • retires the previous current diagnostic and inserts the new one with the
 *     service role (the session client cannot UPDATE diagnostics under RLS, so
 *     every recalculation used to add another is_current=true row; a staff
 *     insert for a client was rejected by diagnostics_insert_own);
 *   • a failed read of the document/manual metric inputs is a 500 that keeps
 *     the current diagnostic, not a survey-only score;
 *   • a failed insert puts the previous current row back;
 *   • the pipeline task is attributed to the caller, not the client.
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
vi.mock('@/lib/notifications', () => ({ notifyAdmins: () => undefined }))
vi.mock('@/lib/events/track', () => ({ trackEvent: async () => undefined }))
vi.mock('@/lib/background', () => ({ runInBackground: (_l: string, work: () => Promise<unknown>) => { const p = work(); h.pending.push(p); return p } }))
vi.mock('@/lib/agents/queue', () => ({ enqueueAgentTask: async (t: Record<string, unknown>) => { h.enqueued.push(t); return { id: 't1' } } }))

const { POST } = await import('@/app/api/v1/diagnostics/recalculate/route')
const { verifyInternalToken, INTERNAL_TOKEN_HEADER } = await import('@/lib/internal-auth')

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
  h.tables = {
    survey_answers: [{ user_id: 'client-1', question_key: 's2_revenue_2025', answer: { value: 95_000_000 } }],
    companies: [{ id: 'co-1', user_id: 'client-1' }],
    metrics: [],
    diagnostics: [{ id: 'diag-old', user_id: 'client-1', company_id: 'co-1', is_current: true }],
  }
})

describe('POST /api/v1/diagnostics/recalculate', () => {
  it('a repeated recalculation leaves exactly one current diagnostic', async () => {
    expect((await post()).status).toBe(200)
    expect((await post()).status).toBe(200)
    expect(current().map((r) => r.id)).toEqual(['diag-2'])
    expect(h.tables.diagnostics.find((r) => r.id === 'diag-old')?.is_current).toBe(false)
  })

  it('staff can recalculate for a client; the task is attributed to the staff member', async () => {
    h.user = { id: 'staff-1' }
    h.role = 'expert'
    const res = await post({ user_id: 'client-1' })
    await Promise.all(h.pending)
    expect(res.status).toBe(200)
    expect(current()).toHaveLength(1)
    expect(current()[0]).toMatchObject({ user_id: 'client-1', company_id: 'co-1' })
    expect(h.enqueued).toHaveLength(1)
    expect(h.enqueued[0].requestedBy).toBe('user:staff-1')
  })

  it('a failed read of the metric inputs is a 500 and the current diagnostic stays', async () => {
    h.failRead = 'metrics'
    const res = await post()
    expect(res.status).toBe(500)
    expect(current().map((r) => r.id)).toEqual(['diag-old'])
    expect(h.tables.diagnostics).toHaveLength(1)
  })

  it('a failed insert puts the previous current row back', async () => {
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

  it('AI fan-out: configured base URL (not the request Host) and tokens bound to path, user and diagnostic', async () => {
    process.env.OPENROUTER_API_KEY = 'k'
    process.env.INTERNAL_TOKEN_SECRET = 'test-internal-secret'
    process.env.NEXT_PUBLIC_APP_URL = 'https://app.example.kz'
    const sent: Array<{ url: string; headers: Record<string, string> }> = []
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: { headers: Record<string, string> }) => { sent.push({ url, headers: init.headers }); return new Response('{}') }))
    try {
      const res = await POST(new NextRequest('http://evil.host/api/v1/diagnostics/recalculate', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
      }))
      expect(res.status).toBe(200)
      const diagId = current()[0].id as string
      expect(sent.map((s) => s.url)).toEqual([
        'https://app.example.kz/api/v1/diagnostics/ai-analyze',
        'https://app.example.kz/api/v1/diagnostics/point-b/ai-generate',
      ])
      const token = sent[0].headers[INTERNAL_TOKEN_HEADER]
      expect(verifyInternalToken(token, { path: '/api/v1/diagnostics/ai-analyze', userId: 'client-1', diagnosticId: diagId })).toBe(true)
      expect(verifyInternalToken(token, { path: '/api/v1/diagnostics/ai-analyze', userId: 'client-1', diagnosticId: 'other-diag' })).toBe(false)
      expect(verifyInternalToken(token, { path: '/api/v1/diagnostics/point-b/ai-generate', userId: 'client-1', diagnosticId: diagId })).toBe(false)
    } finally {
      vi.unstubAllGlobals()
      delete process.env.NEXT_PUBLIC_APP_URL
      delete process.env.INTERNAL_TOKEN_SECRET
    }
  })

  it('no trusted base URL in production → no fan-out (the token never goes to the request Host)', async () => {
    process.env.OPENROUTER_API_KEY = 'k'
    process.env.INTERNAL_TOKEN_SECRET = 'test-internal-secret'
    vi.stubEnv('NODE_ENV', 'production')
    const fetchMock = vi.fn(async () => new Response('{}'))
    vi.stubGlobal('fetch', fetchMock)
    try {
      expect((await post()).status).toBe(200)
      expect(fetchMock).not.toHaveBeenCalled()
    } finally {
      vi.unstubAllGlobals()
      vi.unstubAllEnvs()
      delete process.env.INTERNAL_TOKEN_SECRET
    }
  })
})
