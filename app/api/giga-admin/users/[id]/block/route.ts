import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'

function isSuperAdmin(req: NextRequest): boolean {
  const role = req.cookies.get('aistart360_role')?.value
  return role === 'super_admin'
}

/**
 * POST /api/giga-admin/users/:id/block
 *
 * Immediately invalidates all sessions for the target user,
 * effectively logging them out from all devices.
 *
 * Note: To persist a "blocked" state across logins, add a
 * `isBlocked Boolean @default(false)` field to the User model
 * and check it in the auth.ts session callback.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  if (!isSuperAdmin(req)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = params

  try {
    // Delete all active NextAuth sessions for this user
    await prisma.session.deleteMany({
      where: { userId: id },
    })

    return NextResponse.json({
      success: true,
      message: `Sessions invalidated for user ${id}`,
    })
  } catch (error) {
    console.error('[giga-admin/block] Error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
