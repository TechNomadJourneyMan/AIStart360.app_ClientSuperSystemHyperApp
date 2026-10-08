import type { UserRole } from '@/types'
import { safeInternalPath } from '@/lib/safe-redirect'

/**
 * FE-06: the single post-authentication landing path for a role.
 *
 * Previously the login page, the register page and middleware each hard-coded
 * their own (divergent) role→path branching. This is the one source of truth.
 *
 * `staffRole` is the caller's `staff_roles.role` (lib/admin/rbac.ts STAFF_ROLES),
 * when they have one. Staff land in their workspace whatever `profiles.role`
 * says: a SuperExpert in `/super-expert`, every other staff role in the GIGA
 * panel. (A super_admin granted only through `staff_roles` used to land in the
 * client cabinet because their profile role is 'client'.)
 */
export function roleLandingPath(
  role: UserRole | null | undefined,
  status?: string | null,
  staffRole?: string | null,
): string {
  if (staffRole === 'super_expert') return '/super-expert'
  if (staffRole) return '/admin-giga-panel'
  // A leftover legacy 'owner' row behaves like a client (the owner cabinet was removed).
  switch ((role as string | null | undefined) === 'owner' ? 'client' : role) {
    case 'super_admin':
      return '/admin-giga-panel'
    case 'expert':
      return '/expert/dashboard'
    case 'admin':
      return '/dashboard'
    case 'client':
      // /client/home = User Assessment Dashboard (survey profile + GRI); Точка А is one click away.
      return status === 'approved' ? '/client/home' : '/client/waiting-room'
    default:
      return '/dashboard'
  }
}

/** Auth pages a return path must never point back to (redirect loops). */
const AUTH_PAGES = ['/login', '/register', '/forgot-password', '/giga-login', '/super-expert/login']

/**
 * Where to go right after signing in: an explicit, same-origin `?from=` return
 * path wins (e.g. /login?from=/admin-giga-panel/users); otherwise the role
 * landing. Off-origin, protocol-relative and auth-page targets are ignored.
 * Middleware still decides whether the caller may open the target.
 */
export function postLoginPath(opts: {
  role: UserRole | null | undefined
  status?: string | null
  staffRole?: string | null
  from?: string | null
}): string {
  const from = safeInternalPath(opts.from, '')
  const path = from.split(/[?#]/, 1)[0]
  const isAuthPage = AUTH_PAGES.some((p) => path === p || path.startsWith(p + '/'))
  if (from && from !== '/' && !isAuthPage) return from
  return roleLandingPath(opts.role, opts.status, opts.staffRole)
}
