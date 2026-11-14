/**
 * R-053 (а): POST /api/client/register — identity only from the session,
 * idempotent, failures not swallowed, body through Zod (.strict()).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

type Row = Record<string, unknown>

const h = vi.hoisted(() => ({
  user: { id: 'u-1', email: 'real@corp.kz' } as { id: string; email?: string } | null,
  profiles: [] as Row[],
  companies: [] as Row[],
  requests: [] as Row[],
  notify: vi.fn(async (..._a: unknown[]) => {}),
  failProfileUpsert: false,
  failCompanyInsert: null as null | { code: string; message: string },
  prismaDown: false,
  fallbackError: null as null | { code: string; message: string },
}))

vi.mock('@/lib/notifications', () => ({ notifyAdmins: h.notify }))
vi.mock('@/lib/background', () => ({ runInBackground: async (_l: string, work: () => Promise<unknown>) => { await work() } }))
vi.mock('@/lib/rate-limit', () => ({
  isRateLimitedKey: async () => false,
  checkRateLimitForRequest: async () => ({ limited: false }),
  rateLimitResponse: () => new Response(null, { status: 429 }),
}))
vi.mock('@/lib/db', () => ({
  prisma: {
    adminRequest: {
      findFirst: async ({ where }: { where: { type: string; payload: { path: string[]; equals: string } } }) => {
        if (h.prismaDown) throw new Error('prisma down')
        return h.requests.find((r) => r.type === where.type && (r.payload as Row).userId === where.payload.equals) ?? null
      },
      create: async ({ data }: { data: Row }) => {
        if (h.prismaDown) throw new Error('prisma down')
        const row = { id: `req-${h.requests.length + 1}`, ...data }
        h.requests.push(row)
        return row
      },
    },
  },
}))

/** A tiny PostgREST-like builder over the arrays above. */
function table(name: string) {
  const rows = () => (name === 'profiles' ? h.profiles : name === 'companies' ? h.companies : h.requests)
  const filters: Array<(r: Row) => boolean> = []
  const q = {
    select: () => q,
    eq: (col: string, v: unknown) => {
      filters.push((r) => (col === 'payload->>userId' ? (r.payload as Row)?.userId === v : r[col] === v))
      return q
    },
    limit: () => q,
    maybeSingle: async () => ({ data: rows().find((r) => filters.every((f) => f(r))) ?? null, error: null }),
    upsert: async (row: Row) => {
      if (name === 'profiles' && h.failProfileUpsert) return { error: { code: '42501', message: 'denied' } }
      const existing = rows().find((r) => r.id === row.id)
      if (existing) Object.assign(existing, row)
      else rows().push({ status: 'pending_approval', ...row })
      return { error: null }
    },
    insert: async (row: Row) => {
      if (name === 'companies' && h.failCompanyInsert) return { error: h.failCompanyInsert }
      if (name === 'admin_requests' && h.fallbackError) return { error: h.fallbackError }
      rows().push(row)
      return { error: null }
    },
  }
  return q
}

vi.mock('@/lib/supabase-server', () => ({
  createServerClient: () => ({ auth: { getUser: async () => ({ data: { user: h.user } }) }, from: table }),
}))
vi.mock('@/lib/supabase-service', () => ({ createServiceClient: () => ({ from: table }) }))

const { POST } = await import('@/app/api/client/register/route')

const call = async (body: unknown) => {
  const res = await POST(new NextRequest('http://localhost/api/client/register', {
    method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' },
  }))
  return { status: res.status, body: await res.json().catch(() => null) }
}
const legit = { userId: 'u-1', email: 'real@corp.kz', name: 'Айдар', company: 'ТОО Ромашка' }

beforeEach(() => {
  h.user = { id: 'u-1', email: 'real@corp.kz' }
  h.profiles = [{ id: 'u-1', status: 'pending_approval', email: 'real@corp.kz' }]
  h.companies = []
  h.requests = []
  h.notify.mockClear()
  h.failProfileUpsert = false
  h.failCompanyInsert = null
  h.prismaDown = false
  h.fallbackError = null
})

