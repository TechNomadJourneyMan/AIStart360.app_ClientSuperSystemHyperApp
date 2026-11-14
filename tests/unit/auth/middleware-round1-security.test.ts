/**
 * Middleware, round 1 security fixes:
 *  R-132 — the step-up proof counts only in the session it was made in; a
 *          stale proof (other session / signed out) is deleted.
 *  R-008 — impersonation is checked against the server record: a session
 *          minted for an impersonation is recognised and ended even without
 *          the cookie; the DB mode (view) wins; ending revokes only that
 *          session (signOut scope 'local').
 *  R-052 — a client whose account is not approved yet reaches only the
 *          sections open before approval (lib/client-shell/nav.ts).
 *  R-140 — when the profile cannot be read, protected pages are not served
 *          as if the user were an ordinary approved client.
 *  R-223 — «static file» shortcuts apply to real static paths only.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'
import { createChunks, stringToBase64URL } from '@supabase/ssr'

const SESSION = '11111111-1111-4111-8111-111111111111'
const OTHER = '22222222-2222-4222-8222-222222222222'
const IMP_SID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'

const s = vi.hoisted(() => ({
  user: null as null | { id: string; app_metadata: Record<string, unknown>; user_metadata: Record<string, unknown> },
  role: 'client',
  status: 'approved' as string | null,
  profileError: false,
  staffRow: null as null | { role: string },
  signOuts: [] as unknown[],
  updateSessionCalls: 0,
  bound: null as string | null | 'unknown',
  rowActive: true,
  rowMode: 'edit' as 'view' | 'edit',
  ended: [] as Array<[string, string]>,
  settings: { maintenance: { enabled: false, message: '', until: '' }, staff_require_mfa: false },
}))

const withAbort = <T extends object>(o: T): T => Object.assign(o, { abortSignal: () => o })
vi.mock('@/lib/settings/edge', () => ({ edgeSettings: async () => s.settings }))
vi.mock('@/lib/platform/sections-edge', () => ({ blockedSectionFor: async () => null, loadEdgeSections: async () => [] }))
vi.mock('@/lib/impersonation/edge', () => ({
  isImpersonationActiveEdge: async () => s.rowActive,
  endImpersonationEdge: async (sid: string, reason: string) => { s.ended.push([sid, reason]) },
  auditImpersonatedRequestEdge: async () => {},
}))
vi.mock('@/lib/impersonation/state-edge', () => ({
  impersonationRowEdge: async () => ({ active: s.rowActive, mode: s.rowMode, targetUserId: 'u-1' }),
  boundImpersonationEdge: async () => s.bound,
}))
vi.mock('@/lib/supabase/middleware', () => ({
  updateSession: async () => {
    s.updateSessionCalls++
    const from = (table: string) => ({
      select: () => ({
        eq: () => withAbort({
          maybeSingle: async () => {
            if (table === 'profiles' && s.profileError) return { data: null, error: { message: 'canceling statement due to timeout' } }
            return { data: table === 'profiles' ? { role: s.role, status: s.status } : s.staffRow, error: null }
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

const { middleware, config } = await import('@/middleware')
const { signStepUp, MFA_COOKIE_NAME } = await import('@/lib/mfa/step-up')
const { signImpersonation, IMP_COOKIE_NAME } = await import('@/lib/impersonation/token')

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url')
const authCookies = (sid: string, expSec = Math.floor(Date.now() / 1000) + 3600) =>
  createChunks('sb-supabase-auth-token', `base64-${stringToBase64URL(JSON.stringify({ access_token: `${b64({ alg: 'HS256' })}.${b64({ sub: 'u-1', session_id: sid, exp: expSec })}.sig` }))}`)

function req(path: string, opts: { method?: string; session?: string | null; cookies?: Record<string, string> } = {}) {
  const jar: string[] = []
  if (opts.session !== null) for (const c of authCookies(opts.session ?? SESSION)) jar.push(`${c.name}=${c.value}`)
  for (const [k, v] of Object.entries(opts.cookies ?? {})) jar.push(`${k}=${v}`)
  return new NextRequest(`http://localhost${path}`, { method: opts.method ?? 'GET', headers: jar.length ? { cookie: jar.join('; ') } : {} })
}
const location = (res: Response) => { const l = res.headers.get('location'); return l ? new URL(l).pathname + new URL(l).search : null }
const deletesCookie = (res: NextResponse, name: string) => res.cookies.get(name)?.value === '' || /expires=Thu, 01 Jan 1970|Max-Age=0/i.test((res.headers.get('set-cookie') ?? '').split(/,(?=\s*\w+=)/).find((c) => c.trim().startsWith(`${name}=`)) ?? '')
const impCookie = (claims: Partial<Record<string, unknown>> = {}) =>
  signImpersonation({ sid: IMP_SID, uid: 'u-1', mode: 'edit', aid: 'admin-1', alabel: 'a@x', tlabel: 't@x', asid: SESSION, ...claims } as never)

beforeEach(() => {
  s.user = { id: 'u-1', app_metadata: {}, user_metadata: {} }
  s.role = 'client'
  s.status = 'approved'
  s.profileError = false
  s.staffRow = null
  s.signOuts = []
  s.updateSessionCalls = 0
  s.bound = null
  s.rowActive = true
  s.rowMode = 'edit'
  s.ended = []
  s.settings = { maintenance: { enabled: false, message: '', until: '' }, staff_require_mfa: false }
})

describe('R-132: step-up proof bound to the session (middleware)', () => {
  it('R-132: the proof of this session admits an enrolled user', async () => {
    s.user!.app_metadata = { mfa_totp: true }
    const res = await middleware(req('/client/home', { cookies: { [MFA_COOKIE_NAME]: signStepUp('u-1', SESSION) } }))
    expect(res.status).toBe(200)
  })

  it('R-132: the proof of a previous session sends to /2fa and is deleted', async () => {
    s.user!.app_metadata = { mfa_totp: true }
    const res = await middleware(req('/client/home', { cookies: { [MFA_COOKIE_NAME]: signStepUp('u-1', OTHER) } }))
    expect(location(res)).toMatch(/^\/2fa/)
    expect(deletesCookie(res, MFA_COOKIE_NAME)).toBe(true)
  })

  it('R-132: a signed-out browser loses its leftover proof', async () => {
    s.user = null
    const res = await middleware(req('/login', { session: null, cookies: { [MFA_COOKIE_NAME]: signStepUp('u-1', SESSION) } }))
    expect(deletesCookie(res, MFA_COOKIE_NAME)).toBe(true)
  })
})

describe('R-008: impersonation checked against the server record (pages)', () => {
  it('R-008: a session minted for an impersonation is ended even when the cookie was deleted', async () => {
    s.bound = IMP_SID
    const res = await middleware(req('/client/home'))
    expect(location(res)).toBe('/admin-giga-panel/impersonation?ended=closed')
    expect(s.signOuts).toEqual([{ scope: 'local' }])
    expect(s.ended).toEqual([[IMP_SID, 'cookie_missing']])
  })

  it('R-008: a cookie minted for another session does not make this one an impersonation', async () => {
    s.bound = IMP_SID
    const res = await middleware(req('/client/home', { session: OTHER, cookies: { [IMP_COOKIE_NAME]: await impCookie() } }))
    expect(location(res)).toBe('/admin-giga-panel/impersonation?ended=closed')
    expect(s.signOuts).toEqual([{ scope: 'local' }])
  })

  it('R-008: an ordinary session is untouched', async () => {
    s.bound = null
    expect((await middleware(req('/client/home'))).status).toBe(200)
    expect(s.signOuts).toEqual([])
  })

  it('R-008: the DB mode wins — a «view» row is view even if the cookie says edit', async () => {
    s.rowMode = 'view'
    const res = await middleware(req('/client/home', { cookies: { [IMP_COOKIE_NAME]: await impCookie({ mode: 'edit' }) } }))
    expect(res.status).toBe(200)
    expect(res.headers.get('x-impersonation')).toBe('view')
  })

  it('R-008: an ended impersonation revokes only its own session (scope local)', async () => {
    s.rowActive = false
    const res = await middleware(req('/client/home', { cookies: { [IMP_COOKIE_NAME]: await impCookie() } }))
    expect(location(res)).toBe('/admin-giga-panel/impersonation?ended=closed')
    expect(s.signOuts).toEqual([{ scope: 'local' }])
  })
})

describe('R-008: impersonation checked against the server record (API)', () => {
  it('R-008: API calls of a bound session without the cookie are refused and the session is ended', async () => {
    s.bound = IMP_SID
    const res = await middleware(req('/api/v1/onboarding/survey'))
    expect(res.status).toBe(401)
    expect(s.ended).toEqual([[IMP_SID, 'cookie_missing']])
  })

  it('R-008: an ordinary session calls the API as before', async () => {
    expect((await middleware(req('/api/v1/onboarding/survey', { method: 'POST' }))).status).toBe(200)
    s.bound = 'unknown' // binding unreadable: do not lock everybody out
    expect((await middleware(req('/api/v1/onboarding/survey', { method: 'POST' }))).status).toBe(200)
  })

  it('R-008: «view» in the DB blocks mutations even if the cookie says edit', async () => {
    s.rowMode = 'view'
    const res = await middleware(req('/api/v1/onboarding/survey', { method: 'POST', cookies: { [IMP_COOKIE_NAME]: await impCookie({ mode: 'edit' }) } }))
    expect(res.status).toBe(403)
  })

  it('R-008: a closed impersonation cannot read through the API either', async () => {
    s.rowActive = false
    const res = await middleware(req('/api/v1/onboarding/survey', { cookies: { [IMP_COOKIE_NAME]: await impCookie() } }))
    expect(res.status).toBe(401)
  })

  it('R-008: the cookie works only with the session it was minted for', async () => {
    const res = await middleware(req('/api/v1/onboarding/survey', { method: 'POST', session: OTHER, cookies: { [IMP_COOKIE_NAME]: await impCookie() } }))
    expect(res.status).toBe(401)
  })
})

describe('R-052: a client awaiting approval', () => {
  it.each(['/dashboard', '/client/point-a', '/client/point-b', '/point-a', '/point-b', '/simulator', '/metrics', '/market', '/pulse', '/client/scenarios', '/client/dashboard-medical'])(
    'R-052: %s is closed before approval',
    async (path) => {
      s.status = 'pending_approval'
      expect(location(await middleware(req(path)))).toBe('/client/home?unavailable=pending_approval')
    },
  )

  it.each(['/client/home', '/client/onboarding', '/client/onboarding/documents', '/gri', '/client/messages', '/client/waiting-room', '/settings', '/profile', '/notifications'])(
    'R-052: %s stays open before approval',
    async (path) => {
      s.status = 'pending_approval'
      expect((await middleware(req(path))).status).toBe(200)
    },
  )

  it('R-052: nothing changes for an approved client', async () => {
    for (const p of ['/dashboard', '/client/point-a', '/client/point-b', '/point-b']) expect((await middleware(req(p))).status, p).toBe(200)
  })

  it('R-052: staff whose profile says client are not affected', async () => {
    s.status = 'requires_clarification'
    s.staffRow = { role: 'support' }
    expect((await middleware(req('/client/point-a'))).status).toBe(200)
  })
})

describe('R-140: the profile could not be read', () => {
  it('R-140: a protected page answers «temporary error» instead of passing as an approved client', async () => {
    s.profileError = true
    const res = await middleware(req('/client/point-a'))
    expect(res.status).toBe(503)
    expect(res.headers.get('retry-after')).toBeTruthy()
    expect(await res.text()).toMatch(/обновите/i)
  })

  it('R-140: an expert is not sent to the client dashboard', async () => {
    s.profileError = true
    expect((await middleware(req('/expert/dashboard'))).status).toBe(503)
  })

  it('R-140: public pages still open', async () => {
    s.profileError = true
    expect((await middleware(req('/login'))).status).toBe(200)
    expect((await middleware(req('/maintenance'))).status).toBe(200)
  })
})

describe('R-223: static shortcuts only for real static paths', () => {
  it.each(['/admin-giga-panel/users/x.js', '/client/point-a/x.css', '/dashboard/a.map', '/settings/x.txt'])('R-223: %s goes through the auth gate', async (path) => {
    s.user = null
    const res = await middleware(req(path, { session: null }))
    expect(res.status).toBe(307)
    expect(s.updateSessionCalls).toBe(1)
  })

  it.each(['/sw.js', '/workbox-abc.js', '/robots.txt', '/fonts/Inter-Variable.woff2', '/icon.png', '/_next/static/chunks/a.js'])('R-223: %s is served without the auth round trip', async (path) => {
    s.user = null
    const res = await middleware(req(path, { session: null }))
    expect(res.status).toBe(200)
    expect(s.updateSessionCalls).toBe(0)
  })

  it('R-223: the matcher skips only root-level images, not nested paths', async () => {
    const { getMiddlewareMatchers } = await import('next/dist/build/analysis/get-page-static-info')
    const [m] = getMiddlewareMatchers(config.matcher[0], { i18n: null, basePath: '' } as never)
    const re = new RegExp(m.regexp)
    expect(re.test('/logo.svg')).toBe(false)
    expect(re.test('/icon.png')).toBe(false)
    expect(re.test('/admin-giga-panel/users/x.png')).toBe(true)
    expect(re.test('/client/home/a.svg')).toBe(true)
  })
})
