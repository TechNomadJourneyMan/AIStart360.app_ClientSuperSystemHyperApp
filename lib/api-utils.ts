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
