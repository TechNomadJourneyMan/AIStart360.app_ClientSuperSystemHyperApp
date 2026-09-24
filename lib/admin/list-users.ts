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
