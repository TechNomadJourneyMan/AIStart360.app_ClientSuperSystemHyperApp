import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requirePermission } from '@/lib/rbac'
import { logAudit } from '@/lib/audit'

/**
 * POST /api/admin/requests/:id/assign
 * Body: { adminId: string }  — or omit to unassign
 *
 * Assign (or re-assign) a request to an admin.
 * Also transitions status from "new" to "in_review".
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const { session, error } = await requirePermission('requests:assign')
  if (error) return error

  const body = await req.json()
  const { adminId } = body

  const request = await prisma.adminRequest.findUnique({ where: { id: params.id } })
  if (!request) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Verify target admin exists
  if (adminId) {
    const admin = await prisma.user.findUnique({ where: { id: adminId } })
    if (!admin) return NextResponse.json({ error: 'Admin not found' }, { status: 404 })
    if (!['SUPER_ADMIN', 'ADMIN', 'MANAGER'].includes(admin.role)) {
      return NextResponse.json({ error: 'Target user cannot be assigned requests' }, { status: 422 })
    }
  }

  const updated = await prisma.adminRequest.update({
    where: { id: params.id },
    data: {
      assignedAdminId: adminId ?? null,
      // Auto-advance status from new to in_review on first assignment
      status: request.status === 'new' && adminId ? 'in_review' : request.status,
    },
    include: {
      assignedAdmin: { select: { id: true, name: true, email: true } },
    },
  })

  await logAudit({
    entityType: 'request',
    entityId: params.id,
    action: 'request.assigned',
    performedBy: session.user.id,
    diff: { before: { assignedAdminId: request.assignedAdminId }, after: { assignedAdminId: adminId } },
  })

  return NextResponse.json({ data: updated })
}
