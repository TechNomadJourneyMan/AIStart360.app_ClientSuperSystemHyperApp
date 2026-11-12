/**
 * The one guard of the localhost developer login (lib/dev/dev-access.ts).
 *
 * Developer access needs ALL of: a non-production build, the explicit flag
 * ENABLE_DEV_AUTH_ROUTES=1, a local host and no hosting-platform variable.
 * The pure functions take the environment as an argument, so the matrix below
 * never depends on the shell that runs the tests.
 */
import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import {
  DEV_MODE_COOKIE,
  devAccessConfigured,
  devAccessEnabled,
  devAccessEnabledForRequest,
  devModeOn,
  devModeOnForRequest,
  devNotFound,
  isLocalHost,
} from '@/lib/dev/dev-access'

/** Everything favourable: the flag is on and no platform variable is set. */
const ON = { ENABLE_DEV_AUTH_ROUTES: '1' }
const PLATFORM_VARS = ['RAILWAY_ENVIRONMENT', 'RAILWAY_PROJECT_ID', 'VERCEL', 'PERSISTENT_SERVER'] as const

const LOCAL_HOSTS = ['localhost:3000', '127.0.0.1:53000', '[::1]:3000', 'app.localhost:3000', 'localhost', 'LOCALHOST:3000', '::1', '[::1]', 'a.b.localhost']
const FOREIGN_HOSTS = [
  'portal.aistart360.app',
  '192.168.1.5:3000',
  'localhost.evil.com',
  // the address `next start -H 0.0.0.0` listens on (Railway)
  '0.0.0.0:8080',
  '127.0.0.2:3000',
  '[::2]:3000',
  '[::]:3000',
  'notlocalhost:3000',
  'evil-localhost',
  '.localhost',
  'a..localhost',
  'localhost.',
  'localhost:3000@evil.com',
  'evil.com#localhost',
  'localhost:abc',
  'localhost:',
  'localhost, evil.com',
  ' localhost',
  'localhost/evil',
  '',
]

afterEach(() => {
  vi.unstubAllEnvs()
})

/** Stub the real environment: flag as given, platform variables cleared. */
function stubRealEnv(flag: string) {
  vi.stubEnv('ENABLE_DEV_AUTH_ROUTES', flag)
  for (const name of PLATFORM_VARS) vi.stubEnv(name, '')
}

function request(
  url: string,
  opts: { host?: string | null; headers?: Record<string, string>; cookie?: string; method?: string } = {},
): NextRequest {
  const headers: Record<string, string> = { ...opts.headers }
  const host = opts.host === undefined ? new URL(url).host : opts.host
  if (host !== null) headers.host = host
  if (opts.cookie) headers.cookie = opts.cookie
  return new NextRequest(url, { method: opts.method ?? 'GET', headers })
}

describe('isLocalHost', () => {
  it.each(LOCAL_HOSTS)('%s is local', (host) => {
    expect(isLocalHost(host)).toBe(true)
  })

  it.each(FOREIGN_HOSTS)('"%s" is not local', (host) => {
    expect(isLocalHost(host)).toBe(false)
  })

  it('nothing is not local', () => {
    expect(isLocalHost(null)).toBe(false)
    expect(isLocalHost(undefined)).toBe(false)
    expect(isLocalHost('a'.repeat(300) + '.localhost')).toBe(false)
  })
})

describe('devAccessEnabled', () => {
  it('is on with the flag, a local host and no platform variable', () => {
    for (const host of LOCAL_HOSTS) expect(devAccessEnabled(host, ON), host).toBe(true)
  })

  it('is off without the exact flag value', () => {
    for (const flag of [undefined, '', '0', 'true', 'yes', ' 1', '1 ', '11']) {
      expect(devAccessEnabled('localhost:3000', { ENABLE_DEV_AUTH_ROUTES: flag }), String(flag)).toBe(false)
    }
  })

  it('is off for every host that is not local', () => {
    for (const host of [...FOREIGN_HOSTS, null, undefined]) expect(devAccessEnabled(host, ON), String(host)).toBe(false)
  })

  it.each(PLATFORM_VARS)('is off when %s is set (a hosting platform, not a laptop)', (name) => {
    for (const value of ['1', 'production', 'true', '0']) {
      expect(devAccessEnabled('localhost:3000', { ...ON, [name]: value }), value).toBe(false)
    }
  })

  it('a platform variable left empty (copied from .env.example) does not count as set', () => {
    const empty = Object.fromEntries(PLATFORM_VARS.map((name) => [name, '']))
    expect(devAccessEnabled('localhost:3000', { ...ON, ...empty })).toBe(true)
    expect(devAccessEnabled('localhost:3000', { ...ON, PERSISTENT_SERVER: '  ' })).toBe(true)
  })

  it('reads the real environment when none is passed', () => {
    stubRealEnv('1')
    expect(devAccessEnabled('localhost:3000')).toBe(true)
    vi.stubEnv('RAILWAY_PROJECT_ID', 'project')
    expect(devAccessEnabled('localhost:3000')).toBe(false)
    stubRealEnv('')
    expect(devAccessEnabled('localhost:3000')).toBe(false)
  })
})

