/**
 * lib/mcp/urls.ts — public URLs of the MCP server and its authorization server.
 *
 * The resource identifier (RFC 8707 / RFC 9728 `resource`) is the canonical URI
 * of the MCP endpoint, `<origin>/api/mcp`, and the issuer of the authorization
 * server is `<origin>` (no path) — see MCP Authorization «Canonical Server URI»:
 * https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization#canonical-server-uri
 *
 * The origin is the one the client used (Vercel sets x-forwarded-host /
 * x-forwarded-proto), so a preview deployment advertises itself and tokens
 * issued there are bound to its own resource URL. MCP_PUBLIC_ORIGIN pins it
 * when a deployment sits behind another proxy.
 */

export const MCP_PATH = '/api/mcp'
export const PRM_PATH = '/.well-known/oauth-protected-resource'
export const AS_METADATA_PATH = '/.well-known/oauth-authorization-server'
export const OAUTH_PATHS = {
  authorize: '/api/oauth/authorize',
  decision: '/api/oauth/authorize/decision',
  token: '/api/oauth/token',
  register: '/api/oauth/register',
  revoke: '/api/oauth/revoke',
  consent: '/oauth/consent',
} as const

interface HeaderSource { get(name: string): string | null }

function first(v: string | null): string | null {
  const s = v?.split(',')[0]?.trim()
  return s ? s : null
}

/** `scheme://host[:port]`, lower-case, without a trailing slash. */
export function publicOrigin(headers: HeaderSource, fallbackUrl?: string): string {
  const pinned = process.env.MCP_PUBLIC_ORIGIN?.trim()
  if (pinned) return pinned.replace(/\/+$/, '').toLowerCase()
  const fb = fallbackUrl ? new URL(fallbackUrl) : null
  const host = first(headers.get('x-forwarded-host')) ?? first(headers.get('host')) ?? fb?.host ?? 'localhost'
  const proto = first(headers.get('x-forwarded-proto')) ?? fb?.protocol.replace(':', '') ?? 'https'
  return `${proto === 'http' ? 'http' : 'https'}://${host}`.toLowerCase()
}

export function mcpResourceUrl(origin: string): string {
  return `${origin}${MCP_PATH}`
}

/** The protected resource metadata URL announced in WWW-Authenticate (path-inserted form, RFC 9728 §3.1). */
export function resourceMetadataUrl(origin: string): string {
  return `${origin}${PRM_PATH}${MCP_PATH}`
}

/**
 * Compare a client-supplied `resource` with ours. Scheme and host are compared
 * case-insensitively (MCP: implementations SHOULD accept uppercase scheme and
 * host), one trailing slash is ignored; a fragment or a different path fails.
 */
export function sameResource(candidate: string | null | undefined, ours: string): boolean {
  if (!candidate) return false
  let a: URL
  let b: URL
  try {
    a = new URL(candidate)
    b = new URL(ours)
  } catch {
    return false
  }
  if (a.hash || a.username || a.password) return false
  const path = (u: URL) => (u.pathname.length > 1 ? u.pathname.replace(/\/$/, '') : '')
  return a.protocol === b.protocol && a.host === b.host && path(a) === path(b) && a.search === b.search
}
