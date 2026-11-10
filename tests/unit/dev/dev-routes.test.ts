/**
 * The developer session API: GET /api/dev/session, POST /api/dev/login,
 * POST /api/dev/mode, POST /api/dev/logout.
 *
 * Both Supabase clients are doubles and lib/dev/dev-accounts is replaced where
 * it would touch the database (its own tests cover that), so nothing here can
 * reach a real project. What is checked: the guard comes first and answers 404,
 * the session is minted server-side for exactly the intended account, and
 * nothing is created for an address that has no account.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest, type NextResponse } from 'next/server'
import { DEV_MODE_COOKIE } from '@/lib/dev/dev-access'

type Result = { data: unknown; error: null | { message: string } }

const s = vi.hoisted(() => ({
  /** Every call that matters, in order. */
  log: [] as string[],
  clients: { service: 0, session: 0 },
  // service-role side
  ensureFail: null as string | null,
  found: null as null | { id: string; email: string },
  link: null as null | { data: { properties: { hashed_token?: string } | null; user: { id: string } | null }; error: null | { message: string } },
  linkUserId: null as string | null,
  profileRow: null as null | { role: string; status: string },
  staffRow: null as null | { role: string },
  // cookie-bound side
  verify: [] as Array<{ data: { user: { id: string } | null }; error: null | { message: string } }>,
  user: null as null | { id: string; email: string },
  getUserThrows: false,
  ownProfile: null as null | { role: string },
  ownStaff: null as null | { role: string },
  signOutError: null as null | { message: string },
}))

vi.mock('@/lib/dev/dev-accounts', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/dev/dev-accounts')>()
  return {
    ...real,
    ensureDevAccount: async (role: Parameters<typeof real.ensureDevAccount>[0]) => {
      s.log.push(`ensure:${role}`)
      if (s.ensureFail) throw new real.DevAccountError(s.ensureFail as ConstructorParameters<typeof real.DevAccountError>[0])
      return { userId: `id-${role}`, email: real.devEmail(role) }
    },
    findAuthUserByEmail: async (_admin: unknown, email: string) => {
      s.log.push(`find:${email}`)
      return s.found
    },
  }
})

const rows = (pick: (table: string) => unknown) => (table: string) => ({
  select: () => ({ eq: () => ({ maybeSingle: async (): Promise<Result> => ({ data: pick(table), error: null }) }) }),
})

vi.mock('@/lib/supabase-service', () => ({
  createServiceClient: () => {
    s.clients.service++
    return {
      from: rows((table) => (table === 'profiles' ? s.profileRow : s.staffRow)),
      auth: {
        admin: {
          generateLink: async (params: { type: string; email: string }) => {
            s.log.push(`generateLink:${params.type}:${params.email}`)
            return s.link ?? { data: { properties: { hashed_token: 'hash-1' }, user: { id: s.linkUserId ?? 'nobody' } }, error: null }
          },
        },
      },
    }
  },
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => {
    s.clients.session++
    return {
      from: rows((table) => (table === 'profiles' ? s.ownProfile : s.ownStaff)),
      auth: {
        getUser: async () => {
          if (s.getUserThrows) throw new Error('offline')
          return { data: { user: s.user } }
        },
        verifyOtp: async (params: { type: string; token_hash: string }) => {
          s.log.push(`verifyOtp:${params.type}:${params.token_hash}`)
          return s.verify.shift() ?? { data: { user: null }, error: { message: 'no result scripted' } }
        },
        signOut: async (options: unknown) => {
          s.log.push(`signOut:${JSON.stringify(options)}`)
          return { error: s.signOutError }
        },
      },
    }
  },
}))

const session = await import('@/app/api/dev/session/route')
const login = await import('@/app/api/dev/login/route')
const mode = await import('@/app/api/dev/mode/route')
const logout = await import('@/app/api/dev/logout/route')

