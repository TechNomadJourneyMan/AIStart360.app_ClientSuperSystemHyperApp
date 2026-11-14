import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Identity helpers for API route handlers that historically trusted a
 * client-supplied `user_id` (query/body) and leaned entirely on RLS. The rule
 * for this app is "every route self-checks auth" — these helpers make that a
 * one-liner and let a route decide whether a caller may act on ANOTHER user's
 * data (staff only) versus only their own.
 *
 * NOTE: this module is also imported by a client component
 * (components/point-b/pointBAccess.ts → isStaffRole). Keep its static imports
 * client-safe: server-only checks are loaded with `await import()`.
 */

// Profile roles that LOOK like staff. Whether the caller really is staff, and
// for which clients, is decided by lib/access/actor.ts (migration 140).
const STAFF_ROLES = new Set(['expert', 'admin', 'super_admin', 'manager', 'analyst'])

/** The authenticated Supabase user, or null. */
export async function getSessionUser(sb: SupabaseClient): Promise<{ id: string; email?: string } | null> {
  const {
    data: { user },
  } = await sb.auth.getUser()
  return user ? { id: user.id, email: user.email ?? undefined } : null
}

/** `profiles.role` as stored (self-read under RLS) — no second-factor check. */
async function readProfileRole(sb: SupabaseClient, userId: string): Promise<string | null> {
  const { data } = await sb.from('profiles').select('role').eq('id', userId).maybeSingle()
  return typeof (data as { role?: unknown } | null)?.role === 'string'
    ? ((data as { role: string }).role)
    : null
}

/**
 * R-005: a staff session is admitted to staff rights only with the second
 * factor of THIS session (lib/mfa/api-staff-gate.ts — the staffMfaGate rule of
 * the GIGA / expert API). Fails closed.
 */
async function staffSecondFactorPassed(sb: SupabaseClient, userId: string): Promise<boolean> {
  try {
    const { staffApiSecondFactor } = await import('@/lib/mfa/api-staff-gate')
    return (await staffApiSecondFactor(sb, userId)) === 'ok'
  } catch {
    return false
  }
}

/**
 * The caller's role per migration 140 (lib/access/actor.ts): null when the rows
 * cannot be read. Loaded dynamically — this module stays client-compilable.
 */
async function sessionActor(userId: string) {
  try {
    const { resolveActor } = await import('@/lib/access/actor')
    return await resolveActor(userId)
  } catch {
    return null
  }
}

/**
 * The caller's role for authorization decisions (self-read; RLS allows reading
 * one's own row). A STAFF role is returned only when
 *  - the rule of migration 140 makes the caller staff or an active expert
 *    (lib/access/actor.ts): a legacy profiles.role admin / super_admin /
 *    manager / analyst WITHOUT a staff_roles row, or an expert whose profile
 *    is not approved (pending / rejected / blocked / archived), is NOT staff
 *    (SR-02) — and
 *  - the session passed its second factor (R-005).
 * Otherwise null, i.e. the caller is treated as a non-staff user acting on
 * their own data. Client roles are returned as is, without any further read.
 * The answer says nothing about WHICH clients the caller may touch — routes
 * that act on another user's data use mayActOnUser / resolveTargetUserId.
 */
export async function getSessionRole(sb: SupabaseClient, userId: string): Promise<string | null> {
  const role = await readProfileRole(sb, userId)
  if (!isStaffRole(role)) return role
  const actor = await sessionActor(userId)
  if (!actor || actor.kind === 'client') return null
  return (await staffSecondFactorPassed(sb, userId)) ? role : null
}

/**
 * The caller as staff per migration 140 (staff_roles, or an active expert —
 * whatever profiles.role says) who passed the second factor of this session;
 * null otherwise. `role` is the staff_roles role, else 'expert'. Unlike
 * getSessionRole it always reads the rows, so a staff member whose profile
 * role is 'client' is recognised too. Fails closed.
 */
export async function getSessionStaff(sb: SupabaseClient, userId: string): Promise<{ id: string; role: string } | null> {
  const actor = await sessionActor(userId)
  if (!actor || actor.kind === 'client') return null
  if (!(await staffSecondFactorPassed(sb, userId))) return null
  return { id: userId, role: actor.staffRole ?? 'expert' }
}

/**
 * May the session user `callerId` act on the data of `targetUserId`? Self —
 * always. Anyone else's — only staff / an active expert (migration 140, never
 * the legacy profiles.role) who passed the second factor of this session
 * (R-005), and only inside their client scope: staff that see every client,
 * otherwise the clients assigned to them (user_assignments) — the same rule
 * as can_read_company. Fails closed.
 */
export async function mayActOnUser(sb: SupabaseClient, callerId: string, targetUserId: string | null | undefined): Promise<boolean> {
  if (!targetUserId) return false
  if (targetUserId === callerId) return true
  const actor = await sessionActor(callerId)
  if (!actor || actor.kind === 'client') return false
  if (!(await staffSecondFactorPassed(sb, callerId))) return false
  try {
    const { canAccessClient } = await import('@/lib/access/actor')
    return await canAccessClient(actor, targetUserId)
  } catch {
    return false
  }
}

export function isStaffRole(role: string | null | undefined): boolean {
  return !!role && STAFF_ROLES.has(role)
}

/**
 * Resolve the target user id for a route that accepts an explicit `requestedId`.
 * - No session               → { error: 401 }
 * - No requestedId           → the session user (self)
 * - requestedId === self     → self
 * - requestedId !== self     → allowed ONLY for staff / an active expert
 *                              (migration 140) that passed the second factor of
 *                              this session (R-005) and whose client scope
 *                              covers requestedId (mayActOnUser); else 403
 */
export async function resolveTargetUserId(
  sb: SupabaseClient,
  requestedId: string | null | undefined,
): Promise<{ userId: string } | { error: 'unauthorized' } | { error: 'forbidden' }> {
  const user = await getSessionUser(sb)
  if (!user) return { error: 'unauthorized' }
  if (!requestedId || requestedId === user.id) return { userId: user.id }
  if (!(await mayActOnUser(sb, user.id, requestedId))) return { error: 'forbidden' }
  return { userId: requestedId }
}
