import { createServiceClient } from '@/lib/supabase-service'
import { logAudit } from '@/lib/audit'
import { applyApprovalDecision } from '@/lib/users/approval'
import type { GigaActor } from '@/lib/admin/giga-actor'

/**
 * Решение по заявке на доступ (approve | reject | archive) — общий код для
 * PATCH /api/giga-admin/requests/:id и массового POST /requests/bulk.
 *
 * id — либо PK строки admin_requests, либо (для «осиротевших» регистраций)
 * сам UUID профиля. Доступ выдаёт ТОЛЬКО applyApprovalDecision (единый
 * источник правды profiles.status, проверка затронутых строк). Вызывающий
 * отвечает за авторизацию.
 */

export type RequestAction = 'approve' | 'reject' | 'archive'

export type RequestDecisionResult =
  | { ok: true; status: string; userId: string }
  | { ok: false; httpStatus: number; error: string; userId?: string }

export async function decideRequest(
  actor: Pick<GigaActor, 'id' | 'kind'>,
  id: string,
  action: RequestAction,
  reason: string | undefined,
  req?: Request | null,
): Promise<RequestDecisionResult> {
  let sb: ReturnType<typeof createServiceClient>
  try {
    sb = createServiceClient()
  } catch (e) {
    console.error('[requests/decide] service client unavailable:', e)
    return { ok: false, httpStatus: 500, error: 'Сервер не сконфигурирован для этой операции (нет service-role ключа)' }
  }

  const requestStatus = { approve: 'approved', reject: 'rejected', archive: 'archived' }[action]

  // 1. Resolve the target user id. admin_requests is Prisma-owned → QUOTED
  //    camelCase columns ("userId", "rejectionReason", "updatedAt").
  let userId: string | null = null
  const { data: arRow } = await sb
    .from('admin_requests')
    .select('userId, payload')
    .eq('id', id)
    .maybeSingle()

  if (arRow) {
    const payload = (arRow.payload as Record<string, unknown> | null) ?? {}
    userId =
      (arRow.userId as string | null) ??
      (typeof payload.userId === 'string' ? payload.userId : null)

    // History row (best-effort; NOT the access-granting write).
    const { error: arErr } = await sb
      .from('admin_requests')
      .update({
        status: requestStatus,
        ...(action === 'reject' && reason ? { rejectionReason: reason } : {}),
        updatedAt: new Date().toISOString(),
      })
      .eq('id', id)
    if (arErr) console.error('[requests/decide] admin_requests update warning:', arErr.message)
  }

  // Orphaned registrations: the list uses profile.id as the request id.
  if (!userId) userId = id

  // 2. The access-granting write — a 0-row result is a hard failure.
  if (action === 'approve' || action === 'reject') {
    const { affected } = await applyApprovalDecision({
      userId,
      status: action === 'approve' ? 'approved' : 'rejected',
      reason,
      approvedBy: actor.kind === 'session' ? actor.id : undefined,
    })
    if (affected === 0) {
      return { ok: false, httpStatus: 404, error: 'Профиль пользователя не найден — статус не изменён', userId }
    }
  }

  // 3. Audit — never let an audit failure mask a successful write.
  try {
    await logAudit({
      entityType: 'request',
      entityId: id,
      action: action === 'approve' ? 'request.approved' : action === 'reject' ? 'request.rejected' : 'request.status_changed',
      performedBy: actor.id,
      diff: {
        action,
        status: requestStatus,
        userId,
        actorKind: actor.kind,
        ...(reason ? { reason } : {}),
      },
      ipAddress: req?.headers.get('x-forwarded-for') ?? undefined,
    })
  } catch (auditErr) {
    console.error('[requests/decide] audit failed:', auditErr)
  }

  return { ok: true, status: requestStatus, userId }
}
