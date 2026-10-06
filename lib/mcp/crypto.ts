/**
 * lib/mcp/crypto.ts — secrets of the MCP server.
 *
 * Every credential (personal token, OAuth code / access / refresh token,
 * client secret) is 32 random bytes, base64url, behind a short type prefix so
 * a leaked value is recognisable (and secret scanners can match it). Only the
 * SHA-256 hex digest is stored; lookups are by digest. 256 bits of entropy make
 * a fast hash sufficient (no password-style stretching needed).
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'

export const TOKEN_PREFIX = {
  pat: 'a360_pat_',
  access: 'a360_at_',
  refresh: 'a360_rt_',
  code: 'a360_ac_',
  clientSecret: 'a360_cs_',
} as const
export type TokenKind = keyof typeof TOKEN_PREFIX

const BODY = /^[A-Za-z0-9_-]{43}$/

export function newSecret(kind: TokenKind): string {
  return `${TOKEN_PREFIX[kind]}${randomBytes(32).toString('base64url')}`
}

/** True when `value` has the shape of a `kind` credential (prefix + 43 base64url chars). */
export function looksLike(kind: TokenKind, value: string | null | undefined): value is string {
  if (!value || !value.startsWith(TOKEN_PREFIX[kind])) return false
  return BODY.test(value.slice(TOKEN_PREFIX[kind].length))
}

export function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

/** Display prefix of a token (never enough to use it): «a360_pat_AbCdEfG». */
export function displayPrefix(token: string): string {
  const kind = (Object.keys(TOKEN_PREFIX) as TokenKind[]).find((k) => token.startsWith(TOKEN_PREFIX[k]))
  const head = kind ? TOKEN_PREFIX[kind].length : 0
  return token.slice(0, head + 7)
}

export function newClientId(): string {
  return `mcpc_${randomBytes(16).toString('base64url')}`
}

export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a)
  const y = Buffer.from(b)
  return x.length === y.length && timingSafeEqual(x, y)
}

/** RFC 7636 §4.1: code_verifier = 43*128 unreserved characters. */
export const PKCE_VERIFIER = /^[A-Za-z0-9\-._~]{43,128}$/
/** S256 challenge = base64url(SHA-256(verifier)) without padding: 43 chars. */
export const PKCE_CHALLENGE = /^[A-Za-z0-9_-]{43}$/

/** RFC 7636 §4.6 with method S256 (the only method this server accepts). */
export function pkceS256Matches(verifier: string, challenge: string): boolean {
  if (!PKCE_VERIFIER.test(verifier) || !PKCE_CHALLENGE.test(challenge)) return false
  const computed = createHash('sha256').update(verifier, 'ascii').digest('base64url')
  return safeEqual(computed, challenge)
}
