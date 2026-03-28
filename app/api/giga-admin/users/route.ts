import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'

// Guard: only SUPER_ADMIN may call these endpoints
function isSuperAdmin(req: NextRequest): boolean {
  const role = req.cookies.get('aistart360_role')?.value
  return role === 'super_admin'
}

/**
 * GET /api/giga-admin/users
 *
 * Returns all platform users with their org and status info.
 * Endpoint: protected, SUPER_ADMIN only.
 */
export async function GET(req: NextRequest) {
  if (!isSuperAdmin(req)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  try {
    const users = await prisma.user.findMany({
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        status: true,
        avatarUrl: true,
        lastLogin: true,
        createdAt: true,
        org: {
          select: { name: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    })

    const mapped = users.map((u) => ({
      id: u.id,
      name: u.name,
      email: u.email,
      role: u.role,
      avatarUrl: u.avatarUrl,
      lastLogin: u.lastLogin?.toISOString() ?? null,
      createdAt: u.createdAt.toISOString(),
      org: u.org?.name ?? null,
      status: (u.status as string ?? 'active').toLowerCase() as 'active' | 'blocked' | 'pending',
      widgets: [] as string[],
    }))

    return NextResponse.json({ users: mapped })
  } catch (error) {
    console.error('[giga-admin/users] Error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
