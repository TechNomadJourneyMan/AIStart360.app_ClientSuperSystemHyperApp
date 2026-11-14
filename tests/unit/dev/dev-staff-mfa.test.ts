/**
 * Dev mode and the API-side second-factor gate (staffMfaGate in
 * lib/admin/giga-actor.ts). Middleware only gates pages; the GIGA API, the
 * expert portal API and the MCP consent page ask this gate. With dev mode on
 * for the request the second factor counts as met — and nothing else changes:
 * the caller's real role still comes from the database.
 *
 * Supabase, the settings store and next/headers are doubles; `fetch` is a
 * stub, so nothing here can reach a real project.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { DEV_MODE_COOKIE } from '@/lib/dev/dev-access'

const s = vi.hoisted(() => ({
  user: null as null | { id: string; email: string; app_metadata: Record<string, unknown>; user_metadata: Record<string, unknown> },
  profile: null as null | { id?: string; role: string; status: string },
  staff: null as null | { role: string },
  settings: { staff_require_mfa: true } as Record<string, boolean>,
  /** What next/headers serves to code that holds no request object. */
  headers: {} as Record<string, string>,
  cookies: {} as Record<string, string>,
  headersBroken: false,
}))

function table(name: string) {
  if (name === 'webauthn_credentials') return { select: () => ({ eq: async () => ({ count: 0, error: null }) }) }
  const row = name === 'profiles' ? s.profile : name === 'staff_roles' ? s.staff : null
  return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: row, error: null }) }) }) }
}

vi.mock('@/lib/supabase-server', () => ({
  createServerClient: () => ({ auth: { getUser: async () => ({ data: { user: s.user } }) }, from: table }),
}))
vi.mock('@/lib/supabase-service', () => ({ createServiceClient: () => ({ from: table }) }))
vi.mock('@/lib/db', () => ({ prisma: { $queryRaw: vi.fn() } }))
vi.mock('@/lib/settings/store', () => ({ getSetting: async (key: string) => s.settings[key] ?? false }))
vi.mock('next/headers', () => ({
  headers: () => {
    if (s.headersBroken) throw new Error('headers() was called outside a request scope')
    return new Headers(s.headers)
  },
  cookies: () => ({ get: (name: string) => (name in s.cookies ? { name, value: s.cookies[name] } : undefined) }),
}))

const { getGigaActor, requireGiga, staffMfaGate } = await import('@/lib/admin/giga-actor')
const { resolveExpert } = await import('@/lib/expert-auth')

const PLATFORM_VARS = ['RAILWAY_ENVIRONMENT', 'RAILWAY_PROJECT_ID', 'VERCEL', 'PERSISTENT_SERVER']
/** What a handler sees as the server's own address under `next dev`. */
const LISTEN = 'localhost:3000'
const DEV_COOKIE = `${DEV_MODE_COOKIE}=1`

/** A GIGA API call from a browser on this machine; `dev` adds the dev-mode cookie. */
function api(opts: { dev?: boolean; host?: string; method?: string } = {}): NextRequest {
  const headers: Record<string, string> = { host: opts.host ?? 'localhost:3000' }
  if (opts.dev) headers.cookie = DEV_COOKIE
  return new NextRequest(`http://${LISTEN}/api/giga-admin/test`, { method: opts.method ?? 'GET', headers })
}

const signIn = (role: string, opts: { staff?: string; enrolled?: boolean; status?: string } = {}) => {
  s.user = { id: 'u1', email: 'dev-staff@dev.aistart360.test', app_metadata: opts.enrolled ? { mfa_totp: true } : {}, user_metadata: {} }
  s.profile = { id: 'u1', role, status: opts.status ?? 'approved' }
  // As devAccountShape seeds them: admin / super_admin hold the same staff_roles row (R-002 — staff come
  // only from staff_roles).
  const staff = opts.staff ?? (role === 'super_admin' || role === 'admin' ? role : null)
  s.staff = staff ? { role: staff } : null
}

