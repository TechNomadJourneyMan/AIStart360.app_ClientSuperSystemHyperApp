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
import { canManageTarget, isStaffRole, targetRoleOf, type StaffRole } from '@/lib/admin/rbac'

export type AccessAction = 'approve' | 'reject' | 'archive'

export type AccessDecisionResult =
  | { ok: true; status: 'approved' | 'rejected' | 'archived'; userId: string }
  | { ok: false; reason: 'profile_not_found' | 'forbidden' | 'invalid_transition'; userId: string }

/**
 * Valid transitions of profiles.status for a decision on a request (R-007),
 * the same as the bulk route (lib/admin/bulk-users.ts): access is opened only
 * to an applicant (pending / clarification / previously rejected) and refused
 * only to someone still waiting. Blocked / archived accounts are handled by
 * block / unblock / archive (users.manage, users.archive), never here.
 */
export const APPROVABLE_STATUSES: ReadonlySet<string> = new Set(['pending_approval', 'requires_clarification', 'rejected'])
export const REJECTABLE_STATUSES: ReadonlySet<string> = new Set(['pending_approval', 'requires_clarification'])

type Sb = SupabaseClient | { from: SupabaseClient['from'] }

interface Person { role: string | null; status: string | null; staffRole: StaffRole | null }

async function readPerson(sb: Sb, userId: string): Promise<Person | null> {
  const [{ data: profile, error }, { data: staff, error: staffError }] = await Promise.all([
    sb.from('profiles').select('role, status').eq('id', userId).maybeSingle(),
    sb.from('staff_roles').select('role').eq('user_id', userId).maybeSingle(),
  ])
  if (error || staffError) throw new Error('access-requests: person unavailable')
  if (!profile) return null
  const p = profile as { role?: string | null; status?: string | null }
  const r = (staff as { role?: string } | null)?.role
  return { role: p.role ?? null, status: p.status ?? null, staffRole: isStaffRole(r) ? r : null }
}

/** Staff role of the deciding person: given by the GIGA route, else read (Telegram). Approved only. */
async function actorRole(sb: Sb, actor: { id: string; role?: StaffRole }): Promise<StaffRole | null> {
  if (actor.role) return actor.role
  const me = await readPerson(sb, actor.id)
  if (!me || me.status !== 'approved') return null
  if (me.role === 'super_admin') return 'super_admin'
  return me.staffRole
}

export async function decideAccessRequest(
  sb: SupabaseClient | { from: SupabaseClient['from'] },
  args: {
    requestId: string
    action: AccessAction
    reason?: string
    /** `role`: the actor's staff role when the caller already resolved it (GIGA routes). */
    actor: { id: string; kind: string; role?: StaffRole }
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
  }

  // Orphaned registration: the request id is the profile UUID.
  if (!userId) userId = args.requestId

  // 2. Who may decide on whom, and from which status (R-007). Checked BEFORE
  //    any write — also for a real admin_requests row, not only the fallback.
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userId)) {
    return { ok: false, reason: 'profile_not_found', userId }
  }
  const target = await readPerson(sb, userId)
  if (!target) return { ok: false, reason: 'profile_not_found', userId }
  const role = await actorRole(sb, args.actor)
  if (!role || args.actor.id === userId) return { ok: false, reason: 'forbidden', userId }
  // A staff / expert / legacy-staff account is not an applicant: only a
  // super_admin decides on it, and only within canManageTarget.
  const targetIsStaff = targetRoleOf({ staffRole: target.staffRole, profileRole: target.role }) !== null
  if ((targetIsStaff && role !== 'super_admin') || !canManageTarget(role, { staffRole: target.staffRole, profileRole: target.role })) {
    return { ok: false, reason: 'forbidden', userId }
  }
  let alreadyDone = false
  if (args.action === 'approve' || args.action === 'reject') {
    const next = args.action === 'approve' ? 'approved' : 'rejected'
    const allowed = args.action === 'approve' ? APPROVABLE_STATUSES : REJECTABLE_STATUSES
    if (target.status === next) alreadyDone = true
    else if (!allowed.has(target.status ?? '')) return { ok: false, reason: 'invalid_transition', userId }
  }

  if (arRow) {
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

  // A repeated decision changes nothing (and sends no second e-mail).
  if (alreadyDone) return { ok: true, status: requestStatus, userId }

  // 3. The single source of truth for access (profiles.status via service role).
  if (args.action === 'approve' || args.action === 'reject') {
    const { affected } = await applyApprovalDecision({
      userId,
      status: args.action === 'approve' ? 'approved' : 'rejected',
      reason: args.reason,
      // A person (session / Telegram) has a profiles UUID.
      approvedBy: args.actor.kind === 'session' || args.actor.kind === 'telegram' ? args.actor.id : undefined,
    })
    if (affected === 0) return { ok: false, reason: 'profile_not_found', userId }
  }

  // 4. Audit — never let an audit failure mask a successful write.
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
    void import('@/lib/whatsapp/experts')
      .then((m) => m.notifyClientApprovedWhatsAppSafely(approvedUser))
      .catch(() => {})
  }

  return { ok: true, status: requestStatus, userId }
}
