import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase-service'
import type { ClientScope } from '@/lib/admin/rbac'

/**
 * Область видимости клиентов для сотрудника (F-008).
 *
 * По умолчанию эксперт видит всех клиентов. Администратор может переключить
 * конкретного эксперта в режим «только назначенные» (`staff_roles.client_scope
 * = 'assigned'`, миграция 086) — тогда ему доступны только клиенты, где он
 * ответственный (`user_assignments.assignee_id`).
 *
 * Проверка живёт на сервере: каждый маршрут с данными конкретного клиента
 * вызывает `guardClientAccess` сразу после `requireGiga`, а списки фильтруются
 * через `scopedClientIds`. Интерфейс лишь не показывает лишнего.
 */

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isUuid(v: unknown): v is string {
  return typeof v === 'string' && UUID_RE.test(v)
}

/** Минимум от GigaActor, нужный для проверки области видимости. */
export interface ScopedActor {
  id: string
  /** Отсутствует у старых тестовых двойников — трактуется как 'all'. */
  clientScope?: ClientScope
}

export const NOT_ASSIGNED_ERROR = 'Клиент вам не назначен'

/**
 * Заглушка для `.in('user_id', …)` при пустом списке назначенных: PostgREST
 * не принимает пустой `in.()`, а пустой список должен давать пустой ответ.
 */
export const NO_ID = '00000000-0000-0000-0000-000000000000'

/** Клиенты, где сотрудник — ответственный. */
export async function assignedClientIds(actorId: string): Promise<string[]> {
  if (!isUuid(actorId)) return []
  const { data, error } = await createServiceClient()
    .from('user_assignments')
    .select('user_id')
    .eq('assignee_id', actorId)
    .limit(10000)
  if (error) {
    // Ошибка чтения назначений не должна открывать всех клиентов.
    console.warn('[client-scope] assignments read failed:', error.message)
    return []
  }
  return ((data ?? []) as Array<{ user_id: string }>).map((r) => r.user_id)
}

/** null — ограничений нет (scope 'all'); иначе список доступных клиентов. */
export async function scopedClientIds(actor: ScopedActor): Promise<string[] | null> {
  if (actor.clientScope !== 'assigned') return null
  return assignedClientIds(actor.id)
}

/** Может ли сотрудник работать с этим клиентом с учётом своей области видимости. */
export async function canAccessClient(actor: ScopedActor, userId: string): Promise<boolean> {
  if (actor.clientScope !== 'assigned') return true
  if (!isUuid(userId) || !isUuid(actor.id)) return false
  const { data, error } = await createServiceClient()
    .from('user_assignments')
    .select('assignee_id')
    .eq('user_id', userId)
    .maybeSingle()
  if (error) return false
  return (data as { assignee_id?: string | null } | null)?.assignee_id === actor.id
}

/**
 * Общая проверка для маршрутов `/api/giga-admin/users/[id]/*`:
 *  - 400, если id не UUID;
 *  - 403 «Клиент вам не назначен», если клиент вне области видимости;
 *  - при `clientOnly` — 404, если аккаунт не клиент (экспертные действия —
 *    комментарии, Точка Б, кейсы — имеют смысл только для клиентов).
 * null — можно продолжать.
 */
export async function guardClientAccess(
  actor: ScopedActor,
  userId: string,
  opts: { clientOnly?: boolean } = {},
): Promise<NextResponse | null> {
  if (!isUuid(userId)) return NextResponse.json({ ok: false, error: 'invalid id' }, { status: 400 })
  if (!(await canAccessClient(actor, userId))) {
    return NextResponse.json({ ok: false, error: NOT_ASSIGNED_ERROR }, { status: 403 })
  }
  if (opts.clientOnly) {
    const sb = createServiceClient()
    const [{ data }, { data: staff }] = await Promise.all([
      sb.from('profiles').select('role').eq('id', userId).maybeSingle(),
      // У сотрудника profiles.role тоже бывает 'client' — отличает его строка в staff_roles.
      sb.from('staff_roles').select('user_id').eq('user_id', userId).maybeSingle(),
    ])
    const role = (data as { role?: string | null } | null)?.role
    if (!data) return NextResponse.json({ ok: false, error: 'Пользователь не найден' }, { status: 404 })
    if (role !== 'client' || staff) {
      return NextResponse.json({ ok: false, error: 'Доступно только для клиентов' }, { status: 404 })
    }
  }
  return null
}

/** Отфильтровать строки по области видимости (null — без ограничений). */
export function filterByScope<T>(rows: T[], allowed: string[] | null, key: (r: T) => string | null | undefined): T[] {
  if (!allowed) return rows
  const set = new Set(allowed)
  return rows.filter((r) => {
    const id = key(r)
    return !!id && set.has(id)
  })
}
