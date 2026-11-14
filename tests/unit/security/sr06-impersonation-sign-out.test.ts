/**
 * SR-06 — «Выйти» во время impersonation делал global signOut сессии клиента:
 * клиента выкидывало со всех его устройств, а запись impersonation оставалась
 * открытой. Теперь любое «Выйти» во время impersonation (кабинет клиента,
 * старый кабинет, панель) завершает только сессию impersonation (scope
 * 'local') и закрывает запись; обычный выход клиента — как раньше (global).
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { createChunks, stringToBase64URL } from '@supabase/ssr'

const UID = '11111111-2222-4333-8444-555555555555'
const AID = '99999999-8888-4777-8666-555555555555'
const SID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'
const ASID = '12121212-3434-4565-8787-909090909090'

const h = vi.hoisted(() => ({
  jar: new Map<string, string>(),
  audit: [] as Array<{ action: string; entityId?: string }>,
  updates: [] as Array<Record<string, unknown>>,
  signOuts: [] as unknown[],
  bindingRow: null as null | { impersonation_session_id: string },
  bindingError: false,
  sessionRow: null as null | Record<string, unknown>,
  user: { id: '' } as { id: string } | null,
}))

vi.mock('next/headers', () => ({
  cookies: () => ({
    get: (n: string) => (h.jar.has(n) ? { name: n, value: h.jar.get(n)! } : undefined),
    getAll: () => Array.from(h.jar.entries()).map(([name, value]) => ({ name, value })),
    set: (name: string, value: string) => { h.jar.set(name, value) },
    delete: (name: string) => { h.jar.delete(name) },
  }),
  headers: () => new Headers(),
}))
vi.mock('@/lib/admin/audit', () => ({ recordAdminAction: async (_a: unknown, e: { action: string }) => { h.audit.push(e); return true } }))
vi.mock('@/lib/audit', () => ({ logAudit: async () => undefined }))
vi.mock('@/lib/events/track', () => ({ trackEvent: async () => undefined }))
vi.mock('@/lib/activity/log', () => ({ logActivity: async () => undefined }))
vi.mock('@/lib/rate-limit', () => ({ isRateLimitedKey: async () => false }))
vi.mock('@/lib/admin/giga-actor', () => ({ STAFF_COOKIE_NAME: 'aistart360_giga_staff' }))

function builder(table: string) {
  const b: Record<string, unknown> = {}
  let mode = 'select'
  for (const m of ['eq', 'is', 'limit', 'order']) b[m] = () => b
  b.select = () => b
  b.update = (patch: Record<string, unknown>) => { mode = 'update'; h.updates.push({ table, ...patch }); return b }
  b.maybeSingle = async () => {
    if (table === 'admin_audit_log') return h.bindingError ? { data: null, error: { message: 'down' } } : { data: h.bindingRow, error: null }
    if (table === 'impersonation_sessions') return { data: h.sessionRow, error: null }
    return { data: null, error: null }
  }
  b.then = (r: (v: unknown) => unknown) => Promise.resolve({ data: mode === 'update' ? [{ id: SID }] : [], error: null }).then(r)
  return b
}
vi.mock('@/lib/supabase-service', () => ({ createServiceClient: () => ({ from: builder }) }))
vi.mock('@/lib/supabase-server', () => ({
  createServerClient: () => ({
    auth: {
      getUser: async () => ({ data: { user: h.user } }),
      signOut: async (opts?: unknown) => { h.signOuts.push(opts ?? 'DEFAULT(global)'); return { error: null } },
    },
  }),
}))

process.env.GIGA_COOKIE_SECRET = 'test-secret-for-signed-tokens-0123456789'
process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://supabase.example.app'

const signOutRoute = await import('@/app/api/v1/auth/sign-out/route')
const gigaAuth = await import('@/app/api/giga-admin/auth/route')
const { signImpersonation, IMP_COOKIE_NAME, isViewModeAllowed } = await import('@/lib/impersonation/token')

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url')
const jwt = (claims: Record<string, unknown>) => `${b64({ alg: 'HS256' })}.${b64(claims)}.sig`
function holdClientSession(sid = ASID) {
  for (const c of createChunks('sb-supabase-auth-token', `base64-${stringToBase64URL(JSON.stringify({ access_token: jwt({ sub: UID, session_id: sid }) }))}`)) h.jar.set(c.name, c.value)
}
async function impersonate(mode: 'view' | 'edit' = 'view') {
  holdClientSession()
  h.jar.set(IMP_COOKIE_NAME, await signImpersonation({ sid: SID, uid: UID, mode, aid: AID, alabel: 'a@x.io', tlabel: 'c@x.io', asid: ASID }))
}
const signOut = () => signOutRoute.POST(new NextRequest('http://localhost/api/v1/auth/sign-out', { method: 'POST' }))
const panelSignOut = () => gigaAuth.DELETE(new NextRequest('http://localhost/api/giga-admin/auth', { method: 'DELETE' }))

beforeEach(() => {
  h.jar = new Map()
  h.audit = []
  h.updates = []
  h.signOuts = []
  h.bindingRow = null
  h.bindingError = false
  h.sessionRow = null
  h.user = { id: UID }
})

describe('SR-06: «Выйти» в кабинете во время impersonation', () => {
  it('SR-06: завершает только сессию impersonation (local) и закрывает запись', async () => {
    await impersonate()
    const res = await signOut()
    expect(res.status).toBe(200)
    expect(h.signOuts).toEqual([{ scope: 'local' }])
    expect(h.updates).toContainEqual(expect.objectContaining({ table: 'impersonation_sessions', end_reason: 'sign_out' }))
    expect(h.audit).toContainEqual(expect.objectContaining({ action: 'impersonation.ended', entityId: SID }))
    const body = await res.json()
    expect(body).toMatchObject({ ok: true, impersonation: true, redirect: `/admin-giga-panel/users/${UID}` })
    expect(h.jar.has(IMP_COOKIE_NAME)).toBe(false)
  })

  it('SR-06: cookie удалён — сессия узнаётся по привязке, выход всё равно local', async () => {
    holdClientSession()
    h.bindingRow = { impersonation_session_id: SID }
    h.sessionRow = { id: SID, admin_id: AID, admin_email: 'a@x.io', admin_role: 'super_admin', target_user_id: UID, mode: 'view', expires_at: '2099-01-01', ended_at: null }
    await signOut()
    expect(h.signOuts).toEqual([{ scope: 'local' }])
    expect(h.updates).toContainEqual(expect.objectContaining({ table: 'impersonation_sessions', end_reason: 'sign_out_without_cookie' }))
  })

  it('SR-06: режим сессии не удалось выяснить — только local, не global', async () => {
    holdClientSession()
    h.bindingError = true
    await signOut()
    expect(h.signOuts).toEqual([{ scope: 'local' }])
  })

  it('SR-06: обычный выход клиента — как раньше (все устройства)', async () => {
    holdClientSession()
    const res = await signOut()
    expect(h.signOuts).toEqual(['DEFAULT(global)'])
    expect(await res.json()).toMatchObject({ ok: true, impersonation: false, redirect: '/login' })
  })

  it('SR-06: выход разрешён и в режиме «только просмотр»', () => {
    expect(isViewModeAllowed('/api/v1/auth/sign-out')).toBe(true)
  })
})

describe('SR-06: «Выйти» в панели во время impersonation', () => {
  it('SR-06: DELETE /api/giga-admin/auth завершает только сессию impersonation', async () => {
    await impersonate('edit')
    const res = await panelSignOut()
    expect(res.status).toBe(200)
    expect(h.signOuts).toEqual([{ scope: 'local' }])
    expect(h.updates).toContainEqual(expect.objectContaining({ table: 'impersonation_sessions', end_reason: 'panel_sign_out' }))
  })

  it('SR-06: обычный выход из панели — как раньше', async () => {
    holdClientSession()
    await panelSignOut()
    expect(h.signOuts).toEqual(['DEFAULT(global)'])
  })
})

describe('SR-06: браузер сам global signOut не делает', () => {
  const root = process.cwd()
  const FILES = [
    'components/client/ClientNav.tsx',
    'components/giga-panel/GigaSidebar.tsx',
    'app/client/waiting-room/page.tsx',
    'components/point-a/legacy/ClientPointALegacy.tsx',
    'stores/auth.store.ts',
  ]
  it.each(FILES)('SR-06: %s — нет signOut() без scope local', (file) => {
    const src = readFileSync(join(root, file), 'utf8')
    const calls = src.match(/\.auth\.signOut\(([^)]*)\)/g) ?? []
    for (const c of calls) expect(c).toMatch(/scope:\s*'local'/)
  })
})
