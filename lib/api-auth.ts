import { cookies } from 'next/headers'
import { createServerClient } from '@/lib/supabase-server'
import { verifyGigaCookie, GIGA_COOKIE_NAME } from '@/lib/giga-auth'
import { srGet } from '@/lib/expert-auth'

/**
 * Server-side auth helpers for API route handlers.
 *
 * The canonical identity for "my own data" endpoints is the Supabase session
 * user — NEVER a `user_id` taken from the query string or request body (that
 * was an unauthenticated cross-tenant IDOR). Derive the id here instead.
 */

/** Returns the authenticated Supabase user's id, or null if not signed in. */
export async function getSessionUserId(): Promise<string | null> {
  const sb = createServerClient()
  const {
    data: { user },
  } = await sb.auth.getUser()
  return user?.id ?? null
}

const ADMIN_ROLES = new Set(['admin', 'super_admin'])

/**
 * True if the caller is a platform admin: either an authenticated giga
 * super-admin (signed cookie) OR a Supabase session whose profile role is
 * admin/super_admin. Role is read via service-role to avoid the profiles RLS
 * recursion. Works in no-arg handlers (reads cookies via next/headers).
 */
export async function isAdmin(): Promise<boolean> {
  const store = cookies()
  if (await verifyGigaCookie(store.get(GIGA_COOKIE_NAME)?.value)) return true

  const sb = createServerClient()
  const {
    data: { user },
  } = await sb.auth.getUser()
  if (!user) return false

  const rows = await srGet<Array<{ role: string | null }>>(
    `profiles?id=eq.${user.id}&select=role&limit=1`,
  )
  return ADMIN_ROLES.has(rows?.[0]?.role ?? '')
}

/**
 * Shared secret for internal server-to-server calls (e.g. recalculate →
 * ai-analyze). These endpoints carry no user session, so we authenticate the
 * caller with a header secret instead of leaving them open to the internet.
 */
export const INTERNAL_TOKEN =
  process.env.AI_INTERNAL_TOKEN ||
  process.env.AUTH_SECRET ||
  process.env.NEXTAUTH_SECRET ||
  ''

export function hasInternalToken(req: Request): boolean {
  if (!INTERNAL_TOKEN) return false
  return req.headers.get('x-internal-token') === INTERNAL_TOKEN
}

export const INTERNAL_HEADERS: Record<string, string> = {
  'Content-Type': 'application/json',
  'x-internal-token': INTERNAL_TOKEN,
}
