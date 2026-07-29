import type { UserRole } from '@/types'

/** Approval holding page — shared by every role that is not approved yet. */
export const WAITING_ROOM_PATH = '/client/waiting-room'

// Staff (owner/expert/admin) may self-register, and the profiles trigger only
// auto-approves when no status was requested — so an explicit non-approved
// status must hold them outside the internal portal. A MISSING status is not a
// decision (the profile row could not be read); failing that read must not lock
// staff out, hence null/undefined counts as approved here. Clients are stricter
// by design — see the 'client' branch.
const isStaffApproved = (status?: string | null) => status == null || status === 'approved'

/**
 * FE-06: the single post-authentication landing path for a role.
 *
 * Previously the login page, the register page and middleware each hard-coded
 * their own (divergent) role→path branching. This is the one source of truth.
 * Callers still handle their own special cases (e.g. the login demo flow and
 * the `?from=` return path) around it.
 *
 * Approval is part of the answer: nobody except super_admin lands inside a
 * portal while `profiles.status` says otherwise.
 */
export function roleLandingPath(
  role: UserRole | null | undefined,
  status?: string | null,
): string {
  switch (role) {
    case 'super_admin':
      return '/admin-giga-panel'
    case 'owner':
      return isStaffApproved(status) ? '/owner/dashboard' : WAITING_ROOM_PATH
    case 'expert':
      return isStaffApproved(status) ? '/expert/dashboard' : WAITING_ROOM_PATH
    case 'admin':
      return isStaffApproved(status) ? '/dashboard' : WAITING_ROOM_PATH
    case 'client':
      return status === 'approved' ? '/client/point-a' : WAITING_ROOM_PATH
    default:
      return '/dashboard'
  }
}