type Handler = (request: NextRequest) => Response | Promise<Response>
const ROUTES: Array<[path: string, handlers: Record<string, Handler>, method: string]> = [
  ['/api/dev/session', session as unknown as Record<string, Handler>, 'GET'],
  ['/api/dev/login', login as unknown as Record<string, Handler>, 'POST'],
  ['/api/dev/mode', mode as unknown as Record<string, Handler>, 'POST'],
  ['/api/dev/logout', logout as unknown as Record<string, Handler>, 'POST'],
]
const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']
const PLATFORM_VARS = ['RAILWAY_ENVIRONMENT', 'RAILWAY_PROJECT_ID', 'VERCEL', 'PERSISTENT_SERVER']

/** A request the way the panel on http://localhost:3000 sends it. */
function req(path: string, opts: { method?: string; body?: unknown; rawBody?: string; host?: string; cookie?: string; headers?: Record<string, string> } = {}): NextRequest {
  const method = opts.method ?? 'GET'
  const headers: Record<string, string> = { host: opts.host ?? 'localhost:3000', ...opts.headers }
  if (opts.cookie) headers.cookie = opts.cookie
  const hasBody = opts.body !== undefined || opts.rawBody !== undefined
  if (method !== 'GET') headers.origin = headers.origin ?? `http://${headers.host}`
  if (hasBody) headers['content-type'] = 'application/json'
  return new NextRequest(`http://localhost:3000${path}`, { method, headers, body: hasBody ? opts.rawBody ?? JSON.stringify(opts.body) : undefined })
}

const post = (handlers: { POST: Handler }, path: string, body?: unknown, extra: Parameters<typeof req>[1] = {}) =>
  handlers.POST(req(path, { method: 'POST', body, ...extra }))

/** The dev-mode cookie a response sets, if any. */
const devCookie = (res: Response) => (res as NextResponse).cookies.get(DEV_MODE_COOKIE)

/** Script a successful exchange for `userId`. */
function sessionFor(userId: string) {
  s.linkUserId = userId
  s.verify = [{ data: { user: { id: userId } }, error: null }]
}

