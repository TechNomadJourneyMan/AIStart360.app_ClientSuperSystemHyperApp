export type PortalRole = 'super_admin' | 'admin' | 'expert' | 'owner' | 'client'

export function normalizePortalRole(role: string | null | undefined): PortalRole {
  if (
    role === 'super_admin' ||
    role === 'admin' ||
    role === 'expert' ||
    role === 'owner' ||
    role === 'client'
  ) {
    return role
  }
  if (role === 'manager' || role === 'analyst') return 'expert'
  return 'client'
}

export function portalHomeFor(
  role: string | null | undefined,
  status?: string | null,
): string {
  const normalizedRole = normalizePortalRole(role)
  if (normalizedRole === 'super_admin') return '/admin-giga-panel'
  if (normalizedRole === 'admin') return '/dashboard'
  if (normalizedRole === 'expert') return '/expert/dashboard'
  if (normalizedRole === 'owner') return '/owner/dashboard'
  return status === 'approved' ? '/client/dashboard' : '/client/waiting-room'
}

export function ownerRouteForLegacyClientPath(pathname: string): string {
  if (pathname.startsWith('/client/onboarding/documents')) return '/owner/documents'
  if (pathname.startsWith('/client/onboarding')) return '/owner/onboarding'
  if (pathname.startsWith('/client/point-a')) return '/owner/point-a'
  return '/owner/dashboard'
}
