/**
 * Which clients the person behind the bot may see (the GIGA rule of
 * lib/admin/client-scope.ts / lib/admin/rbac.ts effectiveClientScope):
 *
 *   'all'       every client (default; super_admin, admin, crm_manager always);
 *   'assigned'  only clients whose `user_assignments.assignee_id` is the
 *               person — staff_roles.client_scope = 'assigned' (086).
 *
 * The assistant applies it to every tool: a tool naming a client outside the
 * scope gets «Клиент вам не назначен», lists are filtered by company.
 * Reading the scope column fails open to 'all' like the panel
 * (lib/admin/actor-scope.ts); reading the assignments fails CLOSED (none).
 */
import { prisma } from '@/lib/db'
import { effectiveClientScope, isStaffRole } from '@/lib/admin/rbac'

export type BrainScope =
  | { kind: 'all' }
  | { kind: 'assigned'; userIds: ReadonlySet<string>; companyIds: ReadonlySet<string> }

export const ALL_CLIENTS: BrainScope = { kind: 'all' }
export const NOT_ASSIGNED = 'Клиент вам не назначен'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function loadBrainScope(userId: string): Promise<BrainScope> {
  if (!UUID_RE.test(userId)) return ALL_CLIENTS
  let raw: unknown = null
  let role: unknown = null
  try {
    const rows = await prisma.$queryRaw<Array<{ role: string; client_scope: string | null }>>`
      SELECT role, client_scope FROM public.staff_roles WHERE user_id = ${userId}::uuid`
    role = rows[0]?.role ?? null
    raw = rows[0]?.client_scope ?? null
  } catch {
    return ALL_CLIENTS
  }
  if (!isStaffRole(role) || effectiveClientScope(role, raw) === 'all') return ALL_CLIENTS
  try {
    const rows = await prisma.$queryRaw<Array<{ user_id: string; company_id: string | null }>>`
      SELECT a.user_id::text, c.id AS company_id
      FROM public.user_assignments a LEFT JOIN public.companies c ON c.user_id = a.user_id
      WHERE a.assignee_id = ${userId}::uuid
      LIMIT 5000`
    return {
      kind: 'assigned',
      userIds: new Set(rows.map((r) => r.user_id)),
      companyIds: new Set(rows.map((r) => r.company_id).filter((x): x is string => Boolean(x))),
    }
  } catch {
    return { kind: 'assigned', userIds: new Set(), companyIds: new Set() }
  }
}

export function userAllowed(scope: BrainScope, userId: string | null | undefined): boolean {
  return scope.kind === 'all' || (!!userId && scope.userIds.has(userId))
}

export function companyAllowed(scope: BrainScope, companyId: string | null | undefined): boolean {
  return scope.kind === 'all' || (!!companyId && scope.companyIds.has(companyId))
}

/**
 * Drop rows of clients outside the scope from a tool result: arrays under
 * `items` / `rows` whose elements carry `company_id`, `owner.user_id`,
 * `user_id` (client) or — for spend grouped by company — `key`. Rows without
 * any client reference (platform tasks) stay.
 */
export function filterResultByScope(scope: BrainScope, result: Record<string, unknown>, opts: { keyIsCompany?: boolean } = {}): Record<string, unknown> {
  if (scope.kind === 'all') return result
  const keep = (row: unknown): boolean => {
    if (!row || typeof row !== 'object') return true
    const r = row as Record<string, unknown>
    if (typeof r.company_id === 'string') return scope.companyIds.has(r.company_id)
    const owner = r.owner as { user_id?: unknown } | null | undefined
    if (owner && typeof owner.user_id === 'string') return scope.userIds.has(owner.user_id)
    if (typeof r.client_user_id === 'string') return scope.userIds.has(r.client_user_id)
    if (typeof r.user_id === 'string') return scope.userIds.has(r.user_id)
    if (opts.keyIsCompany && typeof r.key === 'string') return scope.companyIds.has(r.key)
    return true
  }
  const out: Record<string, unknown> = { ...result }
  for (const k of ['items', 'rows']) {
    const v = out[k]
    if (Array.isArray(v)) {
      const kept = v.filter(keep)
      out[k] = kept
      if (kept.length !== v.length) out.filtered_by_scope = true
    }
  }
  return out
}
