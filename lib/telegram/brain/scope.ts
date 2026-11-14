/**
 * Which clients the person behind the bot may see — the rule of migration 140
 * (lib/access/actor.ts) with the GIGA scope for staff (lib/admin/rbac.ts
 * effectiveClientScope):
 *
 *   'all'       every client: staff super_admin / admin / crm_manager always,
 *               other staff unless staff_roles.client_scope = 'assigned' (086);
 *   'assigned'  only clients whose `user_assignments.assignee_id` is the
 *               person — staff limited to assigned clients and every active
 *               expert (profiles.role 'expert', approved; SR-17). Anyone else
 *               (not approved, a legacy profiles.role admin / super_admin
 *               without staff_roles, a client) gets an EMPTY assigned scope.
 *
 * The assistant and the bots apply it to every tool and screen: a client
 * outside the scope gets «Клиент вам не назначен», lists are filtered by
 * company. Every read error fails CLOSED (empty scope) — SR-08.
 */
import { prisma } from '@/lib/db'
import { actorFromRows } from '@/lib/access/actor'
import { effectiveClientScope } from '@/lib/admin/rbac'

export type BrainScope =
  | { kind: 'all' }
  | { kind: 'assigned'; userIds: ReadonlySet<string>; companyIds: ReadonlySet<string> }

export const ALL_CLIENTS: BrainScope = { kind: 'all' }
/** Nobody's clients (fail-closed value). */
export const NO_CLIENTS: BrainScope = { kind: 'assigned', userIds: new Set(), companyIds: new Set() }
export const NOT_ASSIGNED = 'Клиент вам не назначен'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** 'all' | 'assigned' | 'none' of a person (rows of profiles + staff_roles), per the rule above. */
export function botClientScopeOf(
  userId: string,
  rows: { role: string | null; status: string | null; staff_role: string | null; client_scope: string | null } | null | undefined,
): 'all' | 'assigned' | 'none' {
  if (!rows) return 'none'
  const actor = actorFromRows(userId, {
    profile: { role: rows.role, status: rows.status },
    staff: rows.staff_role ? { role: rows.staff_role, client_scope: rows.client_scope } : null,
  })
  if (actor.staffRole) return effectiveClientScope(actor.staffRole, rows.client_scope)
  return actor.activeExpert ? 'assigned' : 'none'
}

/** Clients assigned to `assigneeId` (user_assignments) with their companies; NO_CLIENTS on any error. */
export async function assignedScope(assigneeId: string): Promise<BrainScope> {
  if (!UUID_RE.test(assigneeId)) return NO_CLIENTS
  try {
    const rows = await prisma.$queryRaw<Array<{ user_id: string; company_id: string | null }>>`
      SELECT a.user_id::text, c.id AS company_id
      FROM public.user_assignments a LEFT JOIN public.companies c ON c.user_id = a.user_id
      WHERE a.assignee_id = ${assigneeId}::uuid
      LIMIT 5000`
    return {
      kind: 'assigned',
      userIds: new Set(rows.map((r) => r.user_id)),
      companyIds: new Set(rows.map((r) => r.company_id).filter((x): x is string => Boolean(x))),
    }
  } catch {
    return NO_CLIENTS
  }
}

/** The scope of a person whose client scope is already known (bot principals). */
export function scopeFor(userId: string, clientScope: 'all' | 'assigned' | 'none' | null | undefined): Promise<BrainScope> {
  if (clientScope === 'all') return Promise.resolve(ALL_CLIENTS)
  if (clientScope === 'assigned') return assignedScope(userId)
  return Promise.resolve(NO_CLIENTS)
}

export async function loadBrainScope(userId: string): Promise<BrainScope> {
  if (!UUID_RE.test(userId)) return NO_CLIENTS
  let rows: Array<{ role: string | null; status: string | null; staff_role: string | null; client_scope: string | null }>
  try {
    rows = await prisma.$queryRaw<typeof rows>`
      SELECT p.role, p.status, s.role AS staff_role, s.client_scope
      FROM public.profiles p LEFT JOIN public.staff_roles s ON s.user_id = p.id
      WHERE p.id = ${userId}::uuid`
  } catch {
    return NO_CLIENTS
  }
  return scopeFor(userId, botClientScopeOf(userId, rows[0]))
}

/** Company ids of an assigned scope for SQL filters; null = every company. */
export function scopeCompanyIds(scope: BrainScope): string[] | null {
  return scope.kind === 'all' ? null : Array.from(scope.companyIds)
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