beforeEach(() => {
  s.log = []
  s.clients = { service: 0, session: 0 }
  s.ensureFail = null
  s.found = null
  s.link = null
  s.linkUserId = null
  s.profileRow = null
  s.staffRow = null
  s.verify = []
  s.user = null
  s.getUserThrows = false
  s.ownProfile = null
  s.ownStaff = null
  s.signOutError = null
  vi.stubEnv('ENABLE_DEV_AUTH_ROUTES', '1')
  for (const name of PLATFORM_VARS) vi.stubEnv(name, '')
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('developer access is off → the routes do not exist', () => {
  const expectNothingRan = () => {
    expect(s.log).toEqual([])
    expect(s.clients).toEqual({ service: 0, session: 0 })
  }
  const body = { role: 'super_admin', on: true }

  const OFF: Array<[name: string, arrange: () => void, extra: NonNullable<Parameters<typeof req>[1]>]> = [
    ['without the flag', () => { vi.stubEnv('ENABLE_DEV_AUTH_ROUTES', '') }, {}],
    ['on a hosting platform', () => { vi.stubEnv('RAILWAY_ENVIRONMENT', 'production') }, {}],
    ['through a LAN address', () => {}, { host: '192.168.1.5:3000' }],
    ['through a tunnel that forwards the public host', () => {}, { headers: { 'x-forwarded-host': 'dev-tunnel.example.com' } }],
  ]

  it.each(OFF)('%s: all four answer 404 and nothing else runs', async (_name, arrange, extra) => {
    arrange()
    for (const [path, handlers, method] of ROUTES) {
      const res = await handlers[method](req(path, { method, body: method === 'GET' ? undefined : body, ...extra }))
      expect(res.status, path).toBe(404)
      expect(await res.json(), path).toEqual({ error: 'NOT_FOUND' })
      expect(res.headers.get('set-cookie'), path).toBeNull()
    }
    expectNothingRan()
  })

  it('a production build: every method of every dev route answers 404', async () => {
    // Host: localhost, the flag, the dev cookie and a same-origin request — all favourable.
    vi.stubEnv('NODE_ENV', 'production')
    for (const [path, handlers] of ROUTES) {
      for (const method of METHODS) {
        const res = await handlers[method](req(path, { method, body: method === 'GET' ? undefined : body, cookie: `${DEV_MODE_COOKIE}=1` }))
        expect(res.status, `${method} ${path}`).toBe(404)
        expect(await res.json(), `${method} ${path}`).toEqual({ error: 'NOT_FOUND' })
        expect(res.headers.get('set-cookie'), `${method} ${path}`).toBeNull()
      }
    }
    expectNothingRan()
  })

  it('a form on another site cannot post to them', async () => {
    for (const [path, handlers, method] of ROUTES.filter(([, , m]) => m === 'POST')) {
      const res = await handlers[method](req(path, { method, body, headers: { origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' } }))
      expect(res.status, path).toBe(404)
    }
    expectNothingRan()
  })

  it('a method a route does not serve is 404 as well, not 405', async () => {
    for (const [path, handlers, served] of ROUTES) {
      for (const method of METHODS.filter((m) => m !== served)) {
        const res = await handlers[method](req(path, { method }))
        expect(res.status, `${method} ${path}`).toBe(404)
      }
    }
    expectNothingRan()
  })

  it('a route file exports handlers and route config only', () => {
    for (const [path, handlers] of ROUTES) {
      expect(Object.keys(handlers).sort(), path).toEqual([...METHODS, 'dynamic', 'runtime'].sort())
    }
  })
})

describe('GET /api/dev/session', () => {
  it('lists the nine roles and says nobody is signed in', async () => {
    const res = await session.GET(req('/api/dev/session'))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json).toMatchObject({ enabled: true, devMode: false, current: null })
    expect(json.roles).toEqual([
      { role: 'client', label: 'Клиент' },
      { role: 'expert', label: 'Эксперт' },
      { role: 'super_expert', label: 'Супер-эксперт' },
      { role: 'admin', label: 'Админ' },
      { role: 'super_admin', label: 'Супер-админ' },
      { role: 'crm_manager', label: 'CRM-менеджер' },
      { role: 'content_manager', label: 'Контент-менеджер' },
      { role: 'analyst', label: 'Аналитик' },
      { role: 'support', label: 'Поддержка' },
    ])
    expect(s.clients.service).toBe(0) // showing the panel needs no service-role key
  })

  it('reports dev mode from the cookie', async () => {
    const on = await session.GET(req('/api/dev/session', { cookie: `${DEV_MODE_COOKIE}=1` }))
    expect((await on.json()).devMode).toBe(true)
    const off = await session.GET(req('/api/dev/session', { cookie: `${DEV_MODE_COOKIE}=0` }))
    expect((await off.json()).devMode).toBe(false)
  })

  it('names the signed-in account with its profile role and staff role', async () => {
    s.user = { id: 'u1', email: 'dev-crm-manager@dev.aistart360.test' }
    s.ownProfile = { role: 'client' }
    s.ownStaff = { role: 'crm_manager' }
    const json = await (await session.GET(req('/api/dev/session'))).json()
    expect(json.current).toEqual({ email: 'dev-crm-manager@dev.aistart360.test', role: 'client', staffRole: 'crm_manager' })

    s.ownStaff = { role: 'not-a-role' }
    expect((await (await session.GET(req('/api/dev/session'))).json()).current.staffRole).toBeNull()
  })

  it('still answers when the session cannot be read', async () => {
    s.getUserThrows = true
    const res = await session.GET(req('/api/dev/session'))
    expect(res.status).toBe(200)
    expect((await res.json()).current).toBeNull()
  })
})

describe('POST /api/dev/login { role }', () => {
  it('calls generateLink then verifyOtp with the returned hash and answers the landing path', async () => {
    sessionFor('id-client')
    const res = await post(login, '/api/dev/login', { role: 'client' })

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, redirect: '/client/home' })
    expect(s.log).toEqual([
      'ensure:client',
      'generateLink:magiclink:dev-client@dev.aistart360.test',
      'verifyOtp:email:hash-1',
    ])
  })

  it('switches dev mode on with an httpOnly, lax, site-wide cookie', async () => {
    sessionFor('id-client')
    const res = await post(login, '/api/dev/login', { role: 'client' })
    expect(devCookie(res)).toMatchObject({ value: '1', httpOnly: true, sameSite: 'lax', path: '/' })
  })

  it.each([
    ['client', '/client/home'],
    ['expert', '/expert/dashboard'],
    ['super_expert', '/super-expert'],
    ['admin', '/admin-giga-panel'],
    ['super_admin', '/admin-giga-panel'],
    ['crm_manager', '/admin-giga-panel'],
    ['content_manager', '/admin-giga-panel'],
    ['analyst', '/admin-giga-panel'],
    ['support', '/admin-giga-panel'],
  ])('%s lands on %s', async (role, landing) => {
    sessionFor(`id-${role}`)
    const res = await post(login, '/api/dev/login', { role })
    expect(await res.json()).toEqual({ ok: true, redirect: landing })
  })

  it('falls back to the magiclink type for an Auth server that does not know "email"', async () => {
    s.linkUserId = 'id-client'
    s.verify = [
      { data: { user: null }, error: { message: 'unsupported type' } },
      { data: { user: { id: 'id-client' } }, error: null },
    ]
    const res = await post(login, '/api/dev/login', { role: 'client' })
    expect(res.status).toBe(200)
    expect(s.log.slice(-2)).toEqual(['verifyOtp:email:hash-1', 'verifyOtp:magiclink:hash-1'])
  })

  it('refuses a developer address somebody else registered', async () => {
    s.ensureFail = 'DEV_ACCOUNT_CONFLICT'
    const res = await post(login, '/api/dev/login', { role: 'super_admin' })
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'DEV_ACCOUNT_CONFLICT' })
    expect(s.log).toEqual(['ensure:super_admin'])
    expect(devCookie(res)).toBeUndefined()
  })

  it('answers 500 with the code when the account cannot be prepared', async () => {
    s.ensureFail = 'DEV_ACCOUNT_WRITE_FAILED'
    const res = await post(login, '/api/dev/login', { role: 'admin' })
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'DEV_ACCOUNT_WRITE_FAILED' })
  })
})