describe('devModeOn', () => {
  it('needs developer access and the cookie value 1', () => {
    expect(devModeOn('localhost:3000', '1', ON)).toBe(true)
    for (const cookie of [undefined, '', '0', 'true', '11']) {
      expect(devModeOn('localhost:3000', cookie, ON), String(cookie)).toBe(false)
    }
  })

  it('the cookie alone switches nothing on', () => {
    expect(devModeOn('localhost:3000', '1', {})).toBe(false)
    expect(devModeOn('portal.aistart360.app', '1', ON)).toBe(false)
    expect(devModeOn('localhost:3000', '1', { ...ON, VERCEL: '1' })).toBe(false)
  })
})

describe('a request: the server address AND what the browser asked for', () => {
  // Next builds request.nextUrl from the address the server listens on
  // (`localhost` unless `-H` is given), never from the Host header — so a
  // LAN address, a tunnel or a rebound DNS name still arrives as "localhost".
  const url = 'http://localhost:3000/api/dev/session'

  it('is on for a browser on localhost', () => {
    expect(devAccessEnabledForRequest(request(url), ON)).toBe(true)
    expect(devAccessEnabledForRequest(request('http://127.0.0.1:3000/client/home'), ON)).toBe(true)
    expect(devAccessEnabledForRequest(request(url, { host: 'app.localhost:3000' }), ON)).toBe(true)
  })

  it('is off when the Host header names anything else', () => {
    for (const host of ['192.168.1.5:3000', 'dev-tunnel.example.com', 'portal.aistart360.app', 'localhost.evil.com']) {
      expect(devAccessEnabledForRequest(request(url, { host }), ON), host).toBe(false)
    }
  })

  it('is off without a Host header', () => {
    const req = request(url, { host: null })
    expect(req.headers.get('host')).toBeNull()
    expect(devAccessEnabledForRequest(req, ON)).toBe(false)
  })

  it('is off when a proxy forwarded another host', () => {
    expect(devAccessEnabledForRequest(request(url, { headers: { 'x-forwarded-host': 'dev-tunnel.example.com' } }), ON)).toBe(false)
    expect(devAccessEnabledForRequest(request(url, { headers: { 'x-forwarded-host': 'localhost:3000, portal.aistart360.app' } }), ON)).toBe(false)
    expect(devAccessEnabledForRequest(request(url, { headers: { 'x-forwarded-host': '' } }), ON)).toBe(false)
    expect(devAccessEnabledForRequest(request(url, { headers: { 'x-forwarded-host': 'localhost:3000' } }), ON)).toBe(true)
  })

  it('is off when the server itself listens on a public address', () => {
    expect(devAccessEnabledForRequest(request('http://0.0.0.0:8080/api/dev/session', { host: 'localhost:8080' }), ON)).toBe(false)
  })

  it('is off without the flag or on a hosting platform', () => {
    expect(devAccessEnabledForRequest(request(url), {})).toBe(false)
    expect(devAccessEnabledForRequest(request(url), { ...ON, RAILWAY_ENVIRONMENT: 'production' })).toBe(false)
  })

  it('reads the real environment when none is passed', () => {
    stubRealEnv('1')
    expect(devAccessEnabledForRequest(request(url))).toBe(true)
    stubRealEnv('')
    expect(devAccessEnabledForRequest(request(url))).toBe(false)
  })

  describe('a request that changes something must come from the same origin', () => {
    const post = (headers: Record<string, string> = {}) => request('http://localhost:3000/api/dev/login', { method: 'POST', headers })

    it('the panel itself and a client that is not a browser pass', () => {
      expect(devAccessEnabledForRequest(post({ origin: 'http://localhost:3000', 'sec-fetch-site': 'same-origin' }), ON)).toBe(true)
      expect(devAccessEnabledForRequest(post({ origin: 'http://localhost:3000' }), ON)).toBe(true)
      expect(devAccessEnabledForRequest(post(), ON)).toBe(true)
    })

    it('another site, another local port and an opaque origin are refused', () => {
      expect(devAccessEnabledForRequest(post({ origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' }), ON)).toBe(false)
      expect(devAccessEnabledForRequest(post({ origin: 'https://evil.example' }), ON)).toBe(false)
      expect(devAccessEnabledForRequest(post({ 'sec-fetch-site': 'cross-site' }), ON)).toBe(false)
      expect(devAccessEnabledForRequest(post({ origin: 'http://localhost:5173', 'sec-fetch-site': 'same-site' }), ON)).toBe(false)
      expect(devAccessEnabledForRequest(post({ origin: 'http://localhost:5173' }), ON)).toBe(false)
      expect(devAccessEnabledForRequest(post({ origin: 'null' }), ON)).toBe(false)
    })

    it('every method except GET and HEAD is checked', () => {
      for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']) {
        const req = request('http://localhost:3000/api/dev/mode', { method, headers: { origin: 'https://evil.example' } })
        expect(devAccessEnabledForRequest(req, ON), method).toBe(false)
      }
    })

    it('following a link from another site to a local page is not a change', () => {
      const req = request('http://localhost:3000/client/home', { headers: { 'sec-fetch-site': 'cross-site' } })
      expect(devAccessEnabledForRequest(req, ON)).toBe(true)
    })
  })

  it('dev mode needs the cookie on top', () => {
    const cookie = `${DEV_MODE_COOKIE}=1`
    expect(devModeOnForRequest(request('http://localhost:3000/client/home', { cookie }), ON)).toBe(true)
    expect(devModeOnForRequest(request('http://localhost:3000/client/home'), ON)).toBe(false)
    expect(devModeOnForRequest(request('http://localhost:3000/client/home', { cookie: `${DEV_MODE_COOKIE}=0` }), ON)).toBe(false)
    expect(devModeOnForRequest(request('http://localhost:3000/client/home', { cookie }), {})).toBe(false)
    expect(devModeOnForRequest(request('http://localhost:3000/client/home', { cookie, host: '192.168.1.5:3000' }), ON)).toBe(false)
  })
})

describe('production', () => {
  it('production is always off', () => {
    // Everything else favourable: flag, localhost, the cookie, no platform
    // variable — both in the real environment and in the one passed in.
    stubRealEnv('1')
    vi.stubEnv('NODE_ENV', 'production')
    const favourable = { NODE_ENV: 'development', ENABLE_DEV_AUTH_ROUTES: '1' } as Partial<NodeJS.ProcessEnv>
    const cookie = `${DEV_MODE_COOKIE}=1`
    const page = request('http://localhost:3000/admin-giga-panel', { cookie })
    const api = request('http://localhost:3000/api/dev/login', { method: 'POST', cookie, headers: { origin: 'http://localhost:3000' } })

    for (const host of LOCAL_HOSTS) {
      expect(devAccessEnabled(host), host).toBe(false)
      expect(devAccessEnabled(host, favourable), host).toBe(false)
      expect(devModeOn(host, '1'), host).toBe(false)
      expect(devModeOn(host, '1', favourable), host).toBe(false)
    }
    for (const req of [page, api]) {
      expect(devAccessEnabledForRequest(req)).toBe(false)
      expect(devAccessEnabledForRequest(req, favourable)).toBe(false)
      expect(devModeOnForRequest(req)).toBe(false)
      expect(devModeOnForRequest(req, favourable)).toBe(false)
    }

    // The same calls are on again outside production: the test above is not
    // passing for another reason.
    vi.stubEnv('NODE_ENV', 'test')
    expect(devAccessEnabled('localhost:3000')).toBe(true)
    expect(devModeOnForRequest(page)).toBe(true)
    expect(devAccessEnabledForRequest(api)).toBe(true)
  })

  it('every guard starts with the literal NODE_ENV check that the build folds', () => {
    // Next replaces the expression `process.env.NODE_ENV` at build time. Only
    // the literal form is replaced, and only then is the guard the constant
    // `false` in a production build — whatever the request or the environment.
    const source = readFileSync('lib/dev/dev-access.ts', 'utf8')
    for (const name of ['devAccessConfigured', 'devAccessEnabled', 'devModeOn', 'devAccessEnabledForRequest', 'devModeOnForRequest']) {
      const start = source.indexOf(`export function ${name}(`)
      expect(start, name).toBeGreaterThan(-1)
      const body = source.slice(start, source.indexOf('\n}\n', start))
      expect(body, name).toMatch(/\{\n {2}return \(\n {4}process\.env\.NODE_ENV !== 'production' &&\n/)
    }
  })

  it('the module is Edge-safe: it imports nothing', () => {
    const source = readFileSync('lib/dev/dev-access.ts', 'utf8')
    expect(source).not.toMatch(/^\s*import\s/m)
    expect(source).not.toMatch(/\brequire\(/)
  })
})

describe('devAccessConfigured', () => {
  it('is the build, the flag and the platform — no request yet', () => {
    expect(devAccessConfigured(ON)).toBe(true)
    expect(devAccessConfigured({})).toBe(false)
    expect(devAccessConfigured({ ...ON, PERSISTENT_SERVER: '1' })).toBe(false)
    vi.stubEnv('NODE_ENV', 'production')
    expect(devAccessConfigured(ON)).toBe(false)
  })
})

describe('devNotFound', () => {
  it('answers 404 { error: NOT_FOUND }', async () => {
    const res = devNotFound()
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'NOT_FOUND' })
  })
})
