/**
 * lib/users/access-requests.ts — decision on a request for platform access
 * (registration), shared by PATCH /api/giga-admin/requests/:id and the admin
 * Telegram bot («👤 Пользователи и заявки»).
 *
 * The caller authorises (`users.approve`) and passes a SERVICE-ROLE client.
 * `requestId` is an admin_requests id or — for orphaned registrations the list
 * shows by profile — the profile UUID itself. The access-granting write goes
 * through applyApprovalDecision (profiles.status, affected-row check, email);
 * a 0-row result is a failure, never a silent success.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { logAudit } from '@/lib/audit'
import { applyApprovalDecision } from '@/lib/users/approval'

export type AccessAction = 'approve' | 'reject' | 'archive'

export type AccessDecisionResult =
  | { ok: true; status: 'approved' | 'rejected' | 'archived'; userId: string }
  | { ok: false; reason: 'profile_not_found'; userId: string }

export async function decideAccessRequest(
  sb: SupabaseClient | { from: SupabaseClient['from'] },
  args: {
    requestId: string
    action: AccessAction
    reason?: string
    actor: { id: string; kind: string }
    ipAddress?: string
  },
): Promise<AccessDecisionResult> {
  const requestStatus = ({ approve: 'approved', reject: 'rejected', archive: 'archived' } as const)[args.action]

  // 1. Resolve the target user. admin_requests is Prisma-owned → QUOTED
  //    camelCase columns ("userId", "rejectionReason", "updatedAt").
  let userId: string | null = null
  const { data: arRow } = await sb
    .from('admin_requests')
    .select('userId, payload')
    .eq('id', args.requestId)
    .maybeSingle()

  if (arRow) {
    const row = arRow as { userId?: string | null; payload?: Record<string, unknown> | null }
    const payload = row.payload ?? {}
    userId = row.userId ?? (typeof payload.userId === 'string' ? payload.userId : null)

    // History row (best-effort; NOT the access-granting write).
    const { error: arErr } = await sb
      .from('admin_requests')
      .update({
        status: requestStatus,
        ...(args.action === 'reject' && args.reason ? { rejectionReason: args.reason } : {}),
        updatedAt: new Date().toISOString(),
      })
      .eq('id', args.requestId)
    if (arErr) console.error('[access-requests] admin_requests update warning:', arErr.message)
  }

  // Orphaned registration: the request id is the profile UUID.
  if (!userId) userId = args.requestId

  // 2. The single source of truth for access (profiles.status via service role).
  if (args.action === 'approve' || args.action === 'reject') {
    const { affected } = await applyApprovalDecision({
      userId,
      status: args.action === 'approve' ? 'approved' : 'rejected',
      reason: args.reason,
      // A person (session / Telegram) has a profiles UUID; break-glass does not.
      approvedBy: args.actor.kind === 'session' || args.actor.kind === 'telegram' ? args.actor.id : undefined,
    })
    if (affected === 0) return { ok: false, reason: 'profile_not_found', userId }
  }

  // 3. Audit — never let an audit failure mask a successful write.
  try {
    await logAudit({
      entityType: 'request',
      entityId: args.requestId,
      action: args.action === 'approve' ? 'request.approved' : args.action === 'reject' ? 'request.rejected' : 'request.status_changed',
      performedBy: args.actor.id,
      diff: {
        action: args.action,
        status: requestStatus,
        userId,
        actorKind: args.actor.kind,
        ...(args.reason ? { reason: args.reason } : {}),
      },
      ipAddress: args.ipAddress,
    })
  } catch (auditErr) {
    console.error('[access-requests] audit failed:', auditErr)
  }

  if (args.action === 'approve') {
    const approvedUser = userId
    void import('@/lib/telegram/bots/expert/notify')
      .then((m) => m.notifyClientApprovedSafely(approvedUser))
      .catch(() => {})
  }

  return { ok: true, status: requestStatus, userId }
}
