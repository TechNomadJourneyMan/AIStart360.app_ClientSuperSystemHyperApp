/**
 * The two older dev routes — POST /api/dev/register (an account of any role)
 * and POST /api/dev/confirm-email — behind the same guard as the developer
 * login (lib/dev/dev-access.ts): a non-production build, the flag, a local
 * host, no platform variable, and a same-origin request. Off → 404, before
 * anything else runs. What they do when the guard lets them through is
 * unchanged.
 *
 * @supabase/supabase-js is replaced by a double: no client is ever built for a
 * real project.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const s = vi.hoisted(() => ({
  clients: 0,
  calls: [] as Array<{ op: string; args: unknown }>,
  users: [] as Array<{ id: string; email: string }>,
  createError: null as null | { message: string },
}))

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => {
    s.clients++
    return {
      from: (table: string) => ({
        upsert: async (row: unknown, options: unknown) => {
          s.calls.push({ op: `upsert:${table}`, args: { row, options } })
          return { error: null }
        },
      }),
      auth: {
        admin: {
          createUser: async (attrs: { email: string }) => {
            s.calls.push({ op: 'createUser', args: attrs })
            if (s.createError) return { data: { user: null }, error: s.createError }
            return { data: { user: { id: 'new-user', email: attrs.email } }, error: null }
          },
          listUsers: async (params: unknown) => {
            s.calls.push({ op: 'listUsers', args: params })
            return { data: { users: s.users }, error: null }
          },
          updateUserById: async (id: string, attrs: unknown) => {
            s.calls.push({ op: 'updateUserById', args: { id, attrs } })
            return { data: { user: { id } }, error: null }
          },
        },
      },
    }
  },
}))

const register = await import('@/app/api/dev/register/route')
const confirmEmail = await import('@/app/api/dev/confirm-email/route')

type Handler = (request: NextRequest) => Response | Promise<Response>
const ROUTES: Array<[path: string, handlers: Record<string, Handler>, body: unknown]> = [
  ['/api/dev/register', register as unknown as Record<string, Handler>, { email: 'new@example.com', password: 'a-test-password', metadata: { full_name: 'New User', role: 'super_admin' } }],
  ['/api/dev/confirm-email', confirmEmail as unknown as Record<string, Handler>, { email: 'known@example.com' }],
]
const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']
const PLATFORM_VARS = ['RAILWAY_ENVIRONMENT', 'RAILWAY_PROJECT_ID', 'VERCEL', 'PERSISTENT_SERVER']

/** A request the way a page on http://localhost:3000 sends it. */
function req(path: string, opts: { method?: string; body?: unknown; host?: string; headers?: Record<string, string> } = {}): NextRequest {
  const method = opts.method ?? 'POST'
  const headers: Record<string, string> = { host: opts.host ?? 'localhost:3000', ...opts.headers }
  if (method !== 'GET') headers.origin = headers.origin ?? `http://${headers.host}`
  const hasBody = opts.body !== undefined && method !== 'GET'
  if (hasBody) headers['content-type'] = 'application/json'
  return new NextRequest(`http://localhost:3000${path}`, { method, headers, body: hasBody ? JSON.stringify(opts.body) : undefined })
}

beforeEach(() => {
  s.clients = 0
  s.calls = []
  s.users = [{ id: 'u-known', email: 'Known@Example.com' }]
  s.createError = null
  vi.stubEnv('ENABLE_DEV_AUTH_ROUTES', '1')
  for (const name of PLATFORM_VARS) vi.stubEnv(name, '')
  // An invented project: the client that would use it is a double.
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://sb.example')
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'not-a-real-key')
})
afterEach(() => {
  vi.unstubAllEnvs()
})

