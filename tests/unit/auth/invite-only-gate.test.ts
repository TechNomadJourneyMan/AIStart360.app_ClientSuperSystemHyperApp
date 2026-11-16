/**
 * R4 B3 (N4B-3 / N4B-14): регистрация по приглашению не обходится через Google.
 *
 * /auth/callback в режиме «по приглашению»: НОВЫЙ человек без приглашения не
 * получает заявку и уведомления — помечается (app_metadata.signup_blocked),
 * выходит из сессии и видит «Регистрация по приглашению». Не ломается:
 * существующий клиент, приглашённый, персонал, режимы approval/open.
 * /auth/verify: помеченный аккаунт не входит и по ссылке на почту, пока его не
 * пригласят. GOTRUE_DISABLE_SIGNUP: отказ GoTrue ведёт на тот же экран.
 * POST /api/v1/auth/email-link: ссылка (а с ней новый пользователь GoTrue) —
 * только для существующего аккаунта.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

type Row = Record<string, unknown>

const s = vi.hoisted(() => ({
  mode: 'invite' as string,
  user: null as null | { id: string; email: string; created_at: string; app_metadata?: Record<string, unknown>; user_metadata?: Record<string, unknown> },
  tables: {} as Record<string, Row[]>,
  profileReadFails: false,
  signOut: vi.fn(async () => ({ error: null })),
  updateUserById: vi.fn(async (..._a: unknown[]) => ({ data: {}, error: null })),
  adminRequestCreate: vi.fn(async () => ({ id: 'req-1' })),
  notifyAdmins: vi.fn(async (..._a: unknown[]) => {}),
  acceptInvitation: vi.fn(async (..._a: unknown[]) => ({ accepted: false, staffRole: null, secured: false })),
  generateLink: vi.fn(async () => ({ data: { properties: { hashed_token: 'hash-1' } }, error: null })),
  sent: [] as unknown[],
}))

vi.mock('@supabase/ssr', () => ({
  createServerClient: (_u: string, _k: string, opts: { cookies: { setAll: (c: Array<{ name: string; value: string; options?: Row }>) => void } }) => ({
    auth: {
      exchangeCodeForSession: async () => {
        // The exchange sets the session cookies on the response.
        opts.cookies.setAll([{ name: 'sb-ref-auth-token', value: 'session', options: { path: '/' } }])
        return { data: { user: s.user } }
      },
      verifyOtp: async () => {
        opts.cookies.setAll([{ name: 'sb-ref-auth-token', value: 'session', options: { path: '/' } }])
        return { data: { user: s.user, session: { access_token: 'jwt' } }, error: null }
      },
      signOut: s.signOut,
    },
  }),
}))
vi.mock('@/lib/settings/system-settings', () => ({ getRegistrationMode: async () => s.mode }))
vi.mock('@/lib/db', () => ({ prisma: { adminRequest: { create: s.adminRequestCreate } } }))
vi.mock('@/lib/notifications', () => ({ notifyAdmins: s.notifyAdmins }))
vi.mock('@/lib/background', () => ({ runInBackground: async (_l: string, work: () => Promise<unknown>) => { await work() } }))
vi.mock('@/lib/events/track', () => ({ trackEvent: async () => {} }))
vi.mock('@/lib/site-url', () => ({ requestOrigin: () => 'https://portal.aistart360.app', getSiteUrl: () => 'https://portal.aistart360.app' }))
vi.mock('@/lib/admin/invites', () => ({ acceptInvitation: s.acceptInvitation }))
vi.mock('@/lib/rate-limit', () => ({ isRateLimitedKey: async () => false }))
vi.mock('@/lib/email', () => ({ sendNotificationEmail: async (o: unknown) => { s.sent.push(o); return { data: { id: 'm' }, error: null } } }))
vi.mock('@/lib/supabase-service', () => ({
  createServiceClient: () => ({
    auth: { admin: { updateUserById: s.updateUserById, generateLink: s.generateLink } },
    from(table: string) {
      const filters: Array<(r: Row) => boolean> = []
      const rows = () => (s.tables[table] ?? []).filter((r) => filters.every((f) => f(r)))
      const q: Row = {}
      Object.assign(q, {
        select: () => q,
        limit: () => q,
        eq: (c: string, v: unknown) => { filters.push((r) => r[c] === v); return q },
        ilike: (c: string, v: unknown) => { filters.push((r) => String(r[c] ?? '').toLowerCase() === String(v).replace(/\\(.)/g, '$1').toLowerCase()); return q },
        in: (c: string, vs: unknown[]) => { filters.push((r) => vs.includes(r[c])); return q },
        single: async () => (table === 'profiles' && s.profileReadFails
          ? { data: null, error: { message: 'timeout' } }
          : { data: rows()[0] ?? null, error: rows()[0] ? null : { code: 'PGRST116' } }),
        maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
        upsert: async () => ({ error: null }),
      })
      return q
    },
  }),
}))

const { GET: callback } = await import('@/app/auth/callback/route')
const { GET: verify } = await import('@/app/auth/verify/route')
const { POST: emailLink } = await import('@/app/api/v1/auth/email-link/route')

const ID = '00000000-0000-4000-8000-00000000000b'
const MIN = 60_000
const fresh = () => new Date(Date.now() - MIN).toISOString()
const old = () => new Date(Date.now() - 90 * 24 * 60 * MIN).toISOString()

const call = (qs = 'code=abc') => callback(new NextRequest(`https://portal.aistart360.app/auth/callback?${qs}`))
const where = (res: Response) => {
  const u = new URL(res.headers.get('location') ?? '')
  return `${u.pathname}${u.search}`
}
const expiredSessionCookie = (res: Response) =>
  (res.headers.getSetCookie?.() ?? [res.headers.get('set-cookie') ?? '']).some((c) => /^sb-ref-auth-token=;/.test(c) && /Max-Age=0/i.test(c))

beforeEach(() => {
  s.mode = 'invite'
  s.profileReadFails = false
  s.user = { id: ID, email: 'new@corp.kz', created_at: fresh(), app_metadata: { provider: 'google' }, user_metadata: { full_name: 'Новый Человек' } }
  // handle_new_user created the profile in the same INSERT as the Google user.
  s.tables = { profiles: [{ id: ID, email: 'new@corp.kz', status: 'pending_approval', role: 'client' }], staff_roles: [], platform_invitations: [] }
  s.signOut.mockClear()
  s.updateUserById.mockClear()
  s.adminRequestCreate.mockClear()
  s.notifyAdmins.mockClear()
  s.acceptInvitation.mockReset()
  s.acceptInvitation.mockResolvedValue({ accepted: false, staffRole: null, secured: false })
  s.generateLink.mockClear()
  s.sent = []
})

describe('/auth/callback, режим «по приглашению»', () => {
  it('новый человек через Google без приглашения: ни заявки, ни уведомления — метка, выход из сессии, экран «по приглашению»', async () => {
    const res = await call()
    expect(where(res)).toBe('/register?notice=invite_only')
    expect(s.adminRequestCreate).not.toHaveBeenCalled()
    expect(s.notifyAdmins).not.toHaveBeenCalled()
    expect(s.signOut).toHaveBeenCalledTimes(1)
    expect(s.updateUserById).toHaveBeenCalledWith(ID, { app_metadata: expect.objectContaining({ signup_blocked: 'invite_only' }) })
    expect(expiredSessionCookie(res)).toBe(true)
  })

  it('вернулся через Google позже 10 минут (профиль «на одобрении» с меткой) — снова экран «по приглашению», не зал ожидания', async () => {
    s.user = { ...s.user!, created_at: old(), app_metadata: { provider: 'google', signup_blocked: 'invite_only' } }
    const res = await call()
    expect(where(res)).toBe('/register?notice=invite_only')
    expect(s.signOut).toHaveBeenCalledTimes(1)
    expect(s.updateUserById).not.toHaveBeenCalled() // already marked
  })

  it('приглашённый (есть приглашение на эту почту) входит как раньше: заявка, уведомление, зал ожидания', async () => {
    s.tables.platform_invitations = [{ id: 'inv-1', email: 'new@corp.kz', status: 'sent' }]
    const res = await call()
    expect(where(res)).toBe('/client/waiting-room')
    expect(s.adminRequestCreate).toHaveBeenCalledTimes(1)
    expect(s.notifyAdmins).toHaveBeenCalledWith('user_registered', expect.objectContaining({ via: 'google_oauth' }), ID)
    expect(s.signOut).not.toHaveBeenCalled()
  })

  it('помеченного позже пригласили — пускаем и снимаем метку', async () => {
    s.user = { ...s.user!, created_at: old(), app_metadata: { signup_blocked: 'invite_only' } }
    s.tables.platform_invitations = [{ id: 'inv-1', email: 'new@corp.kz', status: 'accepted' }]
    const res = await call()
    expect(where(res)).toBe('/client/waiting-room')
    expect(s.signOut).not.toHaveBeenCalled()
    expect(s.updateUserById).toHaveBeenCalledWith(ID, { app_metadata: { signup_blocked: null, signup_blocked_at: null } })
  })

  it('существующий клиент через Google — в кабинет, без проверок режима и выхода', async () => {
    s.user = { ...s.user!, created_at: old() }
    s.tables.profiles = [{ id: ID, status: 'approved', role: 'client' }]
    const res = await call()
    expect(new URL(res.headers.get('location')!).pathname).toBe('/client/home')
    expect(s.signOut).not.toHaveBeenCalled()
  })

  it('сбой чтения профиля у давнего аккаунта не выкидывает его на экран «по приглашению»', async () => {
    s.user = { ...s.user!, created_at: old() }
    s.profileReadFails = true
    const res = await call()
    expect(where(res)).not.toContain('invite_only')
    expect(s.signOut).not.toHaveBeenCalled()
  })

  it('персонал через Google — в свою панель', async () => {
    s.user = { ...s.user!, created_at: old() }
    s.tables.profiles = [{ id: ID, status: 'approved', role: 'client' }]
    s.tables.staff_roles = [{ user_id: ID, role: 'super_admin' }]
    const res = await call()
    expect(new URL(res.headers.get('location')!).pathname).toBe('/admin-giga-panel')
  })
})

describe('/auth/callback, режимы «по подтверждению» и «открытая» — как раньше', () => {
  for (const mode of ['approval', 'open']) {
    it(`${mode}: новый человек через Google — заявка, уведомление, зал ожидания`, async () => {
      s.mode = mode
      const res = await call()
      expect(where(res)).toBe('/client/waiting-room')
      expect(s.adminRequestCreate).toHaveBeenCalledTimes(1)
      expect(s.notifyAdmins).toHaveBeenCalledTimes(1)
      expect(s.signOut).not.toHaveBeenCalled()
      expect(s.updateUserById).not.toHaveBeenCalled()
    })
  }
})

describe('/auth/callback без кода', () => {
  it('GOTRUE_DISABLE_SIGNUP: отказ GoTrue новому человеку → экран «по приглашению»', async () => {
    const res = await call('error=access_denied&error_code=signup_disabled&error_description=Signups+not+allowed+for+this+instance')
    expect(where(res)).toBe('/register?notice=invite_only')
  })

  it('прочие ошибки — форма входа, как раньше', async () => {
    const res = await call('error=access_denied&error_description=cancelled')
    expect(new URL(res.headers.get('location')!).pathname).toBe('/login')
  })
})

describe('/auth/verify: помеченный аккаунт не входит и по ссылке на почту', () => {
  const visit = (qs: string) => verify(new NextRequest(`https://portal.aistart360.app/auth/verify?${qs}`))

  it('ссылка входа без приглашения, режим «по приглашению» — выход и экран «по приглашению»', async () => {
    s.user = { ...s.user!, created_at: old(), app_metadata: { signup_blocked: 'invite_only' } }
    const res = await visit('token_hash=th&type=magiclink')
    expect(where(res)).toBe('/register?notice=invite_only')
    expect(s.signOut).toHaveBeenCalledTimes(1)
    expect(expiredSessionCookie(res)).toBe(true)
  })

  it('ссылка из письма-приглашения приняла приглашение — метка снимается, вход идёт дальше', async () => {
    s.user = { ...s.user!, created_at: old(), app_metadata: { signup_blocked: 'invite_only' } }
    s.acceptInvitation.mockResolvedValue({ accepted: true, staffRole: null, secured: false })
    const res = await visit('token_hash=th&type=magiclink&invite=tok&next=/login')
    expect(new URL(res.headers.get('location')!).pathname).toBe('/login')
    expect(s.signOut).not.toHaveBeenCalled()
    expect(s.updateUserById).toHaveBeenCalledWith(ID, { app_metadata: { signup_blocked: null, signup_blocked_at: null } })
  })

  it('без метки и в режиме «по подтверждению» — как раньше', async () => {
    s.user = { ...s.user!, created_at: old(), app_metadata: {} }
    let res = await visit('token_hash=th&type=magiclink&next=/login')
    expect(new URL(res.headers.get('location')!).pathname).toBe('/login')
    s.mode = 'approval'
    s.user = { ...s.user!, app_metadata: { signup_blocked: 'invite_only' } }
    res = await visit('token_hash=th&type=magiclink&next=/login')
    expect(new URL(res.headers.get('location')!).pathname).toBe('/login')
    expect(s.signOut).not.toHaveBeenCalled()
  })
})

describe('POST /api/v1/auth/email-link: новый пользователь GoTrue не заводится', () => {
  const post = (email: string) => emailLink(new NextRequest('http://localhost/api/v1/auth/email-link', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, purpose: 'login' }),
  }))

  it('незнакомая почта: generateLink (он создал бы аккаунт) не вызывается, ответ тот же', async () => {
    const res = await post('stranger@corp.kz')
    expect(res.status).toBe(200)
    expect((await res.json()).ok).toBe(true)
    expect(s.generateLink).not.toHaveBeenCalled()
    expect(s.sent).toHaveLength(0)
  })

  it('есть аккаунт — ссылка уходит как раньше', async () => {
    s.tables.profiles = [{ id: ID, email: 'known@corp.kz' }]
    await post('Known@Corp.kz')
    expect(s.generateLink).toHaveBeenCalledTimes(1)
    expect(s.sent).toHaveLength(1)
  })
})
