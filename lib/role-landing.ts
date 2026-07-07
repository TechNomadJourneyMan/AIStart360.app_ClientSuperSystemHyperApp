import type { UserRole } from '@/types'

/**
 * FE-06: the single post-authentication landing path for a role.
 *
 * Previously the login page, the register page and middleware each hard-coded
 * their own (divergent) role→path branching. This is the one source of truth.
 * Callers still handle their own special cases (e.g. the login demo flow and
 * the `?from=` return path) around it.
 */
export function roleLandingPath(
  role: UserRole | null | undefined,
  status?: string | null,
): string {
  switch (role) {
    case 'super_admin':
      return '/admin-giga-panel'
    case 'owner':
      return '/owner/dashboard'
    case 'expert':
      return '/expert/dashboard'
    case 'admin':
      return '/dashboard'
    case 'client':
      return status === 'approved' ? '/client/point-a' : '/client/waiting-room'
    default:
      return '/dashboard'
  }
}
