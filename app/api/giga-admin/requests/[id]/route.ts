export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase-service'
import { getGigaActor } from '@/lib/admin/giga-actor'
import { logAudit } from '@/lib/audit'
import { applyApprovalDecision } from '@/lib/users/approval'

/**
 * PATCH /api/giga-admin/requests/:id
 * Actions: approve | reject | archive
 *
 * The giga panel authenticates via a signed cookie and has NO Supabase auth
 * session, so `auth.uid()` is NULL and RLS would silently drop any write made
 * with the anon client (0 rows, no error). We therefore use a SERVICE-ROLE
 * client and VERIFY the profile row was actually updated before reporting
 * success — otherwise the UI shows "approved" while the DB stays pending.
 */
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const actor = await getGigaActor(req)
  if (!actor) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = (await req.json()) as { action: 'approve' | 'reject' | 'archive'; reason?: string }
  if (!['approve', 'reject', 'archive'].includes(body.action)) {
    return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
  }

  let sb
  try {
    sb = createServiceClient()
  } catch (e) {
    console.error('[giga-admin/requests/:id] service client unavailable:', e)
    return NextResponse.json(
      { error: 'Сервер не сконфигурирован для этой операции (нет service-role ключа)' },
      { status: 500 },
    )
  }

  const requestStatus = { approve: 'approved', reject: 'rejected', archive: 'archived' }[body.action]

  try {
    // 1. Resolve the target user id. If this id is a real admin_requests PK, read
    //    the row to get its userId. admin_requests is Prisma-owned → QUOTED
    //    camelCase columns ("userId", "rejectionReason", "updatedAt"); we must
    //    use those exact names, not snake_case, or the query errors.
    let userId: string | null = null

    const { data: arRow } = await sb
      .from('admin_requests')
      .select('userId, payload')
      .eq('id', params.id)
      .maybeSingle()

    if (arRow) {
      const payload = (arRow.payload as Record<string, unknown> | null) ?? {}
      userId =
        (arRow.userId as string | null) ??
        (typeof payload.userId === 'string' ? payload.userId : null)

      // Update the history row (best-effort; NOT the access-granting write).
      const { error: arErr } = await sb
        .from('admin_requests')
        .update({
          status: requestStatus,
          ...(body.action === 'reject' && body.reason ? { rejectionReason: body.reason } : {}),
          updatedAt: new Date().toISOString(),
        })
        .eq('id', params.id)
      if (arErr) {
        console.error('[giga-admin/requests/:id] admin_requests update warning:', arErr.message)
      }
    }

    // Fallback: the list route uses profile.id as the request id for orphaned
    // registrations, so params.id is itself the profile UUID.
    if (!userId) userId = params.id

    // 2. The access-granting write goes through the SINGLE SOURCE OF TRUTH
    //    (profiles.status via service role, affected-row check, user email). A
    //    0-row result is a hard failure — this was the original bug where the
    //    route returned { ok: true } while nothing changed. giga has no real
    //    admin uuid, so approved_by is left unset.
    if (body.action === 'approve' || body.action === 'reject') {
      const { affected } = await applyApprovalDecision({
        userId,
        status: body.action === 'approve' ? 'approved' : 'rejected',
        reason: body.reason,
        // Personal admin sessions carry a real profiles UUID → approved_by is
        // attributable; break-glass has no profile row, so it stays unset.
        approvedBy: actor.kind === 'session' ? actor.id : undefined,
      })
      if (affected === 0) {
        return NextResponse.json(
          { error: 'Профиль пользователя не найден — статус не изменён', userId },
          { status: 404 },
        )
      }
    }

    // 3. Audit the decision — never let an audit failure mask a successful write.
    try {
      await logAudit({
        entityType: 'request',
        entityId: params.id,
        action:
          body.action === 'approve'
            ? 'request.approved'
            : body.action === 'reject'
              ? 'request.rejected'
              : 'request.status_changed',
        performedBy: actor.id,
        diff: {
          action: body.action,
          status: requestStatus,
          userId,
          actorKind: actor.kind,
          ...(body.reason ? { reason: body.reason } : {}),
        },
        ipAddress: req.headers.get('x-forwarded-for') ?? undefined,
      })
    } catch (auditErr) {
      console.error('[giga-admin/requests/:id] audit failed:', auditErr)
    }

    return NextResponse.json({ ok: true, status: requestStatus, userId })
  } catch (error) {
    console.error('[giga-admin/requests/:id] PATCH error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
