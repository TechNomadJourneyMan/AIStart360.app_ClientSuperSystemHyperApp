import { auth } from '@/lib/auth'
import { NextResponse } from 'next/server'
import type { UserRole } from '@prisma/client'

export async function requireAuth() {
  const session = await auth()
  if (!session?.user) {
    return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  }
  return { session }
}

export async function requireRole(...roles: UserRole[]) {
  const { session, error } = await requireAuth()
  if (error) return { error }

  const role = (session!.user as any).role as UserRole
  if (!roles.includes(role)) {
    return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  }

  return { session: session!, role }
}

/** Staff (non-CLIENT) roles that may manage org-owned CRM records. */
const STAFF_ROLES: readonly string[] = ['SUPER_ADMIN', 'ADMIN', 'MANAGER', 'ANALYST']

/** True when the given role string is a staff role (i.e. not a self-serve CLIENT). */
export function isStaffRole(role: unknown): boolean {
  return typeof role === 'string' && STAFF_ROLES.includes(role)
}
