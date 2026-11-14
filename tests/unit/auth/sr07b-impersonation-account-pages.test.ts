/**
 * SR-07b (P1): во время impersonation сотрудник держит настоящую сессию GoTrue
 * клиента. Страницы портала, через которые меняют учётные данные или защиту
 * клиента, из этого режима не открываются:
 *  - /auth/reset-password вызывает supabase.auth.updateUser({password}) прямо
 *    из браузера (мимо Next API и guard.ts) → захват аккаунта клиента;
 *  - /2fa (step-up клиента, расход резервных кодов, глобальный «Выйти»);
 *  - /settings?tab=security (пароль, факторы 2FA, ключи, сессии).
 * Ответ — редирект в кабинет клиента с пояснением
 * «Недоступно в режиме просмотра от имени клиента». Обычный клиент ходит на эти
 * страницы как раньше. Не удалось выяснить, impersonation ли это (привязка или
 * профиль не читаются) → страница не отдаётся (fail closed).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'
import { createChunks, stringToBase64URL } from '@supabase/ssr'

const SESSION = '11111111-1111-4111-8111-111111111111'
const IMP_SID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'

const s = vi.hoisted(() => ({
  user: null as null | { id: string; app_metadata: Record<string, unknown>; user_metadata: Record<string, unknown> },
  role: 'client',
  status: 'approved' as string | null,
  profileError: false,
  signOuts: [] as unknown[],
  bound: null as string | null | 'unknown',
  rowActive: true,
  rowMode: 'edit' as 'view' | 'edit',
  ended: [] as Array<[string, string]>,
  audits: [] as Array<Record<string, unknown>>,
}))

const withAbort = <T extends object>(o: T): T => Object.assign(o, { abortSignal: () => o })
vi.mock('@/lib/settings/edge', () => ({ edgeSettings: async () => ({ maintenance: { enabled: false, message: '', until: '' }, staff_require_mfa: false }) }))
vi.mock('@/lib/platform/sections-edge', () => ({ blockedSectionFor: async () => null, loadEdgeSections: async () => [] }))
vi.mock('@/lib/impersonation/edge', () => ({
  isImpersonationActiveEdge: async () => s.rowActive,
  endImpersonationEdge: async (sid: string, reason: string) => { s.ended.push([sid, reason]) },
  auditImpersonatedRequestEdge: async (entry: Record<string, unknown>) => { s.audits.push(entry) },
}))
vi.mock('@/lib/impersonation/state-edge', () => ({
  impersonationRowEdge: async () => ({ active: s.rowActive, mode: s.rowMode, targetUserId: 'u-1' }),
  boundImpersonationEdge: async () => s.bound,
}))
vi.mock('@/lib/supabase/middleware', () => ({
  updateSession: async () => {
    const from = (table: string) => ({
      select: () => ({
        eq: () => withAbort({
          maybeSingle: async () => {
            if (table === 'profiles' && s.profileError) return { data: null, error: { message: 'timeout' } }
            return { data: table === 'profiles' ? { role: s.role, status: s.status } : null, error: null }
          },
        }),
      }),
    })
    return {
      supabase: { from, auth: { signOut: async (o?: unknown) => { s.signOuts.push(o ?? 'DEFAULT(global)'); return { error: null } } } },
      response: NextResponse.next(),
      user: s.user,
    }
  },
}))

process.env.AUTH_SECRET = 'test-auth-secret-for-step-up'
process.env.GIGA_COOKIE_SECRET = 'test-secret-for-signed-tokens-0123456789'
process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://supabase.example.app'

const { middleware } = await import('@/middleware')
const { signImpersonation, IMP_COOKIE_NAME } = await import('@/lib/impersonation/token')
const { isAccountSecurityPage, IMPERSONATION_LOCKED_REDIRECT } = await import('@/lib/impersonation/account-pages')

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url')
const authCookies = (sid: string) =>
  createChunks('sb-supabase-auth-token', `base64-${stringToBase64URL(JSON.stringify({ access_token: `${b64({ alg: 'HS256' })}.${b64({ sub: 'u-1', session_id: sid, exp: Math.floor(Date.now() / 1000) + 3600 })}.sig` }))}`)

function req(path: string, cookies: Record<string, string> = {}) {
  const jar = authCookies(SESSION).map((c) => `${c.name}=${c.value}`)
  for (const [k, v] of Object.entries(cookies)) jar.push(`${k}=${v}`)
  return new NextRequest(`http://localhost${path}`, { headers: { cookie: jar.join('; ') } })
}
const location = (res: Response) => { const l = res.headers.get('location'); return l ? new URL(l).pathname + new URL(l).search : null }
const impCookie = (mode: 'view' | 'edit' = 'view') =>
  signImpersonation({ sid: IMP_SID, uid: 'u-1', mode, aid: 'admin-1', alabel: 'a@x', tlabel: 't@x', asid: SESSION } as never)

beforeEach(() => {
  s.user = { id: 'u-1', app_metadata: {}, user_metadata: {} }
  s.role = 'client'
  s.status = 'approved'
  s.profileError = false
  s.signOuts = []
  s.bound = null
  s.rowActive = true
  s.rowMode = 'edit'
  s.ended = []
  s.audits = []
})

describe('SR-07b: страницы учётной записи клиента закрыты в impersonation (middleware)', () => {
  const LOCKED = [
    '/auth/reset-password',
    '/auth/reset-password?code=abcdefabcdefabcdefabcdef',
    '/2fa',
    '/2fa?from=%2Fsettings%3Ftab%3Dsecurity',
    '/settings?tab=security',
    '/settings?tab=security&mfa=required',
    '/settings?tab=profile&tab=security',
  ]

  for (const path of LOCKED) {
    it(`SR-07b: ${path} в режиме просмотра → кабинет клиента с пояснением`, async () => {
      const res = await middleware(req(path, { [IMP_COOKIE_NAME]: await impCookie('view') }))
      expect(location(res)).toBe(IMPERSONATION_LOCKED_REDIRECT)
      // Сессию impersonation не завершаем и клиента не выкидываем.
      expect(s.signOuts).toEqual([])
      expect(s.ended).toEqual([])
    })
  }

  it('SR-07b: режим правки тоже не открывает /auth/reset-password', async () => {
    const res = await middleware(req('/auth/reset-password', { [IMP_COOKIE_NAME]: await impCookie('edit') }))
    expect(location(res)).toBe(IMPERSONATION_LOCKED_REDIRECT)
  })

  it('SR-07b: попытка пишется в журнал impersonation', async () => {
    await middleware(req('/auth/reset-password', { [IMP_COOKIE_NAME]: await impCookie('view') }))
    expect(s.audits).toHaveLength(1)
    expect(s.audits[0]).toMatchObject({ sid: IMP_SID, adminId: 'admin-1', targetUserId: 'u-1', action: 'impersonation.account_page_blocked', path: '/auth/reset-password' })
  })

  it('SR-07b: остальные вкладки настроек и кабинет в impersonation открываются', async () => {
    for (const path of ['/settings', '/settings?tab=profile', '/settings?tab=notifications', '/client/home']) {
      const res = await middleware(req(path, { [IMP_COOKIE_NAME]: await impCookie('view') }))
      expect(res.status, path).toBe(200)
    }
  })

  it('SR-07b: обычный клиент открывает эти страницы как раньше', async () => {
    for (const path of ['/auth/reset-password', '/settings?tab=security', '/2fa']) {
      const res = await middleware(req(path))
      expect(location(res), path).toBeNull()
      expect(res.status, path).toBe(200)
    }
    expect(s.audits).toEqual([])
  })

  it('SR-07b: привязку сессии не удалось прочитать → страница пароля не отдаётся (fail closed)', async () => {
    s.bound = 'unknown'
    const res = await middleware(req('/auth/reset-password'))
    expect(res.status).toBe(503)
    // Прочие страницы при этом работают как раньше.
    expect((await middleware(req('/client/home'))).status).toBe(200)
  })

  it('SR-07b: профиль не читается → /auth/reset-password не отдаётся как «публичная» страница', async () => {
    s.profileError = true
    const res = await middleware(req('/auth/reset-password', { [IMP_COOKIE_NAME]: await impCookie('view') }))
    expect(res.status).toBe(503)
  })
})

describe('SR-07b: isAccountSecurityPage', () => {
  const page = (url: string) => { const u = new URL(url, 'http://x'); return isAccountSecurityPage(u.pathname, u.searchParams) }
  it('SR-07b: распознаёт страницы учётной записи', () => {
    expect(page('/auth/reset-password')).toBe(true)
    expect(page('/auth/reset-password/')).toBe(true)
    expect(page('/2fa')).toBe(true)
    expect(page('/settings?tab=security')).toBe(true)
    expect(page('/settings?tab=SECURITY')).toBe(true)
  })
  it('SR-07b: не трогает остальное', () => {
    expect(page('/settings')).toBe(false)
    expect(page('/settings?tab=profile')).toBe(false)
    expect(page('/2fa-help')).toBe(false)
    expect(page('/auth/callback')).toBe(false)
    expect(page('/client/home')).toBe(false)
  })
})
