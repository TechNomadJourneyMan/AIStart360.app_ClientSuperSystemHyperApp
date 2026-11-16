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
 *
 * R-029: every client lands in the new cabinet — `/client/home` once approved,
 * the waiting room before. An unknown / missing role is a client, as everywhere
 * else (middleware normalizeRole, the auth store).
 *
 * R-002: a legacy `profiles.role = 'super_admin'` is staff only with a
 * `staff_roles` row. `staffRole === null` means «looked up, there is none»: such
 * an account lands as a client — the panel would send it back (a redirect
 * loop). `undefined` means the caller did not look it up: the panel decides.
 */
export function roleLandingPath(
  role: UserRole | null | undefined,
  status?: string | null,
  staffRole?: string | null,
): string {
  if (staffRole === 'super_expert') return '/super-expert'
  if (staffRole) return '/admin-giga-panel'
  const clientLanding = status === 'approved' ? '/client/home' : '/client/waiting-room'
  // Legacy rows, as middleware normalizeRole reads them: 'owner' is a client
  // (the owner cabinet was removed), 'manager' / 'analyst' are experts.
  switch (role as string | null | undefined) {
    case 'super_admin':
      return staffRole === null ? clientLanding : '/admin-giga-panel'
    case 'expert':
    case 'manager':
    case 'analyst':
      return '/expert/dashboard'
    case 'admin':
      return '/dashboard'
    default:
      // 'client', 'owner' and an unknown role. /client/home = the cabinet's home page.
      return clientLanding
  }
}

/**
 * R-029: «my cabinet» for an entry that does not know who is coming in — the
 * e-mail sign-in link, an invitation to an existing account, a finished
 * password reset, the 404 and error pages. Middleware sends a signed-in user
 * on /login straight to `roleLandingPath` (profiles + staff_roles, read on the
 * server); a guest sees the sign-in form. Never point these entries at a
 * fixed cabinet page: `/dashboard` was the old shell for everyone.
 */
export const CABINET_ENTRY_PATH = '/login'

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
