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

/**
 * Allowed values of the GIGA users-list filters (admin_list_users). One list
 * for the screen (/api/giga-admin/users), the CSV export and the audience of a
 * broadcast (lib/comm/audience.ts) — a broadcast «по фильтрам» reaches exactly
 * the people the list shows with the same filters. Survey / GRI progress are
 * segments (survey_* / gri_*).
 */
export const USER_LIST_SORTS = new Set(['created_at', 'last_seen_at', 'name', 'survey', 'survey_updated', 'gri'])
export const USER_LIST_SEGMENTS = new Set(['', 'new_7d', 'active_7d', 'inactive_30d', 'survey_not_started', 'survey_in_progress', 'survey_completed', 'gri_not_started', 'gri_in_progress', 'gri_completed', 'staff'])
export const USER_LIST_STATUSES = new Set(['', 'pending_approval', 'approved', 'rejected', 'requires_clarification', 'blocked', 'archived'])
export const USER_LIST_ROLES = new Set(['', 'client', 'expert', 'admin', 'super_admin', 'manager', 'analyst'])

export interface UserListFilters {
  q?: string | null
  segment?: string | null
  status?: string | null
  role?: string | null
  /** me | none | <uuid> | '' (see assigneeParam). */
  assignee?: string | null
}

/**
 * Filters → the filter arguments of admin_list_users (no paging / sort), the
 * same mapping as the list route; undefined — an invalid value (400).
 */
export function userListFilterArgs(f: UserListFilters, actorId: string): Record<string, unknown> | undefined {
  const segment = f.segment ?? ''
  const status = f.status ?? ''
  const role = f.role ?? ''
  if (!USER_LIST_SEGMENTS.has(segment) || !USER_LIST_STATUSES.has(status) || !USER_LIST_ROLES.has(role)) return undefined
  const assignee = assigneeParam(f.assignee ?? null, actorId)
  if (assignee === undefined) return undefined
  const search = (f.q ?? '').trim().slice(0, 100)
  return {
    ...(assignee ? { p_assignee: assignee } : {}),
    p_search: search || null,
    p_status: status || null,
    p_role: role || null,
    p_segment: segment || null,
  }
}
