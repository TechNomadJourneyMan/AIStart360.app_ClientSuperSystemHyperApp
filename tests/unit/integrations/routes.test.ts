/**
 * Integration API routes — permissions and secrecy:
 *   client  /api/integrations/** — 401 without a session; reading needs
 *           company read access, connect / test / disconnect need manage
 *           access (owner / company admin); a key that the provider rejects
 *           is never stored; a stored key is sealed (v1:…) and never echoed.
 *   GIGA    /api/giga-admin/integrations/** — users.view reads, company.edit
 *           changes; the change is audited (required) before it happens.
 */
import { randomBytes } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import type { StaffRole } from '@/lib/admin/rbac'

const s = vi.hoisted(() => ({
  user: { id: 'owner-1' } as { id: string } | null,
  canManage: true,
  role: 'admin' as string,
  auditOk: true,
  audits: [] as Array<Record<string, unknown>>,
  saved: [] as Array<Record<string, unknown>>,
  disconnected: [] as Array<Record<string, unknown>>,
  providerStatus: 200,
  tableMissing: false,
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: s.user }, error: null }) } }),
}))
vi.mock('@/lib/tenancy', () => ({
  resolveTenantWith: async (_c: unknown, userId: string | null, opts: { companyId?: string | null; access?: string }) => {
    if (!userId) return { ok: false, status: 401, error: 'unauthenticated' }
    if (opts.companyId && opts.companyId !== 'co-1') return { ok: false, status: 404, error: 'no_company' }
    if (opts.access === 'manage' && !s.canManage) return { ok: false, status: 403, error: 'forbidden' }
    return { ok: true, tenant: { userId, companyId: 'co-1', role: s.canManage ? 'owner' : 'member', canManage: s.canManage, legacy: false } }
  },
  tenantErrorMessage: (e: string) => e,
}))
vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: async () => ({ limited: false, reason: 'ok', limit: 10, remaining: 9, retryAfterSeconds: 0, backend: 'memory' }),
  rateLimitResponse: () => new Response('limited', { status: 429 }),
}))
vi.mock('@/lib/admin/giga-actor', async () => {
  const { makeRequireGiga } = await import('../_giga-guard')
  return { requireGiga: makeRequireGiga(() => ({ id: 'staff-1', kind: 'session', role: s.role as StaffRole })), STAFF_COOKIE_NAME: 'x', STAFF_COOKIE_TTL_SECONDS: 60 }
})
vi.mock('@/lib/admin/audit', () => ({
  recordAdminAction: async (_a: unknown, entry: Record<string, unknown>) => { s.audits.push(entry); return s.auditOk },
}))
const view = (provider: string) => ({
  id: '11111111-1111-4111-8111-111111111111', companyId: 'co-1', provider, status: 'connected', authKind: 'token', accountLabel: 'Kaspi Магазин',
  settings: {}, lastSyncAt: null, nextSyncAt: null, lastError: null, lastErrorKind: null, errorCount: 0, filledTo: null, createdAt: '2026-10-06T00:00:00Z', updatedAt: '2026-10-06T00:00:00Z',
})
vi.mock('@/lib/integrations/store', () => ({
  listConnections: async () => {
    if (s.tableMissing) throw new Error('relation "public.integration_connections" does not exist')
    return [view('kaspi')]
  },
  isIntegrationsTableMissing: (err: unknown) => /does not exist/.test(String((err as Error)?.message)),
  listConnectionsForStaff: async () => [{ ...view('kaspi'), companyName: 'ТОО Тест' }],
  saveConnection: async (input: Record<string, unknown>) => { s.saved.push(input); return view(String(input.provider)) },
  disconnectConnection: async (companyId: string, provider: string) => { s.disconnected.push({ companyId, provider }); return true },
  connectionSecret: async () => null,
  markTestResult: async () => undefined,
  companyExists: async (id: string) => id === 'co-1',
  getConnection: async () => view('kaspi'),
}))

const TOKEN = 'kaspi-secret-token-000111'
const req = (url: string, init?: { method?: string; body?: unknown }) =>
  new NextRequest(`http://localhost${url}`, {
    method: init?.method ?? 'GET',
    headers: { 'content-type': 'application/json', origin: 'http://localhost' },
    body: init?.body === undefined ? undefined : JSON.stringify(init.body),
  })

const savedKey = process.env.SECRETS_ENCRYPTION_KEY
beforeAll(() => {
  process.env.SECRETS_ENCRYPTION_KEY = randomBytes(32).toString('hex')
  vi.stubGlobal('fetch', (async () => new Response(JSON.stringify({ data: [], meta: { pageCount: 0, totalCount: 0 } }), { status: s.providerStatus })) as unknown as typeof fetch)
})
afterAll(() => {
  vi.unstubAllGlobals()
  if (savedKey === undefined) delete process.env.SECRETS_ENCRYPTION_KEY
  else process.env.SECRETS_ENCRYPTION_KEY = savedKey
})
beforeEach(() => {
  s.user = { id: 'owner-1' }
  s.canManage = true
  s.role = 'admin'
  s.auditOk = true
  s.audits = []
  s.saved = []
  s.disconnected = []
  s.providerStatus = 200
  s.tableMissing = false
})

const client = await import('@/app/api/integrations/route')
const providerRoute = await import('@/app/api/integrations/[provider]/route')
const testRoute = await import('@/app/api/integrations/[provider]/test/route')
const gigaList = await import('@/app/api/giga-admin/integrations/route')
const gigaProvider = await import('@/app/api/giga-admin/integrations/[companyId]/[provider]/route')

