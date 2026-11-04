/**
 * lib/admin/purge-user.ts — полное удаление пользователя (общая часть для
 * POST /api/giga-admin/users/:id/purge и массового действия 'purge').
 *
 * Порядок неизменен и важен:
 *   1. предпросмотр admin_purge_user(p_dry_run: true) — заодно проверка,
 *      что миграция 083 применена;
 *   2. ОБЯЗАТЕЛЬНАЯ запись 'user.purged' в журнал со снимком ключевых полей —
 *      если журнал не записался, recordAdminAction бросает исключение и
 *      удаления не будет;
 *   3. admin_purge_user(p_dry_run: false) — одна транзакция в БД; при ошибке —
 *      компенсирующая запись 'user.purge_failed' (журнал append-only);
 *   4. файлы Storage — только после успешной транзакции, пачками по 100.
 */
import type { createServiceClient } from '@/lib/supabase-service'
import { recordAdminAction } from '@/lib/admin/audit'
import type { GigaActor } from '@/lib/admin/giga-actor'

type Svc = ReturnType<typeof createServiceClient>

export interface PurgeRpcResult {
  found: boolean
  counts?: Record<string, number>
  storage?: Array<{ bucket: string; name: string }>
}

export interface PurgeTargetInfo {
  staffRole: string | null
  profileRole: string | null
  status: string | null
  email: string | null
}

/** Причина, по которой человека удалять нельзя (или null). */
export function purgeTargetBlock(actorId: string, userId: string, target: PurgeTargetInfo | null | undefined): string | null {
  if (userId === actorId) return 'Нельзя удалить себя'
  if (!target || !target.profileRole) return 'Пользователь не найден'
  if (target.profileRole === 'super_admin' || target.staffRole === 'super_admin') return 'Super Admin удалить нельзя — сначала снимите роль'
  return null
}

/** Предпросмотр: сколько чего будет удалено. */
export async function previewPurge(sb: Svc, userId: string): Promise<{ ok: true; counts: Record<string, number> } | { ok: false; error: string }> {
  const { data, error } = await sb.rpc('admin_purge_user', { p_user_id: userId, p_dry_run: true })
  if (error) {
    console.error('[purge] preview failed:', error.message)
    return { ok: false, error: error.message }
  }
  return { ok: true, counts: (data as PurgeRpcResult | null)?.counts ?? {} }
}

/** Стереть файлы из Storage пачками по 100. Возвращает число неудалённых. */
export async function removeStorageObjects(sb: Svc, objects: PurgeRpcResult['storage']): Promise<number> {
  const byBucket = new Map<string, string[]>()
  for (const o of objects ?? []) byBucket.set(o.bucket, [...(byBucket.get(o.bucket) ?? []), o.name])
  let failed = 0
  for (const [bucket, names] of Array.from(byBucket)) {
    for (let i = 0; i < names.length; i += 100) {
      const chunk = names.slice(i, i + 100)
      const { error } = await sb.storage.from(bucket).remove(chunk)
      if (error) {
        failed += chunk.length
        console.error(`[purge] storage remove failed in ${bucket}:`, error.message)
      }
    }
  }
  return failed
}

export type PurgeOutcome =
  | { ok: true; counts: Record<string, number>; filesFailed: number }
  | { ok: false; stage: 'preview' | 'purge'; error: string }

/**
 * Удалить пользователя. Права, подтверждение и ограничения частоты проверяет
 * вызывающий. Если обязательная запись в журнал не легла — бросает исключение
 * (удаления не было).
 */
export async function purgeUser(sb: Svc, actor: GigaActor, input: {
  userId: string
  target: PurgeTargetInfo
  reason: string
  req?: Request | null
  metadata?: Record<string, unknown>
}): Promise<PurgeOutcome> {
  const { userId, target, reason, req } = input
  const preview = await previewPurge(sb, userId)
  if (!preview.ok) return { ok: false, stage: 'preview', error: preview.error }

  const { data: profile } = await sb.from('profiles').select('full_name, organization, created_at').eq('id', userId).maybeSingle()

  // Журнал ДО удаления: если запись не легла — удаления не будет (исключение).
  await recordAdminAction(actor, {
    action: 'user.purged',
    entityType: 'user', entityId: userId, targetUserId: userId,
    oldValue: { email: target.email, role: target.profileRole, staffRole: target.staffRole, status: target.status, ...(profile ?? {}) },
    newValue: null,
    metadata: { reason, counts: preview.counts, ...(input.metadata ?? {}) },
  }, req ?? null, { required: true })

  const { data, error } = await sb.rpc('admin_purge_user', { p_user_id: userId, p_dry_run: false })
  if (error) {
    console.error('[purge] failed:', error.message)
    // The journal is append-only and already says «purged» — record that it did not happen.
    await recordAdminAction(actor, {
      action: 'user.purge_failed',
      entityType: 'user', entityId: userId, targetUserId: userId,
      metadata: { reason, error: error.message.slice(0, 300), ...(input.metadata ?? {}) },
    }, req ?? null).catch(() => false)
    return { ok: false, stage: 'purge', error: error.message }
  }
  const result = (data ?? {}) as PurgeRpcResult

  // Файлы — после успешной транзакции: осиротевший файл лучше, чем пользователь без файлов.
  const filesFailed = await removeStorageObjects(sb, result.storage)
  return { ok: true, counts: result.counts ?? {}, filesFailed }
}