describe('developer access is off → the routes do not exist', () => {
  const OFF: Array<[name: string, arrange: () => void, extra: NonNullable<Parameters<typeof req>[1]>]> = [
    ['a production build (flag, localhost and a same-origin request notwithstanding)', () => { vi.stubEnv('NODE_ENV', 'production') }, {}],
    ['without the flag', () => { vi.stubEnv('ENABLE_DEV_AUTH_ROUTES', '') }, {}],
    ['on a hosting platform', () => { vi.stubEnv('RAILWAY_PROJECT_ID', 'project') }, {}],
    ['through a LAN address', () => {}, { host: '192.168.1.5:3000' }],
    ['through a tunnel that forwards the public host', () => {}, { headers: { 'x-forwarded-host': 'dev-tunnel.example.com' } }],
    ['posted from another site', () => {}, { headers: { origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' } }],
  ]

  it.each(OFF)('%s: 404, and no Supabase client is built', async (_name, arrange, extra) => {
    arrange()
    for (const [path, handlers, body] of ROUTES) {
      const res = await handlers.POST(req(path, { body, ...extra }))
      expect(res.status, path).toBe(404)
      expect(await res.json(), path).toEqual({ error: 'NOT_FOUND' })
    }
    expect(s.clients).toBe(0)
    expect(s.calls).toEqual([])
  })

  it('a production build: every method answers 404', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    for (const [path, handlers, body] of ROUTES) {
      for (const method of METHODS) {
        const res = await handlers[method](req(path, { method, body }))
        expect(res.status, `${method} ${path}`).toBe(404)
      }
    }
    expect(s.clients).toBe(0)
  })

  it('a method a route does not serve is 404 too', async () => {
    for (const [path, handlers] of ROUTES) {
      for (const method of METHODS.filter((m) => m !== 'POST')) {
        expect((await handlers[method](req(path, { method }))).status, `${method} ${path}`).toBe(404)
      }
    }
    expect(s.clients).toBe(0)
  })
})

describe('POST /api/dev/register — unchanged behind the guard', () => {
  const body = { email: 'new@example.com', password: 'a-test-password', metadata: { full_name: 'New User', role: 'expert', organization: 'Acme' } }

  it('creates a confirmed account and its profile', async () => {
    const res = await register.POST(req('/api/dev/register', { body }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    expect(s.calls.map((c) => c.op)).toEqual(['createUser', 'upsert:profiles'])
    expect(s.calls[0].args).toMatchObject({ email: 'new@example.com', email_confirm: true, user_metadata: { full_name: 'New User', role: 'expert' } })
    expect(s.calls[1].args).toMatchObject({ row: { id: 'new-user', full_name: 'New User', role: 'expert', organization: 'Acme' }, options: { onConflict: 'id' } })
  })

  it('refuses a payload it does not understand', async () => {
    for (const bad of [{}, { email: 'a@example.com' }, { ...body, metadata: { full_name: 'X', role: 'owner' } }, null]) {
      const res = await register.POST(req('/api/dev/register', { body: bad }))
      expect(res.status).toBe(400)
      expect(await res.json()).toEqual({ error: 'INVALID_PAYLOAD' })
    }
    expect(s.calls).toEqual([])
  })

  it('passes a creation error on', async () => {
    s.createError = { message: 'A user with this email address has already been registered' }
    const res = await register.POST(req('/api/dev/register', { body }))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'A user with this email address has already been registered' })
  })

  it('says so when the service-role key is not configured', async () => {
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', '')
    const res = await register.POST(req('/api/dev/register', { body }))
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'SUPABASE_ADMIN_CONFIG_MISSING' })
    expect(s.clients).toBe(0)
  })
})

describe('POST /api/dev/confirm-email — unchanged behind the guard', () => {
  it('confirms the e-mail of an existing account, whatever the letter case', async () => {
    const res = await confirmEmail.POST(req('/api/dev/confirm-email', { body: { email: ' KNOWN@example.com ' } }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    expect(s.calls.at(-1)).toEqual({ op: 'updateUserById', args: { id: 'u-known', attrs: { email_confirm: true } } })
  })

  it('unknown address → 404 USER_NOT_FOUND, nothing is updated', async () => {
    const res = await confirmEmail.POST(req('/api/dev/confirm-email', { body: { email: 'nobody@example.com' } }))
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'USER_NOT_FOUND' })
    expect(s.calls.some((c) => c.op === 'updateUserById')).toBe(false)
  })

  it('refuses a payload without an address', async () => {
    for (const bad of [{}, { email: '' }, { email: 42 }, null]) {
      const res = await confirmEmail.POST(req('/api/dev/confirm-email', { body: bad }))
      expect(res.status).toBe(400)
      expect(await res.json()).toEqual({ error: 'INVALID_PAYLOAD' })
    }
  })
})
