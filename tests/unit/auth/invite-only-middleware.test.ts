/**
 * R4 B3, ревью W3A-1 / W3A-2: «регистрация по приглашению» держит не только
 * колбэк Google, а middleware — там, куда неизбежно попадает любой вошедший.
 *
 * Профиль ожидающего создаёт триггер handle_new_user для ЛЮБОГО нового
 * пользователя GoTrue (signup по anon-ключу, implicit-вход Google), поэтому:
 *   • метка app_metadata.signup_blocked в JWT закрывает API без запроса в базу
 *     (кроме выхода и формы «Запросить приглашение»);
 *   • помеченный и не одобренный — выход и экран «по приглашению» на любой странице;
 *     одобренный персоналом помеченный входит (W3A-2);
 *   • ожидающий без метки, не приглашённый и созданный ПОСЛЕ включения режима
 *     'invite' — получает метку и тот же экран; регистрации эпохи «по
 *     подтверждению» (созданы раньше) не задеты; сбой чтения — «временная ошибка»;
 *   • персонал и одобренные — без лишних запросов.
 * Настоящие lib/auth/invite-only-{shared,edge}.ts; PostgREST и GoTrue — заглушка
 * транспорта edgeSupabaseFetch.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'
import { createChunks, stringToBase64URL } from '@supabase/ssr'

const SESSION = '11111111-1111-4111-8111-111111111111'
const UID = '00000000-0000-4000-8000-0000000000c1'
const SINCE = '2026-11-01T00:00:00.000Z' // when 'invite' was switched on

const s = vi.hoisted(() => ({
  user: null as null | { id: string; email: string; created_at: string; invited_at?: string | null; app_metadata: Record<string, unknown>; user_metadata: Record<string, unknown> },
  role: 'client',
  status: 'pending_approval' as string | null,
  staffRow: null as null | { role: string },
  signOuts: 0,
  mode: { value: 'invite', updated_at: '2026-11-01T00:00:00.000Z' } as { value: unknown; updated_at: string } | null,
  modeDown: false,
  invitations: [] as string[],
  marks: [] as Array<{ url: string; body: Record<string, unknown> }>,
  fetches: [] as string[],
}))

const withAbort = <T extends object>(o: T): T => Object.assign(o, { abortSignal: () => o })
vi.mock('@/lib/supabase/transport-edge', () => ({
  edgeSupabaseFetch: async (input: string | URL, init?: RequestInit) => {
    const url = String(input)
    s.fetches.push(url)
    if (url.includes('/auth/v1/admin/users/')) {
      s.marks.push({ url, body: JSON.parse(String(init?.body ?? '{}')) })
      return new Response('{}', { status: 200 })
    }
    if (url.includes('/rest/v1/system_settings')) {
      if (s.modeDown) return new Response('too many clients', { status: 503 })
      return Response.json(s.mode ? [s.mode] : [])
    }
    if (url.includes('/rest/v1/platform_invitations')) {
      const email = decodeURIComponent(/email=eq\.([^&]+)/.exec(url)?.[1] ?? '')
      return Response.json(s.invitations.includes(email) ? [{ id: 'inv' }] : [])
    }
    return Response.json([])
  },
}))
vi.mock('@/lib/settings/edge', () => ({ edgeSettings: async () => ({ maintenance: { enabled: false, message: '', until: '' }, staff_require_mfa: false }) }))
vi.mock('@/lib/platform/sections-edge', () => ({ blockedSectionFor: async () => null, loadEdgeSections: async () => [] }))
vi.mock('@/lib/impersonation/edge', () => ({ isImpersonationActiveEdge: async () => false, endImpersonationEdge: async () => {}, auditImpersonatedRequestEdge: async () => {} }))
vi.mock('@/lib/impersonation/state-edge', () => ({ impersonationRowEdge: async () => null, boundImpersonationEdge: async () => null }))
vi.mock('@/lib/supabase/middleware', () => ({
  updateSession: async () => {
    const from = (table: string) => ({
      select: () => ({
        eq: () => withAbort({
          maybeSingle: async () => ({ data: table === 'profiles' ? { role: s.role, status: s.status } : s.staffRow, error: null }),
        }),
      }),
    })
    return {
      supabase: { from, auth: { signOut: async () => { s.signOuts++; return { error: null } } } },
      response: NextResponse.next(),
      user: s.user,
    }
  },
}))

process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://supabase.example.app'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service'

const { middleware } = await import('@/middleware')
const { __resetInviteOnlyEdgeCacheForTests } = await import('@/lib/auth/invite-only-edge')

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url')
const authCookies = (appMeta: Record<string, unknown> = {}) =>
  createChunks('sb-supabase-auth-token', `base64-${stringToBase64URL(JSON.stringify({
    access_token: `${b64({ alg: 'HS256' })}.${b64({ sub: UID, session_id: SESSION, exp: Math.floor(Date.now() / 1000) + 3600, app_metadata: appMeta })}.sig`,
  }))}`)
const req = (path: string, opts: { method?: string; appMeta?: Record<string, unknown> } = {}) => {
  const jar = authCookies(opts.appMeta).map((c) => `${c.name}=${c.value}`)
  return new NextRequest(`http://localhost${path}`, { method: opts.method ?? 'GET', headers: { cookie: jar.join('; ') } })
}
const location = (res: Response) => { const l = res.headers.get('location'); return l ? new URL(l).pathname + new URL(l).search : null }
const expiresSession = (res: Response) =>
  (res.headers.getSetCookie?.() ?? []).some((c) => /^sb-supabase-auth-token=;/.test(c) && /Max-Age=0/i.test(c))
const MARK = { signup_blocked: 'invite_only' }

beforeEach(() => {
  __resetInviteOnlyEdgeCacheForTests()
  s.user = { id: UID, email: 'new@corp.kz', created_at: '2026-11-16T10:00:00.000Z', invited_at: null, app_metadata: { provider: 'email' }, user_metadata: {} }
  s.role = 'client'
  s.status = 'pending_approval'
  s.staffRow = null
  s.signOuts = 0
  s.mode = { value: 'invite', updated_at: SINCE }
  s.modeDown = false
  s.invitations = []
  s.marks = []
  s.fetches = []
})

describe('W3A-1: метка в JWT закрывает API без запроса в базу', () => {
  it('помеченный токен → 403 «по приглашению» и выход из сессии в том же ответе', async () => {
    const res = await middleware(req('/api/v1/ai/chat', { method: 'POST', appMeta: MARK }))
    expect(res.status).toBe(403)
    expect((await res.json()).code).toBe('invite_only')
    expect(expiresSession(res)).toBe(true)
    expect(s.fetches).toEqual([])
  })

  it('выход и форма «Запросить приглашение» остаются открыты; без метки API как раньше', async () => {
    expect((await middleware(req('/api/v1/auth/sign-out', { method: 'POST', appMeta: MARK }))).status).toBe(200)
    expect((await middleware(req('/api/auth/request-invite', { method: 'POST', appMeta: MARK }))).status).toBe(200)
    expect((await middleware(req('/api/v1/ai/chat', { method: 'POST' }))).status).toBe(200)
  })
})

describe('W3A-1 / W3A-2: страницы', () => {
  it('помеченный, не одобренный: любая страница → выход и «Регистрация по приглашению»', async () => {
    s.user!.app_metadata = { ...MARK }
    for (const path of ['/client/waiting-room', '/client/onboarding', '/settings']) {
      const res = await middleware(req(path))
      expect(location(res)).toBe('/register?notice=invite_only')
      expect(expiresSession(res)).toBe(true)
    }
    expect(s.signOuts).toBe(3)
  })

  it('на самой /register помеченный видит форму — без сессии, без редиректа', async () => {
    s.user!.app_metadata = { ...MARK }
    const res = await middleware(req('/register?notice=invite_only'))
    expect(location(res)).toBeNull()
    expect(expiresSession(res)).toBe(true)
  })

  it('W3A-2: помеченный, которого одобрил персонал, входит нормально', async () => {
    s.user!.app_metadata = { ...MARK }
    s.status = 'approved'
    const res = await middleware(req('/client/home'))
    expect(res.status).toBe(200)
    expect(location(res)).toBeNull()
    expect(s.signOuts).toBe(0)
  })
})

describe('W3A-1: ожидающий без метки (signup по anon-ключу, implicit-вход Google)', () => {
  it('создан после включения «по приглашению», не приглашён → метка, выход, экран «по приглашению»', async () => {
    const res = await middleware(req('/client/waiting-room'))
    expect(location(res)).toBe('/register?notice=invite_only')
    expect(s.signOuts).toBe(1)
    expect(s.marks).toHaveLength(1)
    expect(s.marks[0].url).toContain(`/auth/v1/admin/users/${UID}`)
    expect(s.marks[0].body).toEqual({ app_metadata: expect.objectContaining({ signup_blocked: 'invite_only' }) })
  })

  it('регистрации эпохи «по подтверждению» (созданы ДО включения режима) не задеты', async () => {
    s.user!.created_at = '2026-06-15T09:00:00.000Z'
    const res = await middleware(req('/client/waiting-room'))
    expect(res.status).toBe(200)
    expect(location(res)).toBeNull()
    expect(s.marks).toHaveLength(0)
    expect(s.signOuts).toBe(0)
  })

  it('приглашённый: invited_at (без запросов) или строка platform_invitations — входит', async () => {
    s.user!.invited_at = '2026-11-16T09:00:00.000Z'
    expect((await middleware(req('/client/waiting-room'))).status).toBe(200)
    expect(s.fetches).toEqual([])
    s.user!.invited_at = null
    s.invitations = ['new@corp.kz']
    expect((await middleware(req('/client/waiting-room'))).status).toBe(200)
    expect(s.marks).toHaveLength(0)
  })

  it('режим не «по приглашению» — входит как раньше', async () => {
    s.mode = { value: 'approval', updated_at: SINCE }
    expect((await middleware(req('/client/waiting-room'))).status).toBe(200)
    expect(s.marks).toHaveLength(0)
  })

  it('сбой чтения режима — «временная ошибка», ничего не помечено и никто не выкинут', async () => {
    s.modeDown = true
    const res = await middleware(req('/client/waiting-room'))
    expect(res.status).toBe(503)
    expect(s.marks).toHaveLength(0)
    expect(s.signOuts).toBe(0)
  })

  it('персонал и одобренные — ни одного лишнего запроса', async () => {
    s.status = 'approved'
    expect((await middleware(req('/client/home'))).status).toBe(200)
    expect(s.fetches).toEqual([])
  })
})
