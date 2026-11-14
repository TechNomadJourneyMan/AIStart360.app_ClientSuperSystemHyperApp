/**
 * V4 (after 143, SR-01): staff pages OUTSIDE the GIGA panel follow the same
 * second-factor rule as the panel and the server (staffMfaGate,
 * staffApiSecondFactor, staff_session_ok()):
 *  - a factor on record (JWT flags OR user_security.totp_enabled OR a passkey)
 *    and no step-up of THIS session → /2fa (RLS would show empty screens);
 *  - no factor while `staff_require_mfa` is on → enrol in /settings;
 *  - the factor state cannot be read → the retry page (fail closed);
 *  - clients, impersonation and dev mode work as before.
 * The factor added after the JWT was issued (flags still false) is seen too —
 * the same in the panel and the SuperExpert cabinet.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'
import { createChunks, stringToBase64URL } from '@supabase/ssr'

const SESSION = '11111111-1111-4111-8111-111111111111'

const s = vi.hoisted(() => ({
  user: null as null | { id: string; app_metadata: Record<string, unknown>; user_metadata: Record<string, unknown> },
  role: 'admin',
  status: 'approved' as string | null,
  staffRow: { role: 'admin' } as null | { role: string },
  factor: false as boolean | null,
  factorCalls: 0,
  devMode: false,
  settings: { maintenance: { enabled: false, message: '', until: '' }, staff_require_mfa: false },
}))

const withAbort = <T extends object>(o: T): T => Object.assign(o, { abortSignal: () => o })
vi.mock('@/lib/settings/edge', () => ({ edgeSettings: async () => s.settings }))
vi.mock('@/lib/platform/sections-edge', () => ({ blockedSectionFor: async () => null, loadEdgeSections: async () => [] }))
vi.mock('@/lib/impersonation/edge', () => ({
  isImpersonationActiveEdge: async () => true,
  endImpersonationEdge: async () => {},
  auditImpersonatedRequestEdge: async () => {},
}))
vi.mock('@/lib/impersonation/state-edge', () => ({
  impersonationRowEdge: async () => ({ active: true, mode: 'edit', targetUserId: 'u-1' }),
  boundImpersonationEdge: async () => null,
}))
vi.mock('@/lib/mfa/factor-edge', () => ({
  secondFactorOnRecordEdge: async () => { s.factorCalls++; return s.factor },
}))
vi.mock('@/lib/dev/dev-access', async (orig) => ({
  ...(await orig<typeof import('@/lib/dev/dev-access')>()),
  devModeOnForRequest: () => s.devMode,
}))
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
      supabase: { from, auth: { signOut: async () => ({ error: null }) } },
      response: NextResponse.next(),
      user: s.user,
    }
  },
}))

process.env.AUTH_SECRET = 'test-auth-secret-for-step-up'
process.env.GIGA_COOKIE_SECRET = 'test-secret-for-signed-tokens-0123456789'
process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://supabase.example.app'

const { middleware } = await import('@/middleware')
const { signStepUp, MFA_COOKIE_NAME } = await import('@/lib/mfa/step-up')

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url')
const authCookies = (sid: string) =>
  createChunks('sb-supabase-auth-token', `base64-${stringToBase64URL(JSON.stringify({ access_token: `${b64({ alg: 'HS256' })}.${b64({ sub: 'u-1', session_id: sid, exp: Math.floor(Date.now() / 1000) + 3600 })}.sig` }))}`)

function req(path: string, cookies: Record<string, string> = {}) {
  const jar: string[] = authCookies(SESSION).map((c) => `${c.name}=${c.value}`)
  for (const [k, v] of Object.entries(cookies)) jar.push(`${k}=${v}`)
  return new NextRequest(`http://localhost${path}`, { headers: { cookie: jar.join('; ') } })
}
const location = (res: Response) => { const l = res.headers.get('location'); return l ? new URL(l).pathname + new URL(l).search : null }
const stepUp = () => ({ [MFA_COOKIE_NAME]: signStepUp('u-1', SESSION) })
const ENROL = '/settings?tab=security&mfa=required'

beforeEach(() => {
  s.user = { id: 'u-1', app_metadata: {}, user_metadata: {} }
  s.role = 'admin'
  s.status = 'approved'
  s.staffRow = { role: 'admin' }
  s.factor = false
  s.factorCalls = 0
  s.devMode = false
  s.settings = { maintenance: { enabled: false, message: '', until: '' }, staff_require_mfa: false }
})

const STAFF_PAGES = ['/dashboard', '/clients/00000000-0000-4000-8000-000000000001', '/reports']

describe('staff_require_mfa on staff pages outside the panel', () => {
  for (const page of STAFF_PAGES) {
    it(`admin without a factor → enrol (${page})`, async () => {
      s.settings.staff_require_mfa = true
      const res = await middleware(req(page))
      expect(res.status).toBe(307)
      expect(location(res)).toBe(ENROL)
    })
  }

  it('expert without a factor → enrol (/expert/dashboard)', async () => {
    s.role = 'expert'
    s.staffRow = null
    s.settings.staff_require_mfa = true
    const res = await middleware(req('/expert/dashboard'))
    expect(location(res)).toBe(ENROL)
  })

  it('the enrolment page itself is reachable (no loop)', async () => {
    s.settings.staff_require_mfa = true
    const res = await middleware(req('/settings?tab=security&mfa=required'))
    expect(res.status).toBe(200)
  })

  it('setting off, no factor → the page opens', async () => {
    const res = await middleware(req('/dashboard'))
    expect(res.status).toBe(200)
  })
})

describe('a factor on record without a step-up of this session → /2fa', () => {
  it('factor in JWT flags → /2fa (as before)', async () => {
    s.user!.app_metadata = { mfa_totp: true }
    const res = await middleware(req('/clients/x'))
    expect(location(res)).toBe('/2fa?from=%2Fclients%2Fx')
  })

  for (const page of ['/dashboard', '/clients/x', '/expert/dashboard', '/admin-giga-panel/users', '/super-expert/users']) {
    it(`factor only in the DB (added after the JWT) → /2fa (${page})`, async () => {
      if (page.startsWith('/expert')) { s.role = 'expert'; s.staffRow = null }
      if (page.startsWith('/super-expert')) { s.role = 'client'; s.staffRow = { role: 'super_expert' } }
      s.factor = true
      const res = await middleware(req(page))
      expect(res.status).toBe(307)
      expect(location(res)?.startsWith('/2fa?from=')).toBe(true)
    })
  }

  it('factor + step-up of this session → the page opens, the DB is not asked', async () => {
    s.factor = true
    s.settings.staff_require_mfa = true
    const res = await middleware(req('/dashboard', stepUp()))
    expect(res.status).toBe(200)
    expect(s.factorCalls).toBe(0)
  })

  it('a factor on record wins over the enrolment rule', async () => {
    s.factor = true
    s.settings.staff_require_mfa = true
    const res = await middleware(req('/dashboard'))
    expect(location(res)).toBe('/2fa?from=%2Fdashboard')
  })
})

describe('fail closed / unaffected callers', () => {
  it('factor state unreadable → retry page, not the page', async () => {
    s.factor = null
    const res = await middleware(req('/dashboard'))
    expect(res.status).toBe(503)
  })

  it('factor state unreadable in the panel → retry page', async () => {
    s.factor = null
    const res = await middleware(req('/admin-giga-panel'))
    expect(res.status).toBe(503)
  })

  it('a client: no DB read, setting does not apply', async () => {
    s.role = 'client'
    s.staffRow = null
    s.settings.staff_require_mfa = true
    const res = await middleware(req('/dashboard'))
    expect(res.status).toBe(200)
    expect(s.factorCalls).toBe(0)
  })

  it('a client with a factor in the JWT still passes /2fa (unchanged)', async () => {
    s.role = 'client'
    s.staffRow = null
    s.user!.app_metadata = { mfa_totp: true }
    const res = await middleware(req('/client/home'))
    expect(location(res)).toBe('/2fa?from=%2Fclient%2Fhome')
  })

  it('dev mode: neither /2fa nor enrolment', async () => {
    s.devMode = true
    s.factor = true
    s.settings.staff_require_mfa = true
    const res = await middleware(req('/dashboard'))
    expect(res.status).toBe(200)
  })

  it('/2fa itself is never redirected', async () => {
    s.factor = true
    s.settings.staff_require_mfa = true
    const res = await middleware(req('/2fa?from=/dashboard'))
    expect(res.status).toBe(200)
  })
})
