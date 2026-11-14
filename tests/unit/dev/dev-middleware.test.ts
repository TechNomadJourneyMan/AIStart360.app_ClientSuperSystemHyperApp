/**
 * Dev mode in middleware (lib/dev/dev-access.ts): on a developer's localhost,
 * with the dev-mode cookie, exactly two gates are skipped — the maintenance
 * redirect and the second-factor pages (the staff enrolment requirement and
 * the /2fa challenge). Who may open what does not change, and a production
 * build ignores the cookie altogether.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'
import { DEV_MODE_COOKIE } from '@/lib/dev/dev-access'

type Meta = Record<string, unknown>

const s = vi.hoisted(() => ({
  settings: { maintenance: { enabled: false, message: '', until: '' }, staff_require_mfa: false },
  user: null as null | { id: string; app_metadata: Record<string, unknown>; user_metadata: Record<string, unknown> },
  role: 'client',
  status: 'approved',
  staffRow: null as null | { role: string },
  blockedSection: null as string | null,
  signOuts: 0,
  /** Whether the impersonation session of the cookie is still open in the database. */
  impActive: true,
}))

// postgrest builders accept .abortSignal() (middleware times its reads out)
const withAbort = <T extends object>(o: T): T => Object.assign(o, { abortSignal: () => o })
vi.mock('@/lib/settings/edge', () => ({ edgeSettings: async () => s.settings }))
// Nobody here has passed the second factor.
vi.mock('@/lib/mfa/step-up-edge', () => ({ MFA_COOKIE_NAME: 'mfa', verifyStepUpEdge: async () => false }))
vi.mock('@/lib/platform/sections-edge', () => ({ blockedSectionFor: async () => s.blockedSection, loadEdgeSections: async () => [] }))
vi.mock('@/lib/impersonation/edge', () => ({
  isImpersonationActiveEdge: async () => s.impActive,
  endImpersonationEdge: async () => {},
  auditImpersonatedRequestEdge: async () => {},
}))
vi.mock('@/lib/supabase/middleware', () => ({
  updateSession: async () => {
    const from = (table: string) => ({
      select: () => ({
        eq: () => withAbort({
          maybeSingle: async () => ({
            data: table === 'profiles' ? { role: s.role, status: s.status } : s.staffRow,
          }),
        }),
      }),
    })
    return { supabase: { from, auth: { signOut: async () => { s.signOuts++ } } }, response: NextResponse.next(), user: s.user }
  },
}))

const { middleware } = await import('@/middleware')
const { IMP_COOKIE_NAME, signImpersonation } = await import('@/lib/impersonation/token')

const PLATFORM_VARS = ['RAILWAY_ENVIRONMENT', 'RAILWAY_PROJECT_ID', 'VERCEL', 'PERSISTENT_SERVER']
const DEV_COOKIE = `${DEV_MODE_COOKIE}=1`

/** A page request from a browser on this machine; `dev` adds the dev-mode cookie. */
function get(path: string, opts: { dev?: boolean; host?: string; headers?: Record<string, string> } = {}) {
  const headers: Record<string, string> = { host: opts.host ?? 'localhost:3000', ...opts.headers }
  if (opts.dev) headers.cookie = DEV_COOKIE
  return middleware(new NextRequest(`http://localhost:3000${path}`, { headers }))
}
const dev = (path: string) => get(path, { dev: true })
const loc = (r: Response) => r.headers.get('location') ?? ''

const signIn = (role: string, opts: { staff?: string; status?: string; mfa?: Meta } = {}) => {
  s.user = { id: 'u1', app_metadata: opts.mfa ?? {}, user_metadata: {} }
  s.role = role
  s.status = opts.status ?? 'approved'
  // R-002: staff = a staff_roles row; a super_admin test account carries one.
  s.staffRow = opts.staff ? { role: opts.staff } : role === 'super_admin' ? { role: 'super_admin' } : null
}
const ENROLLED = { mfa_totp: true }

beforeEach(() => {
  s.settings = { maintenance: { enabled: false, message: '', until: '' }, staff_require_mfa: false }
  s.blockedSection = null
  s.signOuts = 0
  s.impActive = true
  signIn('client')
  vi.stubEnv('GIGA_COOKIE_SECRET', 'test-secret-for-signed-tokens-0123456789')
  vi.stubEnv('ENABLE_DEV_AUTH_ROUTES', '1')
  for (const name of PLATFORM_VARS) vi.stubEnv(name, '')
})
afterEach(() => {
  vi.unstubAllEnvs()
})

