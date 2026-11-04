import type { NextRequest } from 'next/server'

/**
 * Giga super-admin authorization via a SIGNED, httpOnly cookie.
 *
 * Replaces the previous forgeable `aistart360_role=super_admin` cookie, which
 * was non-httpOnly and trivially settable from the browser console
 * (`document.cookie = 'aistart360_role=super_admin'`) — granting full
 * super-admin, cross-tenant data access and impersonation to any visitor.
 *
 * The new `aistart360_giga` cookie holds `super_admin.<hmac>`, where the HMAC
 * is computed server-side with a secret only the server knows. It cannot be
 * forged from the client. The cookie is httpOnly, so page JS cannot read or
 * re-pin it (the old GigaSidebar re-pin trick is removed).
 *
 * Implemented with Web Crypto (`crypto.subtle`) so this ONE module works in
 * BOTH the Edge runtime (middleware) and the Node runtime (route handlers).
 * Do NOT add any Node-only imports here.
 */

export const GIGA_COOKIE_NAME = 'aistart360_giga'
const PAYLOAD = 'super_admin'

function secret(): string {
  return (
    process.env.GIGA_COOKIE_SECRET ||
    process.env.AUTH_SECRET ||
    process.env.NEXTAUTH_SECRET ||
    process.env.GIGA_ADMIN_PASSWORD ||
    ''
  )
}

function toHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

async function hmacHex(payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret()),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload))
  return toHex(sig)
}

/** Constant-time compare of two equal-length hex strings. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

/** Mint the signed cookie value. Returns null when no secret is configured. */
export async function signGigaCookie(): Promise<string | null> {
  if (!secret()) return null
  return `${PAYLOAD}.${await hmacHex(PAYLOAD)}`
}

/** Verify a cookie value was minted by this server with the current secret. */
export async function verifyGigaCookie(value: string | null | undefined): Promise<boolean> {
  if (!value || !secret()) return false
  const dot = value.lastIndexOf('.')
  if (dot < 1) return false
  const payload = value.slice(0, dot)
  const sig = value.slice(dot + 1)
  if (payload !== PAYLOAD || !sig) return false
  const expected = await hmacHex(payload)
  return timingSafeEqual(sig, expected)
}

/** Route-handler helper: is this request an authenticated giga super-admin? */
export async function isGigaAdmin(req: NextRequest): Promise<boolean> {
  return verifyGigaCookie(req.cookies.get(GIGA_COOKIE_NAME)?.value)
}

export const GIGA_COOKIE_OPTIONS = {
  path: '/',
  maxAge: 60 * 60 * 24 * 7, // 7 days
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: process.env.NODE_ENV === 'production',
}
