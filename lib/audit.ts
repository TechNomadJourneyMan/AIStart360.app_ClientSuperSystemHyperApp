import { prisma } from '@/lib/db'

// ─── Types ────────────────────────────────────────────────────────────────────

export type AuditEntityType = 'request' | 'user' | 'company' | 'system'

export type AuditAction =
  | 'request.created'
  | 'request.approved'
  | 'request.rejected'
  | 'request.assigned'
  | 'request.status_changed'
  | 'request.info_requested'
  | 'request.escalated'
  | 'request.commented'
  | 'request.bulk_approved'
  | 'request.bulk_rejected'
  | 'request.bulk_assigned'
  | 'user.blocked'
  | 'user.unblocked'
  | 'user.role_changed'
  | 'company.created'
  | 'company.status_changed'

interface LogAuditOptions {
  entityType: AuditEntityType
  entityId: string
  action: AuditAction | string
  performedBy: string
  diff?: { before?: unknown; after?: unknown } | Record<string, unknown>
  ipAddress?: string
}

/**
 * Append an immutable audit log entry.
 * Fire-and-forget by default — errors are caught and logged to console,
 * not propagated, so audit failures never block business operations.
 */
export async function logAudit(opts: LogAuditOptions, throwOnError = false): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        entityType: opts.entityType,
        entityId: opts.entityId,
        action: opts.action,
        performedBy: opts.performedBy,
        diff: (opts.diff as object) ?? {},
        ipAddress: opts.ipAddress ?? null,
      },
    })
  } catch (err) {
    console.error('[audit] Failed to write audit log:', err)
    if (throwOnError) throw err
  }
}

/**
 * Helper: record an approval action.
 */
export function auditApprove(requestId: string, adminId: string, before: unknown) {
  return logAudit({
    entityType: 'request',
    entityId: requestId,
    action: 'request.approved',
    performedBy: adminId,
    diff: { before, after: { status: 'approved' } },
  })
}

/**
 * Helper: record a rejection action.
 */
export function auditReject(requestId: string, adminId: string, reason: string, before: unknown) {
  return logAudit({
    entityType: 'request',
    entityId: requestId,
    action: 'request.rejected',
    performedBy: adminId,
    diff: { before, after: { status: 'rejected', rejectionReason: reason } },
  })
}

/**
 * Helper: record a block/unblock action.
 */
export function auditUserBlock(userId: string, adminId: string, blocked: boolean) {
  return logAudit({
    entityType: 'user',
    entityId: userId,
    action: blocked ? 'user.blocked' : 'user.unblocked',
    performedBy: adminId,
    diff: { after: { status: blocked ? 'blocked' : 'active' } },
  })
}