describe('without the dev-mode cookie nothing changes, even where developer access is available', () => {
  it('maintenance closes the client cabinet', async () => {
    s.settings.maintenance.enabled = true
    const r = await get('/client/home')
    expect(r.status).toBe(307)
    expect(loc(r)).toMatch(/\/maintenance$/)
  })

  it('staff without a second factor are sent to enrol', async () => {
    s.settings.staff_require_mfa = true
    signIn('super_admin')
    expect(loc(await get('/admin-giga-panel/users'))).toContain('/settings?tab=security&mfa=required')
    signIn('client', { staff: 'super_expert' })
    expect(loc(await get('/super-expert/users'))).toContain('/settings?tab=security&mfa=required')
  })

  it('an enrolled account is sent to /2fa', async () => {
    signIn('super_admin', { mfa: ENROLLED })
    expect(loc(await get('/admin-giga-panel'))).toContain('/2fa')
    signIn('client', { staff: 'super_expert', mfa: ENROLLED })
    expect(loc(await get('/super-expert'))).toContain('/2fa')
    signIn('client', { mfa: ENROLLED })
    expect(loc(await get('/client/home'))).toContain('/2fa')
  })
})

describe('dev mode skips the maintenance page', () => {
  it('a client reaches the cabinet while maintenance is on', async () => {
    s.settings.maintenance.enabled = true
    for (const path of ['/client/home', '/client/point-a', '/dashboard', '/gri']) {
      const r = await dev(path)
      expect(r.status, path).toBe(200)
      expect(loc(r), path).toBe('')
    }
  })
})

describe('dev mode skips the second-factor pages', () => {
  it('staff without a second factor are not sent to enrol', async () => {
    s.settings.staff_require_mfa = true
    signIn('super_admin')
    expect((await dev('/admin-giga-panel/users')).status).toBe(200)
    signIn('admin', { staff: 'admin' })
    expect((await dev('/admin-giga-panel')).status).toBe(200)
    signIn('client', { staff: 'crm_manager' })
    expect((await dev('/admin-giga-panel/users')).status).toBe(200)
    signIn('client', { staff: 'super_expert' })
    expect((await dev('/super-expert/users')).status).toBe(200)
  })

  it('an enrolled account is not sent to /2fa', async () => {
    s.settings.staff_require_mfa = true
    signIn('super_admin', { mfa: ENROLLED })
    expect((await dev('/admin-giga-panel')).status).toBe(200)
    signIn('client', { staff: 'super_expert', mfa: ENROLLED })
    expect((await dev('/super-expert')).status).toBe(200)
    signIn('client', { mfa: ENROLLED })
    expect((await dev('/client/home')).status).toBe(200)
    signIn('expert', { mfa: ENROLLED })
    expect((await dev('/expert/dashboard')).status).toBe(200)
  })
})

describe('who may open what stays exactly as it was', () => {
  it('dev mode does not widen role access', async () => {
    // Everything in favour of the bypass: maintenance on, 2FA required.
    s.settings.maintenance.enabled = true
    s.settings.staff_require_mfa = true

    // The signed-in developer account is a client.
    signIn('client')
    let r = await dev('/admin-giga-panel')
    expect(r.status).toBe(307)
    expect(loc(r)).toMatch(/\/giga-login$/)
    expect(loc(await dev('/admin-giga-panel/users'))).toMatch(/\/giga-login$/)
    r = await dev('/super-expert')
    expect(r.status).toBe(307)
    expect(loc(r)).toContain('/super-expert/login?denied=1')
    expect(loc(await dev('/expert/dashboard'))).toMatch(/\/dashboard$/)
    expect(loc(await dev('/clients'))).toMatch(/\/dashboard$/)
    expect(loc(await dev('/ai-scanner'))).toMatch(/\/dashboard$/)

    // An expert stays out of the admin pages and the panel.
    signIn('expert')
    expect(loc(await dev('/clients'))).toMatch(/\/expert\/dashboard$/)
    expect(loc(await dev('/admin-giga-panel'))).toMatch(/\/giga-login$/)

    // A staff role that does not open the SuperExpert cabinet still does not.
    signIn('client', { staff: 'content_manager' })
    expect(loc(await dev('/super-expert/users'))).toContain('/super-expert/login?denied=1')
  })

  it('approval status still counts', async () => {
    s.settings.staff_require_mfa = true
    signIn('super_admin', { status: 'pending_approval' })
    expect(loc(await dev('/admin-giga-panel'))).toMatch(/\/giga-login$/)
    signIn('client', { staff: 'super_expert', status: 'pending_approval' })
    expect(loc(await dev('/super-expert'))).toContain('/super-expert/login?denied=1')
  })

  it('a blocked account is signed out', async () => {
    signIn('client', { status: 'blocked' })
    const r = await dev('/client/home')
    expect(loc(r)).toContain('/login?blocked=1')
    expect(s.signOuts).toBe(1)
  })

  it('a guest is sent to the sign-in page', async () => {
    s.user = null
    expect(loc(await dev('/client/home'))).toContain('/login?from=%2Fclient%2Fhome')
    expect(loc(await dev('/admin-giga-panel'))).toMatch(/\/giga-login$/)
    expect(loc(await dev('/super-expert'))).toContain('/super-expert/login')
  })

  it('a section switched off in GIGA-CRM stays closed', async () => {
    s.blockedSection = 'point_b'
    expect(loc(await dev('/client/point-b'))).toContain('/client/home?unavailable=point_b')
  })
})

