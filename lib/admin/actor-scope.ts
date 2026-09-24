import { createServiceClient } from '@/lib/supabase-service'
import type { GigaActor } from '@/lib/admin/giga-actor'

/**
 * Какие клиенты видны сотруднику в очередях пакета «Операции администратора»
 * (эскалации, сводка для бейджа в меню).
 *
 * Видимость задаёт `staff_roles.client_scope` ('all' | 'assigned', миграция
 * 086): при 'assigned' сотрудник работает только с клиентами, где он
 * ответственный (`user_assignments.assignee_id`). Super Admin и Admin всегда
 * видят всех. Если актор уже несёт `clientScope` (его выставляет guard
 * параллельного пакета), берём его и не ходим в базу второй раз; если колонки
 * ещё нет (миграция не применена) — считаем 'all', как было до неё.
 */

export type ClientScope = 'all' | 'assigned'

export interface ActorClientScope {
  scope: ClientScope
  /** Клиенты, за которых отвечает актор; заполнено только при scope = 'assigned'. */
  clientIds: string[]
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function normalizeClientScope(v: unknown): ClientScope {
  return v === 'assigned' ? 'assigned' : 'all'
}

export async function readClientScope(actor: Pick<GigaActor, 'id' | 'role'> & { clientScope?: unknown }): Promise<ClientScope> {
  if (actor.role === 'super_admin' || actor.role === 'admin') return 'all'
  if (actor.clientScope !== undefined) return normalizeClientScope(actor.clientScope)
  if (!UUID_RE.test(actor.id)) return 'all'
  try {
    const { data, error } = await createServiceClient()
      .from('staff_roles')
      .select('client_scope')
      .eq('user_id', actor.id)
      .maybeSingle()
    if (error) return 'all'
    return normalizeClientScope((data as { client_scope?: unknown } | null)?.client_scope)
  } catch {
    return 'all'
  }
}

export async function actorClientScope(actor: Pick<GigaActor, 'id' | 'role'> & { clientScope?: unknown }): Promise<ActorClientScope> {
  const scope = await readClientScope(actor)
  if (scope === 'all') return { scope, clientIds: [] }
  const { data } = await createServiceClient()
    .from('user_assignments')
    .select('user_id')
    .eq('assignee_id', actor.id)
    .limit(5000)
  return { scope, clientIds: ((data ?? []) as Array<{ user_id: string }>).map((r) => r.user_id) }
}

/** Может ли актор с таким скоупом работать с клиентом `userId`. */
export function scopeAllows(s: ActorClientScope, userId: string): boolean {
  return s.scope === 'all' || s.clientIds.includes(userId)
}
