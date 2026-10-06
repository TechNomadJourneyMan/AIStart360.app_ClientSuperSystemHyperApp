import { prisma } from '@/lib/db'
import { isStaffRole, type StaffRole } from '@/lib/admin/rbac'
import { E2E_SEAM_COOKIE_NAME, e2eSeamEnabled, verifyE2eSeamEdge } from './e2e-auth-seam-edge'

/**
 * Node side of the E2E auth seam (see ./e2e-auth-seam-edge.ts for the rules).
 *
 * Resolves an authentic seam cookie to the seeded user's REAL staff role,
 * read straight from Postgres (Prisma), because the E2E stand has no
 * reachable Supabase. The same admission rules as a personal session apply:
 * only an approved profile, super_admin from profiles.role, otherwise the
 * staff_roles row. Returns null — without touching the database — whenever
 * the seam is disabled (always in production).
 */
export interface E2eSeamIdentity {
  userId: string
  role: StaffRole
  email?: string
}

export async function resolveE2eSeamIdentity(
  cookies: { get(name: string): { value: string } | undefined },
): Promise<E2eSeamIdentity | null> {
  if (!e2eSeamEnabled()) return null
  const userId = await verifyE2eSeamEdge(cookies.get(E2E_SEAM_COOKIE_NAME)?.value)
  if (!userId) return null
  try {
    const rows = await prisma.$queryRaw<Array<{ role: string | null; status: string | null; email: string | null; staff_role: string | null }>>`
      SELECT p.role, p.status, p.email, s.role AS staff_role
      FROM public.profiles p
      LEFT JOIN public.staff_roles s ON s.user_id = p.id
      WHERE p.id = ${userId}::uuid
      LIMIT 1`
    const row = rows[0]
    if (!row || row.status !== 'approved') return null
    const role: StaffRole | null = row.role === 'super_admin' ? 'super_admin' : isStaffRole(row.staff_role) ? row.staff_role : null
    return role ? { userId, role, email: row.email ?? undefined } : null
  } catch {
    return null
  }
}
