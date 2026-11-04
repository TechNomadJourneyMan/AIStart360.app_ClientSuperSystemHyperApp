/**
 * Dev-tools API: only Super Admin (devtools.use), audit before every change,
 * migration 120 missing → clear 409 and nothing created, test-account actions
 * never touch a live (non-test) account, leaving «как роль» always works.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import type { StaffRole } from '@/lib/admin/rbac'

process.env.AUTH_SECRET = 'test-auth-secret-for-devtools-routes-0123'

type Op = { table: string; kind: 'select' | 'insert' | 'upsert' | 'update' | 'delete'; payload?: unknown; filters: Array<[string, unknown]> }
type Result = { data?: unknown; error?: { code?: string; message: string } | null; count?: number }

const state = vi.hoisted(() => ({
  role: 'super_admin' as string,
  touched: 0,
  log: [] as string[],
  ops: [] as Array<{ table: string; kind: string; payload?: unknown; filters: Array<[string, unknown]> }>,
  handler: (() => ({ data: null, error: null })) as (op: { table: string; kind: string; payload?: unknown; filters: Array<[string, unknown]> }) => { data?: unknown; error?: { code?: string; message: string } | null; count?: number },
  createUser: vi.fn(),
  updateUserById: vi.fn(),
  deleteUser: vi.fn(),
  purgeUser: vi.fn(),
  audits: [] as Array<{ action: string; required: boolean }>,
}))

function builder(table: string) {
  const op: Op = { table, kind: 'select', filters: [] }
  const run = async (): Promise<Result> => {
    state.ops.push(op)
    state.log.push(`db:${table}:${op.kind}`)
    return state.handler(op)
  }
  const b: Record<string, unknown> = {}
  const self = () => b
  Object.assign(b, {
    select: self,
    insert: (p: unknown) => { op.kind = 'insert'; op.payload = p; return b },
    upsert: (p: unknown) => { op.kind = 'upsert'; op.payload = p; return b },
    update: (p: unknown) => { op.kind = 'update'; op.payload = p; return b },
    delete: () => { op.kind = 'delete'; return b },
    eq: (c: string, v: unknown) => { op.filters.push([c, v]); return b },
    in: (c: string, v: unknown) => { op.filters.push([c, v]); return b },
    is: self, gt: self, order: self, limit: self,
    maybeSingle: run,
    single: run,
    then: (res: (r: Result) => unknown, rej: (e: unknown) => unknown) => run().then(res, rej),
  })
  return b
}

vi.mock('@/lib/admin/giga-actor', async () => {
  const { makeRequireGiga } = await import('../_giga-guard')
  const actual = await vi.importActual<typeof import('@/lib/admin/giga-actor')>('@/lib/admin/giga-actor')
  return {
    requireGiga: makeRequireGiga(() => ({ id: 'aaaaaaaa-0000-4000-8000-000000000001', kind: 'session', role: state.role as StaffRole, email: 'owner@example.com' })),
    isSameOriginMutation: actual.isSameOriginMutation,
    STAFF_COOKIE_NAME: 'x',
  }
})
vi.mock('@/lib/supabase-service', () => ({
  createServiceClient: () => {
    state.touched++
    return {
      from: (t: string) => builder(t),
      auth: { admin: {
        createUser: async (a: unknown) => { state.log.push('auth:createUser'); return state.createUser(a) },
        updateUserById: async (...a: unknown[]) => state.updateUserById(...a),
        deleteUser: async (...a: unknown[]) => state.deleteUser(...a),
      } },
    }
  },
}))
vi.mock('@/lib/admin/audit', () => ({
  recordAdminAction: async (_a: unknown, e: { action: string }, _r: unknown, o?: { required?: boolean }) => {
    state.audits.push({ action: e.action, required: !!o?.required })
    state.log.push(`audit:${e.action}`)
    return true
  },
}))
vi.mock('@/lib/admin/purge-user', () => ({
  purgeUser: (...a: unknown[]) => state.purgeUser(...a),
  purgeTargetBlock: () => null,
}))
vi.mock('@/lib/rate-limit', () => ({ isRateLimitedKey: async () => false }))
vi.mock('@/lib/notifications/create', () => ({ createNotification: async () => { state.touched++; return true } }))
vi.mock('@/lib/email/send', () => ({ sendTransactionalEmail: async () => { state.touched++; return { ok: true, skipped: true } } }))
vi.mock('@/lib/settings/store', () => ({ getSetting: async () => false, getAllSettings: async () => { state.touched++; return { values: {}, meta: {} } } }))

const viewAs = await import('@/app/api/giga-admin/dev-tools/view-as/route')
const accounts = await import('@/app/api/giga-admin/dev-tools/test-accounts/route')
const account = await import('@/app/api/giga-admin/dev-tools/test-accounts/[id]/route')
const diagnostics = await import('@/app/api/giga-admin/dev-tools/diagnostics/route')
const endAll = await import('@/app/api/giga-admin/dev-tools/impersonation/end-all/route')
const notify = await import('@/app/api/giga-admin/dev-tools/test-notification/route')
const email = await import('@/app/api/giga-admin/dev-tools/test-email/route')
const settings = await import('@/app/api/giga-admin/dev-tools/settings/route')
const { VIEW_AS_COOKIE_NAME, signViewAs } = await import('@/lib/devtools/view-as')

const UID = '11111111-2222-4333-8444-555555555555'
const req = (url: string, method: string, body?: unknown, cookie?: string) =>
  new NextRequest(`http://localhost${url}`, {
    method,
    headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  })

beforeEach(() => {
  state.role = 'super_admin'
  state.touched = 0
  state.log = []
  state.ops = []
  state.audits = []
  state.handler = () => ({ data: null, error: null })
  state.createUser.mockReset()
  state.updateUserById.mockReset().mockResolvedValue({ data: {}, error: null })
  state.deleteUser.mockReset().mockResolvedValue({ data: {}, error: null })
  state.purgeUser.mockReset().mockResolvedValue({ ok: true, counts: {}, filesFailed: 0 })
})

describe('Dev-tools routes are Super Admin only', () => {
  const calls: Array<[string, () => Promise<Response>]> = [
    ['view-as GET', () => viewAs.GET(req('/api/giga-admin/dev-tools/view-as', 'GET'))],
    ['view-as POST', () => viewAs.POST(req('/api/giga-admin/dev-tools/view-as', 'POST', { role: 'analyst' }))],
    ['test-accounts GET', () => accounts.GET(req('/api/giga-admin/dev-tools/test-accounts', 'GET'))],
    ['test-accounts POST', () => accounts.POST(req('/api/giga-admin/dev-tools/test-accounts', 'POST', { kind: 'client' }))],
    ['test-accounts DELETE all', () => accounts.DELETE(req('/api/giga-admin/dev-tools/test-accounts', 'DELETE', { confirm: 'УДАЛИТЬ' }))],
    ['test-account PATCH', () => account.PATCH(req(`/api/giga-admin/dev-tools/test-accounts/${UID}`, 'PATCH', { status: 'blocked' }), { params: { id: UID } })],
    ['test-account DELETE', () => account.DELETE(req(`/api/giga-admin/dev-tools/test-accounts/${UID}`, 'DELETE'), { params: { id: UID } })],
    ['diagnostics', () => diagnostics.GET(req('/api/giga-admin/dev-tools/diagnostics', 'GET'))],
    ['impersonation end-all', () => endAll.POST(req('/api/giga-admin/dev-tools/impersonation/end-all', 'POST', {}))],
    ['test notification', () => notify.POST(req('/api/giga-admin/dev-tools/test-notification', 'POST', {}))],
    ['test e-mail', () => email.POST(req('/api/giga-admin/dev-tools/test-email', 'POST', { template: 'gri' }))],
    ['settings snapshot', () => settings.GET(req('/api/giga-admin/dev-tools/settings', 'GET'))],
  ]
  for (const [name, call] of calls) {
    it(`${name}: 403 for every role but super_admin, before any read or write`, async () => {
      for (const role of ['admin', 'super_expert', 'crm_manager', 'content_manager', 'analyst', 'support']) {
        state.role = role
        expect((await call()).status, `${name} as ${role}`).toBe(403)
      }
      expect(state.touched).toBe(0)
      expect(state.audits).toEqual([])
      expect(state.createUser).not.toHaveBeenCalled()
      expect(state.purgeUser).not.toHaveBeenCalled()
    })
  }
})

describe('view-as', () => {
  it('starts only for a staff role below super_admin, audited (required), with an httpOnly cookie', async () => {
    expect((await viewAs.POST(req('/api/giga-admin/dev-tools/view-as', 'POST', { role: 'super_admin' }))).status).toBe(400)
    expect(state.audits).toEqual([])
    const res = await viewAs.POST(req('/api/giga-admin/dev-tools/view-as', 'POST', { role: 'analyst' }))
    expect(res.status).toBe(200)
    expect(state.audits).toEqual([{ action: 'devtools.view_as_started', required: true }])
    const setCookie = res.headers.get('set-cookie') ?? ''
    expect(setCookie).toContain(`${VIEW_AS_COOKIE_NAME}=`)
    expect(setCookie.toLowerCase()).toContain('httponly')
  })

  it('exit always clears the cookie — even when the caller is not (or no longer) super_admin', async () => {
    state.role = 'support'
    const cookie = `${VIEW_AS_COOKIE_NAME}=${await signViewAs('aaaaaaaa-0000-4000-8000-000000000001', 'analyst')}`
    const res = await viewAs.DELETE(req('/api/giga-admin/dev-tools/view-as', 'DELETE', undefined, cookie))
    expect(res.status).toBe(200)
    expect(res.headers.get('set-cookie')).toMatch(new RegExp(`${VIEW_AS_COOKIE_NAME}=;.*Max-Age=0`, 'i'))
    expect(state.audits).toEqual([])
  })

  it('exit by super_admin is audited', async () => {
    const cookie = `${VIEW_AS_COOKIE_NAME}=${await signViewAs('aaaaaaaa-0000-4000-8000-000000000001', 'analyst')}`
    const res = await viewAs.DELETE(req('/api/giga-admin/dev-tools/view-as', 'DELETE', undefined, cookie))
    expect(res.status).toBe(200)
    expect(state.audits.map((a) => a.action)).toEqual(['devtools.view_as_stopped'])
  })

  it('cross-site exit is refused', async () => {
    const evil = new NextRequest('http://localhost/api/giga-admin/dev-tools/view-as', { method: 'DELETE', headers: { origin: 'https://evil.example', host: 'localhost' } })
    expect((await viewAs.DELETE(evil)).status).toBe(403)
  })
})

describe('test accounts', () => {
  it('migration 120 missing: 409 with a clear message, nothing created, nothing journaled', async () => {
    state.handler = (op) => (op.table === 'profiles' ? { data: null, error: { code: '42703', message: 'column profiles.is_test does not exist' } } : { data: null, error: null })
    const res = await accounts.POST(req('/api/giga-admin/dev-tools/test-accounts', 'POST', { kind: 'client' }))
    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.error).toMatch(/миграцию 120/)
    expect(state.createUser).not.toHaveBeenCalled()
    expect(state.audits).toEqual([])
    const list = await (await accounts.GET(req('/api/giga-admin/dev-tools/test-accounts', 'GET'))).json()
    expect(list).toMatchObject({ ok: true, migrationRequired: true, data: [] })
  })

  it('creates a staff test account: journal first, then auth user, profile is_test, staff role', async () => {
    state.createUser.mockImplementation(async (a: { id: string }) => ({ data: { user: { id: a.id } }, error: null }))
    state.handler = (op) => {
      if (op.table === 'profiles' && op.kind === 'upsert') return { data: [{ id: (op.payload as { id: string }).id }], error: null }
      return { data: null, error: null, count: 0 }
    }
    const res = await accounts.POST(req('/api/giga-admin/dev-tools/test-accounts', 'POST', { kind: 'crm-manager' }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data.email).toMatch(/^crm-manager\.[a-z0-9]{8}@test\.aistart360\.app$/)
    expect(body.data.password.length).toBeGreaterThanOrEqual(20)

    expect(state.log.indexOf('audit:devtools.test_account_created')).toBeLessThan(state.log.indexOf('auth:createUser'))
    expect(state.audits[0]).toEqual({ action: 'devtools.test_account_created', required: true })
    const created = state.createUser.mock.calls[0][0] as { email_confirm: boolean; app_metadata: Record<string, unknown> }
    expect(created.email_confirm).toBe(true)
    expect(created.app_metadata).toMatchObject({ role: 'client', status: 'approved', is_test: true })

    const profile = state.ops.find((o) => o.table === 'profiles' && o.kind === 'upsert')?.payload as Record<string, unknown>
    expect(profile).toMatchObject({ is_test: true, role: 'client', status: 'approved' })
    const staff = state.ops.find((o) => o.table === 'staff_roles' && o.kind === 'upsert')?.payload as Record<string, unknown>
    expect(staff).toMatchObject({ role: 'crm_manager' })
  })

  it('a failed profile write rolls the half-created account back', async () => {
    state.createUser.mockImplementation(async (a: { id: string }) => ({ data: { user: { id: a.id } }, error: null }))
    state.handler = (op) => (op.table === 'profiles' && op.kind === 'upsert'
      ? { data: null, error: { code: '23514', message: 'violates check constraint' } }
      : { data: null, error: null, count: 0 })
    const res = await accounts.POST(req('/api/giga-admin/dev-tools/test-accounts', 'POST', { kind: 'client-blocked' }))
    expect(res.status).toBe(500)
    expect(state.purgeUser).toHaveBeenCalledTimes(1)
    expect(state.audits.map((a) => a.action)).toContain('devtools.test_account_create_failed')
  })

  it('status change / delete refuse an account that is not marked as test', async () => {
    state.handler = (op) => (op.table === 'profiles'
      ? { data: { id: UID, email: 'real@client.kz', role: 'client', status: 'approved', is_test: false }, error: null }
      : { data: null, error: null })
    expect((await account.PATCH(req(`/api/giga-admin/dev-tools/test-accounts/${UID}`, 'PATCH', { status: 'blocked' }), { params: { id: UID } })).status).toBe(403)
    expect((await account.DELETE(req(`/api/giga-admin/dev-tools/test-accounts/${UID}`, 'DELETE'), { params: { id: UID } })).status).toBe(403)
    expect(state.audits).toEqual([])
    expect(state.purgeUser).not.toHaveBeenCalled()
  })

  it('delete refuses a test-marked account outside the test e-mail domain', async () => {
    state.handler = (op) => (op.table === 'profiles'
      ? { data: { id: UID, email: 'real@client.kz', role: 'client', status: 'approved', is_test: true }, error: null }
      : { data: null, error: null })
    expect((await account.DELETE(req(`/api/giga-admin/dev-tools/test-accounts/${UID}`, 'DELETE'), { params: { id: UID } })).status).toBe(403)
    expect(state.purgeUser).not.toHaveBeenCalled()
  })

  it('delete-all needs the typed confirmation and purges only test-domain accounts', async () => {
    expect((await accounts.DELETE(req('/api/giga-admin/dev-tools/test-accounts', 'DELETE', {}))).status).toBe(400)
    state.handler = (op) => {
      if (op.table === 'profiles') return { data: [
        { id: 'a1', email: 'client.aaaa1111@test.aistart360.app', role: 'client', status: 'approved', created_at: null },
        { id: 'a2', email: 'someone@gmail.com', role: 'client', status: 'approved', created_at: null },
      ], error: null }
      return { data: [], error: null }
    }
    const res = await accounts.DELETE(req('/api/giga-admin/dev-tools/test-accounts', 'DELETE', { confirm: 'УДАЛИТЬ' }))
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ deleted: 1, skipped: 1 })
    expect(state.purgeUser).toHaveBeenCalledTimes(1)
    expect((state.purgeUser.mock.calls[0][2] as { userId: string }).userId).toBe('a1')
    expect(state.audits[0]).toEqual({ action: 'devtools.test_accounts_purge_all', required: true })
  })
})
