import type { createServiceClient } from '@/lib/supabase-service'

/**
 * Постраничный обход `admin_list_users` (миграция 082).
 *
 * Функция ограничивает p_limit двумястами строками, а фильтровать по списку id
 * не умеет. Когда нужно больше строк (выгрузка) или только клиенты эксперта
 * со scope 'assigned', проходим отсортированную выдачу страницами — порядок,
 * поиск и фильтры остаются серверными.
 */

export type AdminListRow = Record<string, unknown> & { id: string; total_count: number | string }

export const ADMIN_LIST_PAGE = 200

export async function scanAdminListUsers(
  sb: ReturnType<typeof createServiceClient>,
  args: Record<string, unknown>,
  opts: { allowed?: string[] | null; maxRows: number },
): Promise<AdminListRow[] | null> {
  const want = opts.allowed ? new Set(opts.allowed) : null
  const out: AdminListRow[] = []
  if (want && !want.size) return out
  const maxPages = Math.ceil(Math.max(opts.maxRows, ADMIN_LIST_PAGE) / ADMIN_LIST_PAGE) + (want ? 100 : 0)
  for (let i = 0; i < maxPages; i++) {
    const { data, error } = await sb.rpc('admin_list_users', { ...args, p_limit: ADMIN_LIST_PAGE, p_offset: i * ADMIN_LIST_PAGE })
    if (error) return null
    const batch = (data ?? []) as AdminListRow[]
    for (const r of batch) if (!want || want.has(r.id)) out.push(r)
    if (batch.length < ADMIN_LIST_PAGE || out.length >= opts.maxRows || (want && out.length >= want.size)) break
  }
  return out.slice(0, opts.maxRows)
}

const ASSIGNEE_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
/** p_assignee of admin_list_users for «без ответственного» (migration 088). */
export const NO_ASSIGNEE = '00000000-0000-0000-0000-000000000000'

/**
 * ?assignee= me | none | <uuid> → p_assignee; '' → no filter (null);
 * undefined → an invalid value (400). Shared by the list and the CSV export,
 * so the file holds exactly the rows the screen shows.
 */
export function assigneeParam(raw: string | null, actorId: string): string | null | undefined {
  if (!raw) return null
  if (raw === 'me') return ASSIGNEE_UUID_RE.test(actorId) ? actorId : undefined
  if (raw === 'none') return NO_ASSIGNEE
  return ASSIGNEE_UUID_RE.test(raw) ? raw : undefined
}
