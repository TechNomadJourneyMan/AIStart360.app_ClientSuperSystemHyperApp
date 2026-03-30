export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { AdminRequestStatus } from '@prisma/client'
import { requirePermission } from '@/lib/rbac'
import { logAudit } from '@/lib/audit'

/**
 * POST /api/admin/requests/bulk
 * Body: {
 *   operation: "approve" | "reject" | "assign" | "archive"
 *   ids: string[]
 *   reason?: string      (required for reject)
 *   adminId?: string     (required for assign)
 * }
 *
 * Processes up to 100 requests in a single transaction.
 */
export async function POST(req: NextRequest) {
  const { session, error } = await requirePermission('requests:bulk')
  if (error) return error

  const body = await req.json()
  const { operation, ids, reason, adminId } = body

  if (!operation || !Array.isArray(ids) || ids.length === 0) {
    return NextResponse.json({ error: 'operation and ids[] are required' }, { status: 400 })
  }
  if (ids.length > 100) {
    return NextResponse.json({ error: 'Maximum 100 items per bulk operation' }, { status: 400 })
  }

  let updateData: Record<string, unknown> = {}

  switch (operation) {
    case 'approve':
      updateData = { status: 'approved' }
      break

    case 'reject':
      if (!reason?.trim()) {
        return NextResponse.json({ error: 'reason is required for bulk reject' }, { status: 400 })
      }
      updateData = { status: 'rejected', rejectionReason: reason.trim() }
      break

    case 'assign':
      if (!adminId) {
        return NextResponse.json({ error: 'adminId is required for bulk assign' }, { status: 400 })
      }
      updateData = { assignedAdminId: adminId, status: 'in_review' }
      break

    case 'archive':
      // Mark as rejected with system reason — or add an 'archived' status extension
      updateData = { status: 'rejected', rejectionReason: 'Archived in bulk' }
      break

    default:
      return NextResponse.json({ error: `Unknown operation: ${operation}` }, { status: 400 })
  }

  // Only operate on non-terminal requests
  const terminalStatuses: AdminRequestStatus[] = ['approved', 'rejected']
  const result = await prisma.adminRequest.updateMany({
    where: {
      id: { in: ids },
      status: { notIn: terminalStatuses },
    },
    data: updateData,
  })

  // Single audit entry for the entire batch
  await logAudit({
    entityType: 'request',
    entityId: ids.join(','),
    action: `request.bulk_${operation}` as never,
    performedBy: session.user.id,
    diff: { after: { operation, count: result.count, updateData } },
  })

  return NextResponse.json({
    message: `Bulk ${operation} applied`,
    affected: result.count,
    skipped: ids.length - result.count,
  })
}