describe('POST /api/dev/login { email }', () => {
  it('signs in as an existing account and lands where that account lands', async () => {
    s.found = { id: 'u-7', email: 'someone@example.com' }
    s.profileRow = { role: 'client', status: 'pending_approval' }
    sessionFor('u-7')
    const res = await post(login, '/api/dev/login', { email: '  Someone@Example.com ' })

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, redirect: '/client/waiting-room' })
    expect(s.log).toEqual(['find:someone@example.com', 'generateLink:magiclink:someone@example.com', 'verifyOtp:email:hash-1'])
    expect(devCookie(res)?.value).toBe('1')
  })

  it('a staff member lands in the staff workspace', async () => {
    s.found = { id: 'u-8', email: 'staff@example.com' }
    s.profileRow = { role: 'client', status: 'approved' }
    s.staffRow = { role: 'super_expert' }
    sessionFor('u-8')
    expect(await (await post(login, '/api/dev/login', { email: 'staff@example.com' })).json()).toEqual({ ok: true, redirect: '/super-expert' })
  })

  it('unknown e-mail → 404 USER_NOT_FOUND, and no link is generated (it would create the account)', async () => {
    s.found = null
    const res = await post(login, '/api/dev/login', { email: 'nobody@example.com' })
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'USER_NOT_FOUND' })
    expect(s.log).toEqual(['find:nobody@example.com'])
    expect(devCookie(res)).toBeUndefined()
  })
})

