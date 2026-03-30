export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requirePermission } from '@/lib/rbac'
import { logAudit } from '@/lib/audit'

const INCLUDE_FULL = {
  user: { select: { id: true, name: true, email: true, avatarUrl: true, role: true } },
  company: { select: { id: true, name: true, domain: true, status: true } },
  assignedAdmin: { select: { id: true, name: true, email: true, avatarUrl: true } },
  comments: {
    include: { author: { select: { id: true, name: true, avatarUrl: true, role: true } } },
    orderBy: { createdAt: 'asc' as const },
  },
} as const

type RouteParams = { params: { id: string } }

// ─── GET /api/admin/requests/:id ──────────────────────────────────────────────

export async function GET(_req: NextRequest, { params }: RouteParams) {
  const { error } = await requirePermission('requests:read')
  if (error) return error

  const request = await prisma.adminRequest.findUnique({
    where: { id: params.id },
    include: INCLUDE_FULL,
  })

  if (!request) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ data: request })
}

// ─── PATCH /api/admin/requests/:id ────────────────────────────────────────────

/**
 * Update fields on a request (priority, status, payload, companyId, etc.)
 * For specific actions (approve/reject/assign) use the dedicated sub-routes.
 */
export async function PATCH(req: NextRequest, { params }: RouteParams) {
  const { session, error } = await requirePermission('requests:write')
  if (error) return error

  const body = await req.json()
  const { priority, status, payload, companyId, slaDeadline } = body

  const before = await prisma.adminRequest.findUnique({ where: { id: params.id } })
  if (!before) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const updated = await prisma.adminRequest.update({
    where: { id: params.id },
    data: {
      ...(priority && { priority }),
      ...(status && { status }),
      ...(payload && { payload }),
      ...(companyId !== undefined && { companyId }),
      ...(slaDeadline && { slaDeadline: new Date(slaDeadline) }),
    },
    include: INCLUDE_FULL,
  })

  await logAudit({
    entityType: 'request',
    entityId: params.id,
    action: 'request.status_changed',
    performedBy: session.user.id,
    diff: { before: { status: before.status, priority: before.priority }, after: { status, priority } },
  })

  return NextResponse.json({ data: updated })
}
