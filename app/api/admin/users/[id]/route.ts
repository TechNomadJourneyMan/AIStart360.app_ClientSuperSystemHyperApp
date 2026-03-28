import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requirePermission } from '@/lib/rbac'
import { logAudit } from '@/lib/audit'

type RouteParams = { params: { id: string } }

// ─── GET /api/admin/users/:id ─────────────────────────────────────────────────

export async function GET(_req: NextRequest, { params }: RouteParams) {
  const { error } = await requirePermission('users:read')
  if (error) return error

  const user = await prisma.user.findUnique({
    where: { id: params.id },
    include: {
      org: { select: { id: true, name: true, slug: true } },
      submittedRequests: {
        select: { id: true, type: true, status: true, priority: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
        take: 10,
      },
      _count: { select: { submittedRequests: true, managedClients: true } },
    },
  })

  if (!user) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Never expose password hash
  const { passwordHash: _, ...safe } = user as typeof user & { passwordHash?: string }
  return NextResponse.json({ data: safe })
}

// ─── PATCH /api/admin/users/:id ───────────────────────────────────────────────

/**
 * Update user fields (name, role).
 * Block/unblock use the dedicated /block endpoint.
 */
export async function PATCH(req: NextRequest, { params }: RouteParams) {
  const { session, error } = await requirePermission('users:write')
  if (error) return error

  const body = await req.json()
  const { name, role } = body

  // Only SUPER_ADMIN can change roles
  if (role && session.user.role !== 'SUPER_ADMIN') {
    return NextResponse.json({ error: 'Only SUPER_ADMIN can change user roles' }, { status: 403 })
  }

  const before = await prisma.user.findUnique({ where: { id: params.id } })
  if (!before) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const updated = await prisma.user.update({
    where: { id: params.id },
    data: {
      ...(name && { name }),
      ...(role && { role }),
    },
    select: { id: true, name: true, email: true, role: true, status: true },
  })

  if (role && role !== before.role) {
    await logAudit({
      entityType: 'user',
      entityId: params.id,
      action: 'user.role_changed',
      performedBy: session.user.id,
      diff: { before: { role: before.role }, after: { role } },
    })
  }

  return NextResponse.json({ data: updated })
}
