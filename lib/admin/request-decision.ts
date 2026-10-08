import { createServiceClient } from '@/lib/supabase-service'
import { decideAccessRequest, type AccessAction } from '@/lib/users/access-requests'
import type { GigaActor } from '@/lib/admin/giga-actor'

/**
 * Решение по заявке на доступ (approve | reject | archive) для HTTP-маршрутов
 * PATCH /api/giga-admin/requests/:id и массового POST /requests/bulk.
 *
 * Тонкая обёртка: вся логика (admin_requests, profiles.status через
 * applyApprovalDecision, проверка затронутых строк, аудит, уведомления
 * экспертам) живёт в ЕДИНОМ источнике правды lib/users/access-requests.ts
 * (decideAccessRequest) — его же вызывает админский Telegram-бот. Здесь только
 * service-role клиент и HTTP-форма результата. Вызывающий отвечает за
 * авторизацию.
 */

export type RequestAction = AccessAction

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

  const res = await decideAccessRequest(sb, {
    requestId: id,
    action,
    reason,
    actor: { id: actor.id, kind: actor.kind },
    ipAddress: req?.headers.get('x-forwarded-for') ?? undefined,
  })
  if (!res.ok) {
    return { ok: false, httpStatus: 404, error: 'Профиль пользователя не найден — статус не изменён', userId: res.userId }
  }
  return { ok: true, status: res.status, userId: res.userId }
}