describe('R-053 POST /api/client/register', () => {
  it('the legitimate first call: profile, one company, one request, one notification → 201', async () => {
    const r = await call(legit)
    expect(r.status).toBe(201)
    expect(r.body).toMatchObject({ ok: true, requestId: 'req-1' })
    expect(h.companies).toEqual([{ user_id: 'u-1', name: 'ТОО Ромашка' }])
    expect(h.requests).toHaveLength(1)
    expect(h.notify).toHaveBeenCalledTimes(1)
  })

  it('R-053: the e-mail comes from the session, never from the body', async () => {
    const r = await call({ ...legit, email: 'attacker@evil.example' })
    expect(r.status).toBe(201)
    expect(h.profiles[0].email).toBe('real@corp.kz')
    expect((h.requests[0].payload as Row).email).toBe('real@corp.kz')
    expect(JSON.stringify(h.notify.mock.calls)).not.toContain('attacker@evil.example')
  })

  it('R-053: the id comes from the session; a foreign userId is a 403, no userId is fine', async () => {
    expect((await call({ ...legit, userId: 'u-2' })).status).toBe(403)
    expect(h.requests).toHaveLength(0)
    const { userId: _drop, ...noId } = legit
    void _drop
    expect((await call(noId)).status).toBe(201)
    expect(h.companies[0].user_id).toBe('u-1')
  })

  it('R-053: a repeated call creates no second company, request or notification', async () => {
    const first = await call(legit)
    const second = await call(legit)
    const third = await call({ ...legit, company: 'ТОО Другая' })
    expect(first.status).toBe(201)
    expect(second.status).toBe(200)
    expect(second.body).toMatchObject({ ok: true, requestId: first.body.requestId, existing: true })
    expect(third.status).toBe(200)
    expect(h.companies).toHaveLength(1)
    expect(h.requests).toHaveLength(1)
    expect(h.notify).toHaveBeenCalledTimes(1)
  })

  it('R-053: a parallel insert of the same company (23505) is the same company, not an error', async () => {
    h.failCompanyInsert = { code: '23505', message: 'duplicate key' }
    const r = await call(legit)
    expect(r.status).toBe(201)
  })

  it('R-053: write failures are errors, not a silent 201', async () => {
    h.failProfileUpsert = true
    expect((await call(legit)).status).toBe(500)

    h.failProfileUpsert = false
    h.failCompanyInsert = { code: '42501', message: 'rls' }
    expect((await call(legit)).status).toBe(500)

    h.failCompanyInsert = null
    h.prismaDown = true
    h.fallbackError = { code: '42703', message: 'column does not exist' }
    const r = await call(legit)
    expect(r.status).toBe(500)
    expect(r.body).toMatchObject({ ok: false, code: 'DB_ERROR' })
    expect(h.notify).not.toHaveBeenCalled()
  })

  it('R-053: the Supabase fallback writes the Prisma (camelCase) columns', async () => {
    h.prismaDown = true
    const r = await call(legit)
    expect(r.status).toBe(201)
    expect(h.requests).toHaveLength(1)
    expect(h.requests[0]).toHaveProperty('createdAt')
    expect(h.requests[0]).not.toHaveProperty('created_at')
  })

  it('R-149: the body is validated (.strict(), types, lengths) → 400 invalid_body', async () => {
    for (const bad of [
      { ...legit, role: 'super_admin' },
      { ...legit, status: 'approved' },
      { ...legit, name: 'x'.repeat(121) },
      { ...legit, company: { $ne: '' } },
      [legit],
      null,
    ]) {
      const r = await call(bad)
      expect(r.status, JSON.stringify(bad)).toBe(400)
      expect(r.body).toMatchObject({ ok: false, code: 'invalid_body' })
    }
    expect(h.requests).toHaveLength(0)
    expect(h.companies).toHaveLength(0)
  })

  it('OPEN mode (already approved): no request; a repeat does not notify twice', async () => {
    h.profiles[0].status = 'approved'
    const first = await call(legit)
    const second = await call(legit)
    expect(first.status).toBe(201)
    expect(first.body.requestId).toBeNull()
    expect(second.status).toBe(200)
    expect(h.requests).toHaveLength(0)
    expect(h.notify).toHaveBeenCalledTimes(1)
  })

  it('no session → 401', async () => {
    h.user = null
    expect((await call(legit)).status).toBe(401)
  })
})
