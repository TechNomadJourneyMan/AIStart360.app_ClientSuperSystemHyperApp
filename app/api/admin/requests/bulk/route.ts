export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { AdminRequestStatus } from '@prisma/client'
import { requirePermission } from '@/lib/rbac'
import { logAudit } from '@/lib/audit'
import { applyApprovalDecision } from '@/lib/users/approval'

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

  // Only operate on non-terminal requests. Resolve the candidates FIRST so we
  // know exactly which rows (and which user emails) the batch touches — needed
  // to mirror the decision into profiles.status below.
  const terminalStatuses: AdminRequestStatus[] = ['approved', 'rejected']
  const candidates = await prisma.adminRequest.findMany({
    where: {
      id: { in: ids },
      status: { notIn: terminalStatuses },
    },
    select: { id: true, payload: true, user: { select: { email: true } } },
  })

  const result = await prisma.adminRequest.updateMany({
    where: { id: { in: candidates.map((c) => c.id) } },
    data: updateData,
  })

  // SINGLE SOURCE OF TRUTH: mirror approve/reject into profiles.status, exactly
  // like the single approve/reject routes do via applyApprovalDecision. Without
  // this, bulk-approved users stayed pending in the waiting room (the request
  // row said "approved" but the login flow reads profiles.status). `archive`
  // and `assign` are workflow-only operations and must NOT touch access.
  const mirrored: { email: string; ok: boolean }[] = []
  if (operation === 'approve' || operation === 'reject') {
    for (const c of candidates) {
      const email = c.user?.email ?? (c.payload as Record<string, string> | null)?.email
      if (!email) continue
      try {
        const { affected } = await applyApprovalDecision({
          email,
          status: operation === 'approve' ? 'approved' : 'rejected',
          reason: operation === 'reject' ? reason?.trim() : undefined,
        })
        mirrored.push({ email, ok: affected > 0 })
      } catch {
        mirrored.push({ email, ok: false })
      }
    }
  }
  const mirrorFailures = mirrored.filter((m) => !m.ok)

  // Single audit entry for the entire batch
  await logAudit({
    entityType: 'request',
    entityId: ids.join(','),
    action: `request.bulk_${operation}` as never,
    performedBy: session.user.id,
    diff: {
      after: {
        operation,
        count: result.count,
        updateData,
        profilesMirrored: mirrored.filter((m) => m.ok).length,
        profileFailures: mirrorFailures.map((m) => m.email),
      },
    },
  })

  if (mirrorFailures.length > 0) {
    // Same contract as the single approve route's `profile_not_found`: never
    // report silent success when access was not actually granted/revoked.
    return NextResponse.json(
      {
        error: 'profile_mirror_incomplete',
        message: `Обработано заявок: ${result.count}, но для ${mirrorFailures.length} пользователей статус профиля не обновлён — доступ не изменён. Проверьте email.`,
        affected: result.count,
        skipped: ids.length - result.count,
        profileFailures: mirrorFailures.map((m) => m.email),
      },
      { status: 409 },
    )
  }

  return NextResponse.json({
    message: `Bulk ${operation} applied`,
    affected: result.count,
    skipped: ids.length - result.count,
  })
}
