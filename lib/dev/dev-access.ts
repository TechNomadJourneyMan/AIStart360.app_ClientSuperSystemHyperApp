// ─────────────────────────────────────────────────────────────────────────────
// Developer access — the one guard of the localhost developer login
// (/api/dev/session|login|mode|logout, the dev-mode branch in middleware.ts and
// the floating panel in components/dev).
//
// The developer login signs a browser in as any role without a password, so it
// must be impossible to switch on in production. Access needs ALL of:
//   1. process.env.NODE_ENV !== 'production'. Next.js replaces that expression
//      at build time, so in a production build every guard below is the
//      constant `false` and what it protects is dead code — no request header
//      and no environment variable can change that;
//   2. the explicit opt-in ENABLE_DEV_AUTH_ROUTES=1 (off by default everywhere);
//   3. a local host: localhost, 127.0.0.1, ::1 or *.localhost;
//   4. no hosting-platform variable (Railway, Vercel, a persistent server).
//
// Edge-safe (Web APIs only, no imports) — middleware imports this module.
// ─────────────────────────────────────────────────────────────────────────────

export const DEV_MODE_COOKIE = 'aistart360_dev_mode'
/** Read by the server only; without a lifetime it ends with the browser session. */
export const DEV_MODE_COOKIE_OPTIONS = { httpOnly: true, sameSite: 'lax', path: '/' } as const

/** Set by the hosting platform (or for it): a deployed server is never a developer's laptop. */
const PLATFORM_VARS = ['RAILWAY_ENVIRONMENT', 'RAILWAY_PROJECT_ID', 'VERCEL', 'PERSISTENT_SERVER'] as const

const LOCAL_NAME_RE = /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)*localhost$/
const BRACKETED_IPV6_RE = /^\[([0-9a-f:.]+)\](?::\d{1,5})?$/
const NAME_WITH_PORT_RE = /^([^:]+)(?::\d{1,5})?$/

/**
 * `host` (a hostname with an optional port, IPv6 in brackets) names this very
 * machine: localhost, 127.0.0.1, ::1 or a name under .localhost. Anything that
 * does not parse as exactly that is not local.
 */
export function isLocalHost(host: string | null | undefined): boolean {
  if (typeof host !== 'string' || host.length === 0 || host.length > 255) return false
  const value = host.toLowerCase()
  if (value === '::1') return true
  if (value.startsWith('[')) return BRACKETED_IPV6_RE.exec(value)?.[1] === '::1'
  const name = NAME_WITH_PORT_RE.exec(value)?.[1]
  return name === '127.0.0.1' || (name !== undefined && LOCAL_NAME_RE.test(name))
}

function isSet(value: string | undefined): boolean {
  return typeof value === 'string' && value.trim() !== ''
}

/** Developer access for a request that names `host`. Always `false` in a production build. */
export function devAccessEnabled(host: string | null | undefined, env: Partial<NodeJS.ProcessEnv> = process.env): boolean {
  return (
    process.env.NODE_ENV !== 'production' &&
    env.ENABLE_DEV_AUTH_ROUTES === '1' &&
    !PLATFORM_VARS.some((name) => isSet(env[name])) &&
    isLocalHost(host)
  )
}

/** Developer access plus the developer's own switch (the dev-mode cookie). */
export function devModeOn(
  host: string | null | undefined,
  cookie: string | undefined,
  env: Partial<NodeJS.ProcessEnv> = process.env,
): boolean {
  return (
    process.env.NODE_ENV !== 'production' &&
    devAccessEnabled(host, env) &&
    cookie === '1'
  )
}

/** What the guard reads from a request — a NextRequest fits. */
export interface DevAccessRequest {
  method: string
  nextUrl: { host: string }
  headers: { get(name: string): string | null }
  cookies: { get(name: string): { value: string } | undefined }
}

/**
 * Every host a request names; all of them must be local.
 *
 * Next.js builds `request.nextUrl` from the address the server listens on
 * (`localhost` unless `-H` is given), not from the Host header. On its own it
 * would call a request that came through a LAN address, a tunnel or a rebound
 * DNS name "localhost". The Host header is what the browser really asked for,
 * and X-Forwarded-Host is what a proxy in front was asked for.
 */
function requestHosts(request: DevAccessRequest): Array<string | null> {
  const forwarded = request.headers.get('x-forwarded-host')
  return [
    request.nextUrl.host,
    request.headers.get('host'),
    ...(forwarded === null ? [] : forwarded.split(',').map((host) => host.trim())),
  ]
}

const READ_METHODS = new Set(['GET', 'HEAD'])

/**
 * A request that changes something comes from the page it belongs to. Another
 * site open in the developer's browser can post to localhost; it cannot hide
 * where it posts from. A client that is not a browser sends no Origin.
 */
function sameOrigin(request: DevAccessRequest): boolean {
  if (READ_METHODS.has(request.method.toUpperCase())) return true
  const site = request.headers.get('sec-fetch-site')
  if (site !== null && site !== 'same-origin' && site !== 'none') return false
  const origin = request.headers.get('origin')
  if (origin === null) return true
  try {
    return new URL(origin).host === request.headers.get('host')?.toLowerCase()
  } catch {
    return false
  }
}

/**
 * Developer access for this request: what the dev routes and middleware ask.
 * Always `false` in a production build.
 */
export function devAccessEnabledForRequest(request: DevAccessRequest, env: Partial<NodeJS.ProcessEnv> = process.env): boolean {
  return (
    process.env.NODE_ENV !== 'production' &&
    requestHosts(request).every((host) => devAccessEnabled(host, env)) &&
    sameOrigin(request)
  )
}

/** Developer access for this request plus the dev-mode cookie. Always `false` in a production build. */
export function devModeOnForRequest(request: DevAccessRequest, env: Partial<NodeJS.ProcessEnv> = process.env): boolean {
  return (
    process.env.NODE_ENV !== 'production' &&
    devAccessEnabledForRequest(request, env) &&
    request.cookies.get(DEV_MODE_COOKIE)?.value === '1'
  )
}

/** What every dev route answers when developer access is off: there is no such route. */
export function devNotFound(): Response {
  return new Response(JSON.stringify({ error: 'NOT_FOUND' }), {
    status: 404,
    headers: { 'content-type': 'application/json' },
  })
}
