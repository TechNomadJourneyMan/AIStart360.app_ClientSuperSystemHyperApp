import type { UserRole } from '@/types'
import { safeInternalPath } from '@/lib/safe-redirect'

/** Approval holding page — shared by every role that is not approved yet. */
export const WAITING_ROOM_PATH = '/client/waiting-room'

/**
 * Same holding page, under the name the myhonor integration introduced.
 * Kept as an alias so both call styles resolve to one string — there must
 * never be two "waiting rooms" that can drift apart.
 */
export const CLIENT_WAITING_ROOM_PATH = WAITING_ROOM_PATH

/**
 * Canonical business-client cabinet: the shared (dashboard) route with the
 * full sidebar, Point A intelligence, the metric drill-down and the store
 * integration panel. `/client/dashboard` and `/client/dashboard-ecommerce`
 * are only redirect stubs pointing here — never send a user to those.
 */
export const CLIENT_DASHBOARD_PATH = '/dashboard'

// Staff (owner/expert/admin) may self-register, and the profiles trigger only
// auto-approves when no status was requested — so an explicit non-approved
// status must hold them outside the internal portal. A MISSING status is not a
// decision (the profile row could not be read); failing that read must not lock
// staff out, hence null/undefined counts as approved here. Clients are stricter
// by design — see `clientLandingPath`.
const isStaffApproved = (status?: string | null) => status == null || status === 'approved'

/**
 * The client half of the rule, exported on its own for the screens that
 * already know the role is `client` (post-questionnaire exits, impersonation).
 */
export function clientLandingPath(status?: string | null): string {
  return status === 'approved' ? CLIENT_DASHBOARD_PATH : WAITING_ROOM_PATH
}

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
      return isStaffApproved(status) ? CLIENT_DASHBOARD_PATH : WAITING_ROOM_PATH
    case 'client':
      return clientLandingPath(status)
    default:
      return CLIENT_DASHBOARD_PATH
  }
}

/**
 * Specialized business-cabinet return targets only for roles that may open
 * the shared shell and only after explicit approval. Every other role/status
 * keeps its canonical landing path, and attacker-controlled `from` values are
 * never returned before passing the internal-path guard.
 */
export function postLoginPath(
  role: UserRole | null | undefined,
  status: string | null | undefined,
  requestedFrom: string | null | undefined,
): string {
  const safeFrom = safeInternalPath(requestedFrom, CLIENT_DASHBOARD_PATH)
  const mayOpenBusinessCabinet =
    status === 'approved'
    && (role === 'client' || role === 'admin' || role === 'super_admin')
  const isBusinessTarget =
    safeFrom === '/store'
    || safeFrom === '/clinic'
    || safeFrom === '/client/journey/store'

  return isBusinessTarget && mayOpenBusinessCabinet
    ? safeFrom
    : roleLandingPath(role, status)
}