beforeEach(() => {
  s.settings = { staff_require_mfa: true }
  s.headers = { host: 'localhost:3000' }
  s.cookies = {}
  s.headersBroken = false
  signIn('super_admin')
  vi.stubEnv('ENABLE_DEV_AUTH_ROUTES', '1')
  for (const name of PLATFORM_VARS) vi.stubEnv(name, '')
  vi.stubEnv('AUTH_SECRET', 'test-auth-secret-for-step-up')
  // lib/expert-auth reads the profile over REST: an invented host and a stubbed fetch.
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://sb.example')
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'not-a-real-key')
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(s.profile ? [s.profile] : []), { status: 200 })))
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('the GIGA API (the gate is given the request)', () => {
  it('dev mode on → staff without a second factor pass where they were told to enrol', async () => {
    const refused = await requireGiga(api(), 'users.view')
    expect(refused.response?.status).toBe(403)
    expect(await refused.response?.json()).toMatchObject({ code: 'MFA_ENROLLMENT_REQUIRED' })

    const guard = await requireGiga(api({ dev: true }), 'users.view')
    expect(guard.response).toBeUndefined()
    expect(guard.actor).toMatchObject({ id: 'u1', kind: 'session', role: 'super_admin' })
  })

  it('dev mode on → an enrolled account passes without the step-up cookie', async () => {
    signIn('super_admin', { enrolled: true })
    expect(await (await requireGiga(api(), 'users.view')).response?.json()).toMatchObject({ code: 'MFA_STEP_UP_REQUIRED' })
    expect(await getGigaActor(api({ dev: true }))).toMatchObject({ id: 'u1', role: 'super_admin' })
  })

  it('a request that changes something passes too', async () => {
    const post = new NextRequest(`http://${LISTEN}/api/giga-admin/test`, {
      method: 'POST',
      headers: { host: 'localhost:3000', origin: 'http://localhost:3000', cookie: DEV_COOKIE },
    })
    expect((await requireGiga(post, 'users.view')).actor).toMatchObject({ id: 'u1' })
  })

  it('the real role still decides: dev mode adds no permission', async () => {
    // a client is not staff
    signIn('client')
    const client = await requireGiga(api({ dev: true }), 'users.view')
    expect(client.response?.status).toBe(403)
    expect(client.actor).toBeUndefined()
    // a support role does not manage settings
    signIn('client', { staff: 'support' })
    expect((await requireGiga(api({ dev: true }), 'users.view')).actor).toMatchObject({ role: 'support' })
    const settings = await requireGiga(api({ dev: true }), 'settings.manage')
    expect(settings.response?.status).toBe(403)
    expect(await settings.response?.json()).toMatchObject({ error: 'Недостаточно прав' })
    // an account that is not approved gets nothing
    signIn('super_admin', { status: 'pending_approval' })
    expect(await getGigaActor(api({ dev: true }))).toBeNull()
  })

  describe('the gate behaves exactly as today', () => {
    const stillRefused = async (request: NextRequest) => {
      signIn('super_admin')
      expect(await (await requireGiga(request, 'users.view')).response?.json()).toMatchObject({ code: 'MFA_ENROLLMENT_REQUIRED' })
      signIn('super_admin', { enrolled: true })
      expect(await (await requireGiga(request, 'users.view')).response?.json()).toMatchObject({ code: 'MFA_STEP_UP_REQUIRED' })
    }

    it('with a production NODE_ENV — flag, localhost and cookie notwithstanding', async () => {
      vi.stubEnv('NODE_ENV', 'production')
      await stillRefused(api({ dev: true }))
    })

    it('without the dev-mode cookie', async () => {
      await stillRefused(api())
    })

    it('without the flag, on a hosting platform, or through a host that is not this machine', async () => {
      vi.stubEnv('ENABLE_DEV_AUTH_ROUTES', '')
      await stillRefused(api({ dev: true }))
      vi.stubEnv('ENABLE_DEV_AUTH_ROUTES', '1')
      vi.stubEnv('RAILWAY_ENVIRONMENT', 'production')
      await stillRefused(api({ dev: true }))
      vi.stubEnv('RAILWAY_ENVIRONMENT', '')
      await stillRefused(api({ dev: true, host: '192.168.1.5:3000' }))
    })

    it('when 2FA is not required and the account is not enrolled nothing was refused, and nothing is now', async () => {
      s.settings.staff_require_mfa = false
      expect(await getGigaActor(api())).toMatchObject({ id: 'u1' })
      expect(await getGigaActor(api({ dev: true }))).toMatchObject({ id: 'u1' })
    })
  })
})