describe('POST /api/dev/login — the session is for the intended account or for nobody', () => {
  it('the link came back for another user → no exchange at all', async () => {
    s.linkUserId = 'somebody-else'
    const res = await post(login, '/api/dev/login', { role: 'client' })
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'DEV_SESSION_FAILED' })
    expect(s.log.some((line) => line.startsWith('verifyOtp'))).toBe(false)
    expect(devCookie(res)).toBeUndefined()
  })

  it('no link → 500', async () => {
    s.link = { data: { properties: null, user: null }, error: { message: 'boom' } }
    expect((await post(login, '/api/dev/login', { role: 'client' })).status).toBe(500)
    s.link = { data: { properties: {}, user: { id: 'id-client' } }, error: null }
    expect((await post(login, '/api/dev/login', { role: 'client' })).status).toBe(500)
    expect(s.log.some((line) => line.startsWith('verifyOtp'))).toBe(false)
  })

  it('the exchange failed → 500', async () => {
    s.linkUserId = 'id-client'
    s.verify = [
      { data: { user: null }, error: { message: 'expired' } },
      { data: { user: null }, error: { message: 'expired' } },
    ]
    const res = await post(login, '/api/dev/login', { role: 'client' })
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'DEV_SESSION_FAILED' })
  })

  it('the exchange produced another user → that session is dropped in this browser only', async () => {
    s.linkUserId = 'id-client'
    s.verify = [{ data: { user: { id: 'somebody-else' } }, error: null }]
    const res = await post(login, '/api/dev/login', { role: 'client' })
    expect(res.status).toBe(500)
    expect(s.log.at(-1)).toBe('signOut:{"scope":"local"}')
    expect(devCookie(res)).toBeUndefined()
  })
})

describe('POST /api/dev/login — the body is exactly one of role or email', () => {
  it.each([
    ['both', { role: 'client', email: 'someone@example.com' }],
    ['neither', {}],
    ['an unknown role', { role: 'owner' }],
    ['a role that is not a string', { role: ['client'] }],
    ['not an address', { email: 'not-an-email' }],
    ['an extra field', { role: 'client', redirect: 'https://evil.example' }],
    ['null', null],
  ])('%s → 400', async (_name, body) => {
    const res = await post(login, '/api/dev/login', body)
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'INVALID_PAYLOAD' })
    expect(s.log).toEqual([])
  })

  it('a body that is not JSON → 400', async () => {
    const res = await login.POST(req('/api/dev/login', { method: 'POST', rawBody: 'role=client' }))
    expect(res.status).toBe(400)
    expect(s.log).toEqual([])
  })
})

describe('POST /api/dev/mode', () => {
  it('{ on: true } sets the cookie', async () => {
    const res = await post(mode, '/api/dev/mode', { on: true })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, devMode: true })
    expect(devCookie(res)).toMatchObject({ value: '1', httpOnly: true, sameSite: 'lax', path: '/' })
  })

  it('{ on: false } clears it', async () => {
    const res = await post(mode, '/api/dev/mode', { on: false }, { cookie: `${DEV_MODE_COOKIE}=1` })
    expect(await res.json()).toEqual({ ok: true, devMode: false })
    expect(devCookie(res)).toMatchObject({ value: '', maxAge: 0, path: '/' })
  })

  it.each([[{ on: 'yes' }], [{ on: 1 }], [{}], [{ on: true, role: 'admin' }], [null]])('%j → 400', async (body) => {
    const res = await post(mode, '/api/dev/mode', body)
    expect(res.status).toBe(400)
    expect(devCookie(res)).toBeUndefined()
  })

  it('touches neither Supabase client', async () => {
    await post(mode, '/api/dev/mode', { on: true })
    expect(s.clients).toEqual({ service: 0, session: 0 })
  })
})

describe('POST /api/dev/logout', () => {
  it('ends the session in this browser only and keeps the dev cookie', async () => {
    const res = await post(logout, '/api/dev/logout', undefined, { cookie: `${DEV_MODE_COOKIE}=1` })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    // scope 'local': the default would sign the account out on every device.
    expect(s.log).toEqual(['signOut:{"scope":"local"}'])
    expect(devCookie(res)).toBeUndefined()
    expect(s.clients.service).toBe(0)
  })

  it('says so when the sign-out did not happen', async () => {
    s.signOutError = { message: 'offline' }
    const res = await post(logout, '/api/dev/logout')
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'DEV_LOGOUT_FAILED' })
  })
})
