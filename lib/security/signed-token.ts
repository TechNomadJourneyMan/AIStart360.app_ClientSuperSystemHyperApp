/**
 * lib/security/signed-token.ts — compact HMAC-signed tokens for httpOnly cookies.
 *
 * Web Crypto only, so the SAME module works in middleware (Edge) and in route
 * handlers (Node 20 exposes globalThis.crypto.subtle).
 *
 * Format: `t1.<base64url(json claims)>.<base64url(HMAC-SHA256)>`.
 * Every token carries a `typ`; a token minted for one purpose never verifies
 * for another (an impersonation token is not a staff token and vice versa).
 */

export type SignedTokenType = 'imp' | 'staff'

export interface SignedClaims {
  typ: SignedTokenType
  /** Expiry, epoch seconds. */
  exp: number
  /** Issued at, epoch seconds. */
  iat: number
  [k: string]: unknown
}

const VERSION = 't1'
const enc = new TextEncoder()
const dec = new TextDecoder()

function secret(): string | null {
  return process.env.GIGA_COOKIE_SECRET || process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET || null
}

function toB64Url(bytes: Uint8Array): string {
  let bin = ''
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromB64Url(value: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) return null
  try {
    const b64 = value.replace(/-/g, '+').replace(/_/g, '/')
    const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4))
    const out = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
    return out
  } catch {
    return null
  }
}

async function hmac(key: string, message: string): Promise<Uint8Array> {
  const k = await crypto.subtle.importKey('raw', enc.encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, enc.encode(message)))
}

function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i]
  return diff === 0
}

export async function signToken<T extends Record<string, unknown>>(
  typ: SignedTokenType,
  payload: T,
  ttlSeconds: number,
): Promise<string> {
  const key = secret()
  if (!key) throw new Error('GIGA_COOKIE_SECRET (or AUTH_SECRET) is not set — cannot sign token')
  const iat = Math.floor(Date.now() / 1000)
  const claims = { ...payload, typ, iat, exp: iat + Math.max(1, Math.floor(ttlSeconds)) }
  const body = toB64Url(enc.encode(JSON.stringify(claims)))
  const input = `${VERSION}.${body}`
  return `${input}.${toB64Url(await hmac(key, input))}`
}

export type VerifyResult<T> =
  | { ok: true; claims: SignedClaims & T }
  | { ok: false; reason: 'missing' | 'malformed' | 'signature' | 'type' | 'expired'; claims?: SignedClaims & T }

/**
 * Verify signature and type. An EXPIRED but authentic token is reported with its
 * claims, so callers can clean up the state it guarded (e.g. end an
 * impersonation session) instead of treating it like garbage.
 */
export async function verifyToken<T extends Record<string, unknown>>(
  typ: SignedTokenType,
  token: string | null | undefined,
  nowMs = Date.now(),
): Promise<VerifyResult<T>> {
  if (!token) return { ok: false, reason: 'missing' }
  const key = secret()
  if (!key) return { ok: false, reason: 'signature' }
  const parts = token.split('.')
  if (parts.length !== 3 || parts[0] !== VERSION || token.length > 4096) return { ok: false, reason: 'malformed' }
  const sig = fromB64Url(parts[2])
  const body = fromB64Url(parts[1])
  if (!sig || !body) return { ok: false, reason: 'malformed' }
  const expected = await hmac(key, `${parts[0]}.${parts[1]}`)
  if (!equalBytes(expected, sig)) return { ok: false, reason: 'signature' }
  let claims: SignedClaims & T
  try {
    claims = JSON.parse(dec.decode(body))
  } catch {
    return { ok: false, reason: 'malformed' }
  }
  if (!claims || typeof claims !== 'object' || claims.typ !== typ) return { ok: false, reason: 'type' }
  if (typeof claims.exp !== 'number' || claims.exp * 1000 <= nowMs) return { ok: false, reason: 'expired', claims }
  return { ok: true, claims }
}
