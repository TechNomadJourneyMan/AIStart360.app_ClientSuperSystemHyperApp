import crypto from 'node:crypto'

/**
 * Short-lived HMAC token for authenticating TRUSTED server-to-server calls
 * between our own API routes (e.g. `diagnostics/recalculate` → `ai-analyze`).
 *
 * Background: several internal endpoints run heavy, paid AI work and must never
 * be callable by an anonymous external client. But the fan-out `fetch()` from
 * one route to another does NOT forward the user's Supabase cookies, so we can't
 * rely on the session there. We therefore mint a signed, expiring token and
 * verify it in constant time.
 *
 * Token format (v2):  "v2." base64url(JSON claims) "." hex(HMAC_SHA256("internal-v2|" + claims))
 *   claims: { exp, path?, uid?, did? }
 *
 * A token may be BOUND to the target path, the user and the diagnostic: then
 * it verifies only on that path and only for those ids, so a leaked token
 * cannot be replayed against another endpoint or for another user. Senders
 * bind with `internalFetchHeaders(extra, { path, userId, diagnosticId })`;
 * receivers pass the ids they are about to act on to `hasValidInternalToken`.
 * A bound claim the receiver cannot match fails closed.
 *
 * The secret is INTERNAL_TOKEN_SECRET when set (falls back to AUTH_SECRET and
 * friends); the "internal-v2|" prefix keeps these MACs distinct from any other
 * HMAC made with a shared secret.
 */

export const INTERNAL_TOKEN_HEADER = 'x-internal-token'

/** The fan-out fires immediately; a minute covers queueing and cold starts. */
export const INTERNAL_TOKEN_TTL_MS = 60_000

const VERSION = 'v2'
const DOMAIN = 'internal-v2|'

export interface InternalTokenBinding {
  /** Target pathname, e.g. '/api/v1/diagnostics/ai-analyze'. */
  path?: string
  userId?: string
  diagnosticId?: string
}

interface Claims {
  exp: number
  path?: string
  uid?: string
  did?: string
}

function secret(): string {
  const s =
    process.env.INTERNAL_TOKEN_SECRET ||
    process.env.AUTH_SECRET ||
    process.env.NEXTAUTH_SECRET ||
    process.env.GIGA_COOKIE_SECRET
  if (!s) {
    // Fail closed: without a secret we cannot produce/verify a trustworthy
    // signature, so no internal token will ever validate.
    throw new Error('INTERNAL_TOKEN_SECRET (or AUTH_SECRET) is not set — cannot sign internal tokens')
  }
  return s
}

function mac(body: string): string {
  return crypto.createHmac('sha256', secret()).update(DOMAIN + body).digest('hex')
}

/**
 * Mint a token. `opts` may be the TTL in ms (legacy signature) or a binding
 * plus an optional `ttlMs` (default INTERNAL_TOKEN_TTL_MS).
 */
export function signInternalToken(opts: number | (InternalTokenBinding & { ttlMs?: number }) = {}): string {
  const o = typeof opts === 'number' ? { ttlMs: opts } : opts
  const claims: Claims = { exp: Date.now() + (o.ttlMs ?? INTERNAL_TOKEN_TTL_MS) }
  if (o.path) claims.path = o.path
  if (o.userId) claims.uid = o.userId
  if (o.diagnosticId) claims.did = o.diagnosticId
  const body = Buffer.from(JSON.stringify(claims)).toString('base64url')
  return `${VERSION}.${body}.${mac(body)}`
}

/**
 * Verify a token: correct signature, not expired, and every bound claim
 * matches `expect`. Never throws.
 */
export function verifyInternalToken(token: string | null | undefined, expect: InternalTokenBinding = {}): boolean {
  try {
    if (!token) return false
    const [version, body, sig, extra] = token.split('.')
    if (version !== VERSION || !body || !sig || extra !== undefined) return false
    const a = Buffer.from(sig, 'utf8')
    const b = Buffer.from(mac(body), 'utf8')
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false
    const claims = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as Partial<Claims>
    if (typeof claims.exp !== 'number' || !Number.isFinite(claims.exp) || Date.now() >= claims.exp) return false
    if (claims.path !== undefined && claims.path !== expect.path) return false
    if (claims.uid !== undefined && claims.uid !== expect.userId) return false
    if (claims.did !== undefined && claims.did !== expect.diagnosticId) return false
    return true
  } catch {
    return false
  }
}

/**
 * True when the incoming request carries a valid internal token. The path is
 * taken from the request itself; pass the user / diagnostic ids the handler is
 * about to act on so a token bound to other ids is refused.
 */
export function hasValidInternalToken(req: Request, expect: Omit<InternalTokenBinding, 'path'> = {}): boolean {
  let path: string | undefined
  try {
    path = new URL(req.url).pathname
  } catch {
    return false
  }
  return verifyInternalToken(req.headers.get(INTERNAL_TOKEN_HEADER), { ...expect, path })
}

/** Headers for an outgoing internal fetch (JSON body + fresh, optionally bound token). */
export function internalFetchHeaders(
  extra: Record<string, string> = {},
  bind: InternalTokenBinding = {},
): Record<string, string> {
  return { 'Content-Type': 'application/json', [INTERNAL_TOKEN_HEADER]: signInternalToken(bind), ...extra }
}

/**
 * Base URL for internal fan-out fetches. Never the request's Host header in
 * production (a spoofed Host would receive the token): NEXT_PUBLIC_APP_URL,
 * else the Vercel deployment URL. Outside production the request origin is
 * accepted for local development. Null when nothing trustworthy is known —
 * the caller must then skip the fan-out.
 */
export function internalBaseUrl(req: { nextUrl?: { origin: string }; url?: string }): string | null {
  const configured = process.env.NEXT_PUBLIC_APP_URL?.trim()
  if (configured) return configured.replace(/\/+$/, '')
  const vercel = process.env.VERCEL_URL?.trim()
  if (vercel) return `https://${vercel.replace(/^https?:\/\//, '').replace(/\/+$/, '')}`
  if (process.env.NODE_ENV === 'production') return null
  try {
    return req.nextUrl?.origin ?? (req.url ? new URL(req.url).origin : null)
  } catch {
    return null
  }
}