describe('the expert portal API (the gate has no request object, only next/headers)', () => {
  const devBrowser = () => {
    s.cookies = { [DEV_MODE_COOKIE]: '1' }
    s.headers = { host: 'localhost:3000' }
  }

  beforeEach(() => {
    signIn('expert')
  })

  it('dev mode on → an expert without a second factor passes where they were told to enrol', async () => {
    expect(await resolveExpert()).toEqual({ ok: false, block: 'enroll' })
    devBrowser()
    expect(await resolveExpert()).toEqual({ ok: true, viewer: { id: 'u1', role: 'expert', email: 'dev-staff@dev.aistart360.test' } })
  })

  it('dev mode on → an enrolled expert passes without the step-up cookie', async () => {
    signIn('expert', { enrolled: true })
    expect(await resolveExpert()).toEqual({ ok: false, block: 'step_up' })
    devBrowser()
    expect((await resolveExpert()).ok).toBe(true)
  })

  it('the real role still decides', async () => {
    devBrowser()
    signIn('client')
    expect(await resolveExpert()).toEqual({ ok: false, block: 'forbidden' })
    signIn('expert', { status: 'pending_approval' })
    expect(await resolveExpert()).toEqual({ ok: false, block: 'forbidden' })
  })

  describe('the gate behaves exactly as today', () => {
    beforeEach(() => {
      devBrowser()
    })

    it('with a production NODE_ENV', async () => {
      vi.stubEnv('NODE_ENV', 'production')
      expect(await resolveExpert()).toEqual({ ok: false, block: 'enroll' })
    })

    it('without the dev-mode cookie', async () => {
      s.cookies = {}
      expect(await resolveExpert()).toEqual({ ok: false, block: 'enroll' })
    })

    it('without the flag or on a hosting platform', async () => {
      vi.stubEnv('ENABLE_DEV_AUTH_ROUTES', '')
      expect(await resolveExpert()).toEqual({ ok: false, block: 'enroll' })
      vi.stubEnv('ENABLE_DEV_AUTH_ROUTES', '1')
      vi.stubEnv('VERCEL', '1')
      expect(await resolveExpert()).toEqual({ ok: false, block: 'enroll' })
    })

    it('when the browser asked for another host, or a proxy forwarded one', async () => {
      s.headers = { host: 'portal.aistart360.app' }
      expect(await resolveExpert()).toEqual({ ok: false, block: 'enroll' })
      s.headers = { host: 'localhost:3000', 'x-forwarded-host': 'dev-tunnel.example.com' }
      expect(await resolveExpert()).toEqual({ ok: false, block: 'enroll' })
      s.headers = {}
      expect(await resolveExpert()).toEqual({ ok: false, block: 'enroll' })
    })

    it('when there is no request to read (a job, a script)', async () => {
      s.headersBroken = true
      expect(await resolveExpert()).toEqual({ ok: false, block: 'enroll' })
    })
  })
})

describe('staffMfaGate itself', () => {
  const user = { id: 'u1', app_metadata: {}, user_metadata: {} }

  it('answers ok in dev mode and what it always answered otherwise', async () => {
    expect(await staffMfaGate(undefined, user, api())).toBe('enroll')
    expect(await staffMfaGate(undefined, user, api({ dev: true }))).toBe('ok')
    expect(await staffMfaGate(undefined, { ...user, app_metadata: { mfa_totp: true } }, api())).toBe('step_up')
    expect(await staffMfaGate(undefined, { ...user, app_metadata: { mfa_totp: true } }, api({ dev: true }))).toBe('ok')
    vi.stubEnv('NODE_ENV', 'production')
    expect(await staffMfaGate(undefined, user, api({ dev: true }))).toBe('enroll')
  })
})