describe('the cookie alone switches nothing off', () => {
  const gatesAreBack = async (opts: Parameters<typeof get>[1]) => {
    s.settings.maintenance.enabled = true
    s.settings.staff_require_mfa = true
    signIn('client')
    expect(loc(await get('/client/home', opts))).toMatch(/\/maintenance$/)
    signIn('super_admin')
    expect(loc(await get('/admin-giga-panel/users', opts))).toContain('/settings?tab=security&mfa=required')
    signIn('client', { staff: 'super_expert' })
    expect(loc(await get('/super-expert', opts))).toContain('/settings?tab=security&mfa=required')
    signIn('super_admin', { mfa: ENROLLED })
    expect(loc(await get('/admin-giga-panel', opts))).toContain('/2fa')
    signIn('client', { mfa: ENROLLED })
    expect(loc(await get('/dashboard', opts))).toContain('/2fa')
  }

  it('a production NODE_ENV ignores the cookie', async () => {
    // Host: localhost, the flag and the cookie are all there.
    vi.stubEnv('NODE_ENV', 'production')
    await gatesAreBack({ dev: true })
  })

  it('without the flag', async () => {
    vi.stubEnv('ENABLE_DEV_AUTH_ROUTES', '')
    await gatesAreBack({ dev: true })
  })

  it('on a hosting platform', async () => {
    vi.stubEnv('RAILWAY_PROJECT_ID', 'project')
    await gatesAreBack({ dev: true })
  })

  it('through a host that is not this machine', async () => {
    await gatesAreBack({ dev: true, host: '192.168.1.5:3000' })
    await gatesAreBack({ dev: true, host: 'portal.aistart360.app' })
    await gatesAreBack({ dev: true, headers: { 'x-forwarded-host': 'dev-tunnel.example.com' } })
  })

  it('with another cookie value', async () => {
    await gatesAreBack({ headers: { cookie: `${DEV_MODE_COOKIE}=true` } })
  })
})

describe('an impersonation cookie does not lock the developer panel out', () => {
  // guardImpersonatedApi makes a cabinet opened in view mode read-only and
  // refuses changes once the impersonation has ended. The developer login
  // replaces the identity of the browser (and clears that cookie), so it must
  // get through — but only where developer access is on.
  const impCookie = async (mode: 'view' | 'edit') =>
    `${IMP_COOKIE_NAME}=${await signImpersonation({ sid: 's1', uid: 'u1', mode, aid: 'admin-1', alabel: 'admin', tlabel: 'target' })}`

  const post = (path: string, cookie: string, opts: { host?: string; origin?: string } = {}) => {
    const host = opts.host ?? 'localhost:3000'
    return middleware(new NextRequest(`http://localhost:3000${path}`, { method: 'POST', headers: { host, origin: opts.origin ?? `http://${host}`, cookie } }))
  }
  const DEV_PATHS = ['/api/dev/login', '/api/dev/logout', '/api/dev/mode', '/api/dev/register', '/api/dev/confirm-email']

  it('view mode: the dev routes go through, everything else stays read-only', async () => {
    const cookie = await impCookie('view')
    for (const path of DEV_PATHS) expect((await post(path, cookie)).status, path).toBe(200)
    const other = await post('/api/v1/onboarding/survey', cookie)
    expect(other.status).toBe(403)
    expect(await other.json()).toMatchObject({ error: 'Режим просмотра: изменения запрещены' })
    // a path that only looks like a dev route
    expect((await post('/api/developer/thing', cookie)).status).toBe(403)
  })

  it('an impersonation that has ended: the dev routes go through, everything else is refused', async () => {
    s.impActive = false
    const cookie = await impCookie('edit')
    for (const path of DEV_PATHS) expect((await post(path, cookie)).status, path).toBe(200)
    expect((await post('/api/v1/onboarding/survey', cookie)).status).toBe(401)
    // a forged cookie is treated the same way
    expect((await post('/api/dev/login', `${IMP_COOKIE_NAME}=forged`)).status).toBe(200)
    expect((await post('/api/v1/onboarding/survey', `${IMP_COOKIE_NAME}=forged`)).status).toBe(401)
  })

  it('without developer access a dev path is treated like any other', async () => {
    const cookie = await impCookie('view')
    const refused = async (opts: Parameters<typeof post>[2] = {}) => {
      for (const path of DEV_PATHS) expect((await post(path, cookie, opts)).status, path).toBe(403)
    }
    vi.stubEnv('NODE_ENV', 'production')
    await refused()
    vi.stubEnv('NODE_ENV', 'test')
    vi.stubEnv('ENABLE_DEV_AUTH_ROUTES', '')
    await refused()
    vi.stubEnv('ENABLE_DEV_AUTH_ROUTES', '1')
    vi.stubEnv('VERCEL', '1')
    await refused()
    vi.stubEnv('VERCEL', '')
    await refused({ host: '192.168.1.5:3000' })
    await refused({ origin: 'https://evil.example' })
  })
})
