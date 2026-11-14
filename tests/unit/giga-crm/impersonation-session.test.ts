/**
 * «Кабинет от имени пользователя» — server-side state (R-008) and target
 * checks at the start (R-048).
 *
 * R-048: the start did not check the staff member's client scope
 *   (guardClientAccess) and accepted an expert / staff account as the target.
 * R-008: the impersonation lived in one cookie. The minted Supabase session of
 *   the client is now bound to the impersonation_sessions row (audit row
 *   `impersonation.session_bound` with the GoTrue session id) so middleware can
 *   recognise it WITHOUT the cookie; ending it revokes that one session
 *   (signOut scope 'local'), not every session of the client (global).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { createChunks, stringToBase64URL } from '@supabase/ssr'

const UID = '11111111-2222-4333-8444-555555555555'
const AID = '99999999-8888-4777-8666-555555555555'
const SID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'
const ASID = '12121212-3434-4565-8787-909090909090'

const h = vi.hoisted(() => ({
  jar: new Map<string, string>(),
  audit: [] as Array<{ action: string; entityId?: string; entityType?: string; impersonationSessionId?: string; targetUserId?: string }>,
  auditFailsFor: null as string | null,
  inserted: 0,
  updates: [] as Array<Record<string, unknown>>,
  profile: { role: 'client' } as { role: string } | null,
  staffRow: null as null | { user_id: string },
  scope: 'all' as 'all' | 'assigned',
  assignee: null as string | null,
  signOuts: [] as Array<unknown>,
  verifySessionToken: '' as string,
  bindingRow: null as null | { impersonation_session_id: string },
  sessionRow: null as null | Record<string, unknown>,
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
vi.mock('@/lib/admin/giga-actor', async () => {
  const { makeRequireGiga } = await import('../_giga-guard')
  return {
    requireGiga: makeRequireGiga(() => ({ id: AID, kind: 'session', role: 'super_admin', email: 'a@x.io', clientScope: h.scope })),
    signStaffCookie: async () => 'staff-cookie',
    staffRoleOfUser: async () => ({ staffRole: null, profileRole: h.profile?.role ?? null, status: 'approved', email: 'c@x.io' }),
    STAFF_COOKIE_NAME: 'aistart360_giga_staff',
    STAFF_COOKIE_TTL_SECONDS: 60,
  }
})
vi.mock('@/lib/admin/audit', () => ({
  recordAdminAction: async (_a: unknown, e: (typeof h.audit)[number], _r: unknown, o?: { required?: boolean }) => {
    if (h.auditFailsFor === e.action && o?.required) throw new Error('audit down')
    h.audit.push(e)
    return true
  },
}))
vi.mock('@/lib/rate-limit', () => ({ isRateLimitedKey: async () => false }))
vi.mock('@/lib/settings/store', () => ({ getSetting: async (k: string) => (k === 'impersonation_ttl_minutes' ? 30 : true) }))
vi.mock('@/lib/events/track', () => ({ trackEvent: async () => undefined }))

function builder(table: string) {
  const b: Record<string, unknown> = {}
  let mode: 'select' | 'update' | 'insert' = 'select'
  for (const m of ['eq', 'is', 'gt', 'order', 'range', 'in', 'limit']) b[m] = () => b
  b.select = () => b
  b.update = (patch: Record<string, unknown>) => { mode = 'update'; h.updates.push({ table, ...patch }); return b }
  b.insert = () => { mode = 'insert'; h.inserted++; return b }
  b.single = async () => ({ data: mode === 'insert' ? { id: SID } : null, error: null })
  b.maybeSingle = async () => ({
    data: table === 'profiles' ? h.profile
      : table === 'staff_roles' ? h.staffRow
      : table === 'user_assignments' ? (h.assignee ? { assignee_id: h.assignee } : null)
      : table === 'admin_audit_log' ? h.bindingRow
      : table === 'impersonation_sessions' ? h.sessionRow
      : null,
    error: null,
  })
  b.then = (res: (v: unknown) => unknown) => Promise.resolve({ data: mode === 'update' ? [{ id: SID }] : [], error: null }).then(res)
  return b
}
vi.mock('@/lib/supabase-service', () => ({
  createServiceClient: () => ({
    from: builder,
    auth: { admin: { generateLink: async () => ({ data: { properties: { hashed_token: 'th' } }, error: null }) } },
  }),
}))
vi.mock('@/lib/supabase-server', () => ({
  createServerClient: () => ({
    auth: {
      verifyOtp: async () => ({ data: { user: { id: UID }, session: { access_token: h.verifySessionToken } }, error: null }),
      signOut: async (opts?: unknown) => { h.signOuts.push(opts ?? 'DEFAULT(global)'); return { error: null } },
    },
  }),
}))

process.env.GIGA_COOKIE_SECRET = 'test-secret-for-signed-tokens-0123456789'
process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://supabase.example.app'

const start = await import('@/app/api/giga-admin/impersonation/route')
const exit = await import('@/app/api/v1/impersonation/exit/route')
const { readImpersonation, signImpersonation, IMP_COOKIE_NAME } = await import('@/lib/impersonation/token')

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url')
const jwt = (claims: Record<string, unknown>) => `${b64({ alg: 'HS256' })}.${b64(claims)}.sig`
const startReq = () => new NextRequest('http://localhost/api/giga-admin/impersonation', {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ userId: UID, mode: 'view', reason: 'проверка анкеты' }),
})
function holdClientSession(sid = ASID) {
  for (const c of createChunks('sb-supabase-auth-token', `base64-${stringToBase64URL(JSON.stringify({ access_token: jwt({ sub: UID, session_id: sid }) }))}`)) h.jar.set(c.name, c.value)
}

beforeEach(() => {
  h.jar = new Map()
  h.audit = []
  h.auditFailsFor = null
  h.inserted = 0
  h.updates = []
  h.profile = { role: 'client' }
  h.staffRow = null
  h.scope = 'all'
  h.assignee = null
  h.signOuts = []
  h.verifySessionToken = jwt({ sub: UID, session_id: ASID, amr: [{ method: 'magiclink' }] })
  h.bindingRow = null
  h.sessionRow = null
})

describe('R-048: who may be opened «от имени»', () => {
  it('R-048: a client outside the staff member\'s scope is refused before any session is opened', async () => {
    h.scope = 'assigned'
    h.assignee = '00000000-0000-4000-8000-000000000001'
    const res = await start.POST(startReq())
    expect(res.status).toBe(403)
    expect(h.inserted).toBe(0)
  })

  it.each([['expert'], ['super_expert'], ['admin']])('R-048: a target whose profiles.role is %s is refused', async (role) => {
    h.profile = { role }
    const res = await start.POST(startReq())
    expect(res.status).toBeGreaterThanOrEqual(400)
    expect(h.inserted).toBe(0)
  })

  it('R-048: a target with a staff_roles row is refused even when its profile says client', async () => {
    h.staffRow = { user_id: UID }
    const res = await start.POST(startReq())
    expect(res.status).toBeGreaterThanOrEqual(400)
    expect(h.inserted).toBe(0)
  })

  it('an assigned client is opened', async () => {
    h.scope = 'assigned'
    h.assignee = AID
    expect((await start.POST(startReq())).status).toBe(200)
  })
})

describe('R-008: the impersonation is bound to the minted Supabase session', () => {
  it('R-008: the start records the GoTrue session id and puts it in the cookie', async () => {
    const res = await start.POST(startReq())
    expect(res.status).toBe(200)
    expect(h.audit).toContainEqual(expect.objectContaining({ action: 'impersonation.session_bound', entityType: 'auth_session', entityId: ASID, impersonationSessionId: SID, targetUserId: UID }))
    const v = await readImpersonation(h.jar.get(IMP_COOKIE_NAME))
    expect(v.ok && v.claims.asid).toBe(ASID)
  })

  it('R-008: without the binding there is no impersonation — the minted session is revoked (local)', async () => {
    h.auditFailsFor = 'impersonation.session_bound'
    const res = await start.POST(startReq())
    expect(res.status).toBe(503)
    expect(h.signOuts).toEqual([{ scope: 'local' }])
    expect(h.jar.has(IMP_COOKIE_NAME)).toBe(false)
    expect(h.updates).toContainEqual(expect.objectContaining({ table: 'impersonation_sessions', end_reason: 'bind_failed' }))
  })

  it('R-008: a token without a session id is not bound and is refused', async () => {
    h.verifySessionToken = jwt({ sub: UID })
    const res = await start.POST(startReq())
    expect(res.status).toBe(500)
    expect(h.signOuts).toEqual([{ scope: 'local' }])
  })
})

describe('R-008: leaving the cabinet', () => {
  it('R-008: exit revokes only this session (scope local), not every session of the client', async () => {
    holdClientSession()
    h.jar.set(IMP_COOKIE_NAME, await signImpersonation({ sid: SID, uid: UID, mode: 'view', aid: AID, alabel: 'a@x.io', tlabel: 'c@x.io', asid: ASID }))
    const res = await exit.POST(new NextRequest('http://localhost/api/v1/impersonation/exit', { method: 'POST' }))
    expect(res.status).toBe(200)
    expect(h.signOuts).toEqual([{ scope: 'local' }])
    expect(h.updates).toContainEqual(expect.objectContaining({ table: 'impersonation_sessions', end_reason: 'exit' }))
    expect(h.audit).toContainEqual(expect.objectContaining({ action: 'impersonation.ended', entityId: SID }))
  })

  it('R-008: with the cookie removed, exit still finds and closes the session through the binding', async () => {
    holdClientSession()
    h.bindingRow = { impersonation_session_id: SID }
    h.sessionRow = { id: SID, admin_id: AID, admin_email: 'a@x.io', admin_role: 'super_admin', target_user_id: UID, ended_at: null }
    const res = await exit.POST(new NextRequest('http://localhost/api/v1/impersonation/exit', { method: 'POST' }))
    expect(res.status).toBe(200)
    expect(h.signOuts).toEqual([{ scope: 'local' }])
    expect(h.updates).toContainEqual(expect.objectContaining({ table: 'impersonation_sessions', end_reason: 'exit_without_cookie' }))
    expect((await res.json()).redirect).toBe(`/admin-giga-panel/users/${UID}`)
  })
})