describe('client integration routes', () => {
  it('401 without a session; a foreign companyId is 404', async () => {
    s.user = null
    expect((await client.GET(req('/api/integrations'))).status).toBe(401)
    s.user = { id: 'owner-1' }
    expect((await client.GET(req('/api/integrations?companyId=co-other'))).status).toBe(404)
  })

  it('a member reads the catalogue and connections — no credential in the response', async () => {
    s.canManage = false
    const res = await client.GET(req('/api/integrations'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data.canManage).toBe(false)
    expect(body.data.catalog.length).toBeGreaterThan(10)
    expect(JSON.stringify(body)).not.toMatch(/secret_ciphertext|secretCiphertext|"token":/)
  })

  it('before migration 105: the catalogue with migrationPending instead of a 500', async () => {
    s.tableMissing = true
    const res = await client.GET(req('/api/integrations'))
    expect(res.status).toBe(200)
    expect((await res.json()).data).toMatchObject({ connections: [], migrationPending: true })
  })

  it('connect, test and disconnect need manage access', async () => {
    s.canManage = false
    expect((await client.POST(req('/api/integrations', { method: 'POST', body: { provider: 'kaspi', fields: { token: TOKEN } } }))).status).toBe(403)
    expect((await providerRoute.DELETE(req('/api/integrations/kaspi', { method: 'DELETE' }), { params: { provider: 'kaspi' } })).status).toBe(403)
    expect((await testRoute.POST(req('/api/integrations/kaspi/test', { method: 'POST' }), { params: { provider: 'kaspi' } })).status).toBe(403)
    expect(s.saved).toHaveLength(0)
    expect(s.disconnected).toHaveLength(0)
  })

  it('a key the provider rejects (401) is not stored', async () => {
    s.providerStatus = 401
    const res = await client.POST(req('/api/integrations', { method: 'POST', body: { provider: 'kaspi', fields: { token: TOKEN } } }))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.kind).toBe('auth')
    expect(JSON.stringify(body)).not.toContain(TOKEN)
    expect(s.saved).toHaveLength(0)
  })

  it('a working key is stored sealed and never echoed', async () => {
    const res = await client.POST(req('/api/integrations', { method: 'POST', body: { provider: 'kaspi', fields: { token: TOKEN } } }))
    expect(res.status).toBe(201)
    expect(JSON.stringify(await res.json())).not.toContain(TOKEN)
    expect(s.saved).toHaveLength(1)
    const sealed = String(s.saved[0].secretCiphertext)
    expect(sealed.startsWith('v1:')).toBe(true)
    expect(sealed).not.toContain(TOKEN)
    expect(s.saved[0]).toMatchObject({ companyId: 'co-1', provider: 'kaspi', authKind: 'token', createdBy: 'owner-1' })
  })

  it('a provider without a live adapter gets a file record without credentials; unknown providers are 404', async () => {
    const res = await client.POST(req('/api/integrations', { method: 'POST', body: { provider: 'ozon', fields: { token: TOKEN } } }))
    expect(res.status).toBe(201)
    expect(s.saved[0]).toMatchObject({ provider: 'ozon', authKind: 'file', secretCiphertext: null })
    expect((await client.POST(req('/api/integrations', { method: 'POST', body: { provider: 'amazon' } }))).status).toBe(404)
  })

  it('disconnect by the owner deletes the key', async () => {
    const res = await providerRoute.DELETE(req('/api/integrations/kaspi', { method: 'DELETE' }), { params: { provider: 'kaspi' } })
    expect(res.status).toBe(200)
    expect(s.disconnected).toEqual([{ companyId: 'co-1', provider: 'kaspi' }])
  })
})

describe('GIGA integration routes', () => {
  it('users.view reads (analyst), company.edit changes (analyst refused)', async () => {
    s.role = 'analyst'
    const list = await gigaList.GET(req('/api/giga-admin/integrations'))
    expect(list.status).toBe(200)
    expect((await list.json()).data.canEdit).toBe(false)
    const post = await gigaProvider.POST(req('/api/giga-admin/integrations/co-1/kaspi', { method: 'POST', body: { fields: { token: TOKEN } } }), { params: { companyId: 'co-1', provider: 'kaspi' } })
    expect(post.status).toBe(403)
    expect(s.audits).toHaveLength(0)
    expect(s.saved).toHaveLength(0)
    s.role = 'content_manager'
    expect((await gigaList.GET(req('/api/giga-admin/integrations'))).status).toBe(403)
  })

  it('crm_manager connects for a client: audited first, without the key in the audit', async () => {
    s.role = 'crm_manager'
    const res = await gigaProvider.POST(req('/api/giga-admin/integrations/co-1/kaspi', { method: 'POST', body: { fields: { token: TOKEN } } }), { params: { companyId: 'co-1', provider: 'kaspi' } })
    expect(res.status).toBe(201)
    expect(s.audits[0]).toMatchObject({ action: 'integration.connect', entityId: 'co-1', metadata: { provider: 'kaspi' } })
    expect(JSON.stringify(s.audits)).not.toContain(TOKEN)
    expect(s.saved[0]).toMatchObject({ companyId: 'co-1', createdBy: 'staff-1' })
  })

  it('no audit → no change; unknown company → 404', async () => {
    s.auditOk = false
    const res = await gigaProvider.DELETE(req('/api/giga-admin/integrations/co-1/kaspi', { method: 'DELETE' }), { params: { companyId: 'co-1', provider: 'kaspi' } })
    expect(res.status).toBe(503)
    expect(s.disconnected).toHaveLength(0)
    s.auditOk = true
    expect((await gigaProvider.DELETE(req('/api/giga-admin/integrations/co-x/kaspi', { method: 'DELETE' }), { params: { companyId: 'co-x', provider: 'kaspi' } })).status).toBe(404)
  })
})
