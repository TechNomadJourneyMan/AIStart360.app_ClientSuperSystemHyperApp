import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Identity helpers for API route handlers that historically trusted a
 * client-supplied `user_id` (query/body) and leaned entirely on RLS. The rule
 * for this app is "every route self-checks auth" — these helpers make that a
 * one-liner and let a route decide whether a caller may act on ANOTHER user's
 * data (staff only) versus only their own.
 */

// Non-CLIENT roles that may act on another user's records (staff).
const STAFF_ROLES = new Set(['expert', 'admin', 'super_admin', 'manager', 'analyst'])

/** The authenticated Supabase user, or null. */
export async function getSessionUser(sb: SupabaseClient): Promise<{ id: string; email?: string } | null> {
  const {
    data: { user },
  } = await sb.auth.getUser()
  return user ? { id: user.id, email: user.email ?? undefined } : null
}

/** The caller's `profiles.role` (self-read; RLS allows reading one's own row). */
export async function getSessionRole(sb: SupabaseClient, userId: string): Promise<string | null> {
  const { data } = await sb.from('profiles').select('role').eq('id', userId).maybeSingle()
  return typeof (data as { role?: unknown } | null)?.role === 'string'
    ? ((data as { role: string }).role)
    : null
}

export function isStaffRole(role: string | null | undefined): boolean {
  return !!role && STAFF_ROLES.has(role)
}

/**
 * Resolve the target user id for a route that accepts an explicit `requestedId`.
 * - No session               → { error: 401 }
 * - No requestedId           → the session user (self)
 * - requestedId === self     → self
 * - requestedId !== self     → allowed ONLY for staff; else { error: 403 }
 */
export async function resolveTargetUserId(
  sb: SupabaseClient,
  requestedId: string | null | undefined,
): Promise<{ userId: string } | { error: 'unauthorized' } | { error: 'forbidden' }> {
  const user = await getSessionUser(sb)
  if (!user) return { error: 'unauthorized' }
  if (!requestedId || requestedId === user.id) return { userId: user.id }
  const role = await getSessionRole(sb, user.id)
  if (!isStaffRole(role)) return { error: 'forbidden' }
  return { userId: requestedId }
}
