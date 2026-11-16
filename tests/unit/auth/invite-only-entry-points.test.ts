/**
 * R4 B3, ревью W3A-1 / W3A-2: остальные входы, кроме колбэка и middleware.
 *   • вход по паролю (POST /api/auth/password): помеченный и не одобренный
 *     аккаунт (например, задал пароль через восстановление) сессии не получает;
 *     одобренный — получает, метка снимается, токен свежий;
 *   • POST /api/client/register: в режиме «по приглашению» аккаунт, созданный
 *     в обход приглашения, не заводит заявку ГИГА и не зовёт администраторов;
 *     регистрации эпохи «по подтверждению» — как раньше;
 *   • одобрение персоналом (applyApprovalDecision) снимает метку.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

type Row = Record<string, unknown>
const UID = '00000000-0000-4000-8000-0000000000d1'

const s = vi.hoisted(() => ({
  tables: {} as Record<string, Row[]>,
  signedIn: null as null | { id: string; email: string; app_metadata: Record<string, unknown> },
  authUser: null as null | Row,
  signOut: vi.fn(async () => ({ error: null })),
  refresh: vi.fn(async () => ({ data: { session: { access_token: 'fresh-at', refresh_token: 'fresh-rt' } }, error: null })),
  updateUserById: vi.fn(async (..._a: unknown[]) => ({ data: {}, error: null })),
  notify: vi.fn(async (..._a: unknown[]) => {}),
  requests: [] as Row[],
}))

function table(name: string) {
  const filters: Array<(r: Row) => boolean> = []
  let patch: Row | null = null
  const rows = () => (s.tables[name] ?? []).filter((r) => filters.every((f) => f(r)))
  const q: Row = {}
  Object.assign(q, {
    select: () => q, limit: () => q, order: () => q,
    eq: (c: string, v: unknown) => { filters.push((r) => (c === 'payload->>userId' ? (r.payload as Row)?.userId === v : r[c] === v)); return q },
    in: (c: string, vs: unknown[]) => { filters.push((r) => vs.includes(r[c])); return q },
    maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
    upsert: async () => ({ error: null }),
    insert: async (row: Row) => { (s.tables[name] ??= []).push(row); return { error: null } },
    update: (p: Row) => { patch = p; return q },
    then: (ok: (v: unknown) => unknown) => {
      if (patch) { const hit = rows(); for (const r of hit) Object.assign(r, patch); return Promise.resolve({ data: hit, error: null }).then(ok) }
      return Promise.resolve({ data: rows(), error: null }).then(ok)
    },
  })
  return q
}

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    auth: {
      signInWithPassword: async () => ({ data: { user: s.signedIn, session: { access_token: 'at', refresh_token: 'rt' } }, error: null }),
      signOut: s.signOut,
      refreshSession: s.refresh,
    },
  }),
}))
vi.mock('@/lib/supabase-service', () => ({
  createServiceClient: () => ({ from: table, auth: { admin: { updateUserById: s.updateUserById } } }),
}))
vi.mock('@/lib/supabase-server', () => ({
  createServerClient: () => ({ auth: { getUser: async () => ({ data: { user: s.authUser } }) }, from: table }),
}))
vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: async () => ({ limited: false }),
  clientIp: () => '203.0.113.7',
  isRateLimitedKey: async () => false,
  checkRateLimitForRequest: async () => ({ limited: false }),
  rateLimitResponse: () => new Response(null, { status: 429 }),
}))
vi.mock('@/lib/site-url', () => ({ getSiteUrl: () => 'http://localhost' }))
vi.mock('@/lib/notifications', () => ({ notifyAdmins: s.notify }))
vi.mock('@/lib/background', () => ({ runInBackground: async (_l: string, work: () => Promise<unknown>) => { await work() } }))
vi.mock('@/lib/db', () => ({
  prisma: {
    adminRequest: {
      findFirst: async () => null,
      create: async ({ data }: { data: Row }) => { const row = { id: `req-${s.requests.length + 1}`, ...data }; s.requests.push(row); return row },
    },
  },
}))
vi.mock('@/lib/email', () => ({ sendPortalAccessGrantedEmail: async () => ({ ok: true }), sendUserEmail: async () => ({ ok: true }) }))
vi.mock('@/lib/notifications/product', () => ({ notifyAccessGranted: async () => {} }))
vi.mock('@/lib/share/tokens', () => ({ revokeSharesOfCreator: async () => ({}) }))

const { POST: password } = await import('@/app/api/auth/password/route')
const { POST: clientRegister } = await import('@/app/api/client/register/route')
const { applyApprovalDecision } = await import('@/lib/users/approval')
const { __resetRegistrationModeCacheForTests } = await import('@/lib/settings/system-settings')

const MARK = { signup_blocked: 'invite_only' }
const CLEAR = { app_metadata: { signup_blocked: null, signup_blocked_at: null } }

beforeEach(() => {
  __resetRegistrationModeCacheForTests()
  s.tables = {
    profiles: [{ id: UID, email: 'new@corp.kz', status: 'pending_approval' }],
    system_settings: [{ key: 'registration_mode', value: 'invite', updated_at: '2026-11-01T00:00:00.000Z' }],
    platform_invitations: [],
    companies: [],
    admin_requests: [],
  }
  s.signedIn = { id: UID, email: 'new@corp.kz', app_metadata: { ...MARK } }
  s.authUser = { id: UID, email: 'new@corp.kz', created_at: '2026-11-16T10:00:00.000Z', invited_at: null, app_metadata: {} }
  s.signOut.mockClear()
  s.refresh.mockClear()
  s.updateUserById.mockClear()
  s.notify.mockClear()
  s.requests = []
})

describe('W3A-1 / W3A-2: вход по паролю', () => {
  const login = () => password(new Request('http://localhost/api/auth/password', {
    method: 'POST', headers: { 'content-type': 'application/json', origin: 'http://localhost' },
    body: JSON.stringify({ email: 'new@corp.kz', password: 'set-through-recovery' }),
  }))

  it('помеченный, не одобренный: сессии нет, она отозвана, ответ «по приглашению»', async () => {
    const body = await (await login()).json()
    expect(body).toMatchObject({ ok: false, code: 'invite_only' })
    expect(body.session).toBeUndefined()
    expect(s.signOut).toHaveBeenCalledTimes(1)
  })

  it('W3A-2: одобренный персоналом — входит, метка снимается, токен свежий (без метки)', async () => {
    s.tables.profiles[0].status = 'approved'
    const body = await (await login()).json()
    expect(body).toMatchObject({ ok: true, session: { access_token: 'fresh-at', refresh_token: 'fresh-rt' } })
    expect(s.updateUserById).toHaveBeenCalledWith(UID, CLEAR)
  })

  it('NV3-2: помеченному отправили приглашение (platform_invitations) — входит, метка снимается, токен свежий', async () => {
    s.tables.platform_invitations = [{ email: 'new@corp.kz', status: 'sent' }]
    const body = await (await login()).json()
    expect(body).toMatchObject({ ok: true, session: { access_token: 'fresh-at', refresh_token: 'fresh-rt' } })
    expect(s.updateUserById).toHaveBeenCalledWith(UID, CLEAR)
    expect(s.refresh).toHaveBeenCalledTimes(1)
    expect(s.signOut).not.toHaveBeenCalled()
  })

  it('NV3-2: приглашён в GoTrue (invited_at) — тоже входит; неудавшееся (failed) приглашение — нет', async () => {
    s.signedIn = { ...s.signedIn!, invited_at: '2026-11-16T09:00:00.000Z' } as typeof s.signedIn
    expect((await (await login()).json()).ok).toBe(true)
    s.signedIn = { id: UID, email: 'new@corp.kz', app_metadata: { ...MARK } }
    s.tables.platform_invitations = [{ email: 'new@corp.kz', status: 'failed' }]
    expect(await (await login()).json()).toMatchObject({ ok: false, code: 'invite_only' })
  })

  it('без метки — как раньше', async () => {
    s.signedIn = { id: UID, email: 'new@corp.kz', app_metadata: {} }
    const body = await (await login()).json()
    expect(body).toMatchObject({ ok: true, session: { access_token: 'at' } })
    expect(s.signOut).not.toHaveBeenCalled()
  })
})

describe('W3A-1: /api/client/register в режиме «по приглашению»', () => {
  const call = () => clientRegister(new NextRequest('http://localhost/api/client/register', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Новый', company: 'ТОО Х' }),
  }))

  it('аккаунт создан после включения режима, не приглашён — 403, ни компании, ни заявки, ни уведомления', async () => {
    const res = await call()
    expect(res.status).toBe(403)
    expect((await res.json()).code).toBe('invite_only')
    expect(s.requests).toHaveLength(0)
    expect(s.tables.companies).toHaveLength(0)
    expect(s.notify).not.toHaveBeenCalled()
  })

  it('регистрация эпохи «по подтверждению» (создана раньше) и приглашённый — как раньше', async () => {
    s.authUser = { ...s.authUser!, created_at: '2026-06-01T00:00:00.000Z' }
    expect((await call()).status).toBe(201)
    s.requests = []
    s.authUser = { ...s.authUser!, id: UID, created_at: '2026-11-16T10:00:00.000Z' }
    s.tables.platform_invitations = [{ email: 'new@corp.kz', status: 'accepted' }]
    s.tables.companies = []
    expect((await call()).status).toBe(201)
    expect(s.notify).toHaveBeenCalled()
  })

  it('режим «по подтверждению» — как раньше', async () => {
    s.tables.system_settings[0].value = 'approval'
    expect((await call()).status).toBe(201)
  })
})

describe('W3A-2: одобрение снимает метку', () => {
  it('applyApprovalDecision approved → метка signup_blocked снимается', async () => {
    const r = await applyApprovalDecision({ userId: UID, status: 'approved' })
    expect(r.affected).toBe(1)
    expect(s.updateUserById).toHaveBeenCalledWith(UID, CLEAR)
  })

  it('отказ метку не трогает', async () => {
    await applyApprovalDecision({ userId: UID, status: 'rejected', sendEmail: false })
    expect(s.updateUserById).not.toHaveBeenCalled()
  })
})
