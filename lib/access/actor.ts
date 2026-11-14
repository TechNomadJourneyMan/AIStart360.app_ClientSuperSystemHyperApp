/**
 * lib/access/actor.ts — ONE server-side decision «who is the caller and whose
 * client data may they touch», for code that runs with the service role
 * (RLS does not apply there, so the code must apply the same rule itself).
 *
 * The rule is the one of migration 140 (supabase/migrations/
 * 140_staff_rls_from_staff_roles.sql), so a route under the service role
 * cannot give more than PostgREST under the caller's own JWT would:
 *
 *   • staff         — a `staff_roles` row of a profile with status 'approved'
 *                     (current_staff_role()). The legacy `profiles.role`
 *                     admin / super_admin / manager / analyst WITHOUT a
 *                     staff_roles row is NOT staff (it is a client here).
 *   • expert        — profiles.role = 'expert' with status 'approved'
 *                     (is_active_expert()). A pending / rejected / blocked /
 *                     archived expert is nobody: no client data at all.
 *   • client scope  — like can_read_company() / staff_can_read_company():
 *       'all'      super_admin / admin / crm_manager always; super_expert /
 *                  support when staff_roles.client_scope = 'all'
 *                  (staff_sees_all_clients());
 *       'assigned' other staff holding users.sensitive and active experts —
 *                  only clients whose user_assignments.assignee_id is the
 *                  caller (staff_assigned_user_ids());
 *       'none'     everybody else (clients, analysts, content managers):
 *                  only their own data.
 *     Keep the role lists in sync with lib/admin/rbac.ts (users.sensitive,
 *     effectiveClientScope) — the same sync rule as migration 140.
 *
 * Company members and partner experts read a company through RLS
 * (can_read_company under their own session); this module decides only the
 * owner / staff / expert paths that service-role code takes.
 *
 * Reads go through plain PostgREST fetches with the service key (no SDK
 * client, no next/headers): lib/api-identity.ts loads this module with
 * `await import()` and is itself imported by a client component, so it must
 * stay client-compilable. Every read failure fails CLOSED: resolveActor
 * returns null ('unavailable'), the access checks answer false.
 */
import { effectiveClientScope, hasPermission, isStaffRole, type StaffRole } from '@/lib/admin/rbac'

export type ActorKind = 'client' | 'expert' | 'staff'
export type ActorClientScope = 'all' | 'assigned' | 'none'

export interface AccessActor {
  id: string
  kind: ActorKind
  /** profiles.role as stored — cabinet routing only, never an authorization source on its own. */
  profileRole: string | null
  status: string | null
  approved: boolean
  /** staff_roles.role, only while the profile is approved. */
  staffRole: StaffRole | null
  /** profiles.role = 'expert' and approved (is_active_expert()). */
  activeExpert: boolean
  clientScope: ActorClientScope
}

export interface ActorRows {
  profile: { role?: string | null; status?: string | null } | null
  staff: { role?: string | null; client_scope?: string | null } | null
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID_RE.test(v)

/** The rule of migration 140 over the two rows of a person (pure; tested directly). */
export function actorFromRows(id: string, rows: ActorRows): AccessActor {
  const profileRole = rows.profile?.role ?? null
  const status = rows.profile?.status ?? null
  const approved = status === 'approved'
  const rawStaff = rows.staff?.role
  const staffRole: StaffRole | null = approved && isStaffRole(rawStaff) ? rawStaff : null
  const activeExpert = approved && profileRole === 'expert'
  const sensitive = !!staffRole && hasPermission(staffRole, 'users.sensitive')
  const clientScope: ActorClientScope = sensitive
    ? effectiveClientScope(staffRole as StaffRole, rows.staff?.client_scope)
    : activeExpert
      ? 'assigned'
      : 'none'
  const kind: ActorKind = staffRole ? 'staff' : activeExpert ? 'expert' : 'client'
  return { id, kind, profileRole, status, approved, staffRole, activeExpert, clientScope }
}

/** Not staff and not an active expert: may act on their own data only. */
export function isPlainClient(a: AccessActor): boolean {
  return a.kind === 'client'
}

/**
 * Who is admitted to the expert portal API (/api/expert/*): an active expert,
 * or a staff Admin / Super Admin (staff_roles — the legacy profile roles
 * admin / super_admin no longer count).
 */
export function isExpertPortalActor(a: AccessActor): boolean {
  return a.activeExpert || a.staffRole === 'admin' || a.staffRole === 'super_admin'
}

/** Role label of an expert-portal actor: the staff admin role, else 'expert'. */
export function expertPortalRole(a: AccessActor): 'expert' | 'admin' | 'super_admin' {
  return a.staffRole === 'admin' || a.staffRole === 'super_admin' ? a.staffRole : 'expert'
}

// ─── Service-role reads (PostgREST) ─────────────────────────────────────────

async function rest(path: string): Promise<unknown[] | null> {
  const url = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').replace(/\/+$/, '')
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
  if (!url || !key) return null
  try {
    const res = await fetch(`${url}/rest/v1/${path}`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
      cache: 'no-store',
    })
    if (!res.ok) return null
    const rows = (await res.json()) as unknown
    return Array.isArray(rows) ? rows : null
  } catch {
    return null
  }
}

/** The caller per migration 140, or null when the rows cannot be read (fail closed). */
export async function resolveActor(userId: string): Promise<AccessActor | null> {
  if (!userId) return null
  const id = encodeURIComponent(userId)
  const [profiles, staff] = await Promise.all([
    rest(`profiles?id=eq.${id}&select=role,status&limit=1`),
    // '*' rather than a column list: client_scope arrives with migration 086
    // (the same tolerance as lib/admin/giga-actor.ts staffRoleOf).
    rest(`staff_roles?user_id=eq.${id}&select=*&limit=1`),
  ])
  if (profiles === null || staff === null) return null
  return actorFromRows(userId, {
    profile: (profiles[0] as ActorRows['profile']) ?? null,
    staff: (staff[0] as ActorRows['staff']) ?? null,
  })
}

/** Is `clientUserId` assigned to `assigneeId` (user_assignments)? false on any error. */
export async function isAssignedTo(assigneeId: string, clientUserId: string): Promise<boolean> {
  if (!assigneeId || !isUuid(clientUserId)) return false
  const rows = await rest(
    `user_assignments?user_id=eq.${encodeURIComponent(clientUserId)}&assignee_id=eq.${encodeURIComponent(assigneeId)}&select=user_id&limit=1`,
  )
  return !!rows && rows.length > 0
}

/** May the actor read / act on the data of client `clientUserId`? (self — always.) */
export async function canAccessClient(actor: AccessActor, clientUserId: string): Promise<boolean> {
  if (!clientUserId) return false
  if (clientUserId.toLowerCase() === actor.id.toLowerCase()) return true
  if (actor.clientScope === 'all') return true
  if (actor.clientScope === 'none') return false
  return isAssignedTo(actor.id, clientUserId)
}

const COMPANY_ID_RE = /^[A-Za-z0-9_-]{1,64}$/

/** Owner (companies.user_id): undefined — no such company; null — no owner; throws when unreadable. */
export async function companyOwnerOf(companyId: string): Promise<string | null | undefined> {
  if (!COMPANY_ID_RE.test(companyId)) return undefined
  const rows = await rest(`companies?id=eq.${encodeURIComponent(companyId)}&select=user_id&limit=1`)
  if (rows === null) throw new Error('company owner unavailable')
  if (!rows[0]) return undefined
  return ((rows[0] as { user_id?: string | null }).user_id ?? null) || null
}

/**
 * May the actor read company `companyId` on the owner / staff / expert path
 * (staff_can_read_company + ownership)? A company without an owner is visible
 * only with scope 'all'. false on any error.
 */
export async function canAccessCompany(actor: AccessActor, companyId: string): Promise<boolean> {
  if (!COMPANY_ID_RE.test(companyId)) return false
  if (actor.clientScope === 'all') return true
  let owner: string | null | undefined
  try {
    owner = await companyOwnerOf(companyId)
  } catch {
    return false
  }
  if (!owner) return false
  return canAccessClient(actor, owner)
}

/**
 * Clients the actor may list: { all: true }, or the explicit ids (assigned
 * clients; [] for 'none'). null when the assignments cannot be read.
 */
export async function visibleClientIds(actor: AccessActor): Promise<{ all: true } | { ids: string[] } | null> {
  if (actor.clientScope === 'all') return { all: true }
  if (actor.clientScope === 'none') return { ids: [] }
  const out: string[] = []
  for (let offset = 0; ; offset += 1000) {
    const rows = await rest(
      `user_assignments?assignee_id=eq.${encodeURIComponent(actor.id)}&select=user_id&order=user_id.asc&limit=1000&offset=${offset}`,
    )
    if (rows === null) return null
    for (const r of rows as Array<{ user_id?: string }>) if (r.user_id) out.push(r.user_id)
    if (rows.length < 1000) return { ids: out }
  }
}

// ─── Telegram / notification audiences (SR-17) ──────────────────────────────

/**
 * Who the expert Telegram bot admits (the same people as the bot-link API,
 * lib/expert-auth.ts resolveExpertBotUser): an expert-portal actor, or a
 * staff SuperExpert. Never the legacy profile role admin / super_admin alone.
 */
export function isExpertBotActor(a: AccessActor): boolean {
  return isExpertPortalActor(a) || a.staffRole === 'super_expert'
}

/** Role label of an expert-bot actor: the staff role admin / super_admin / super_expert, else 'expert'. */
export function expertBotRoleOf(a: AccessActor): 'expert' | 'admin' | 'super_admin' | 'super_expert' {
  return a.staffRole === 'super_expert' ? 'super_expert' : expertPortalRole(a)
}

/**
 * Pure check over rows already read: may `a` see the client `clientUserId`
 * whose assignee (user_assignments.assignee_id) is `assigneeId`? Scope 'all'
 * — any client; 'assigned' — only when the actor is the assignee; 'none' —
 * nobody else's client. An unknown client (null) is visible with 'all' only.
 */
export function actorReachesClient(
  a: AccessActor,
  clientUserId: string | null | undefined,
  assigneeId: string | null | undefined,
): boolean {
  if (a.clientScope === 'all') return true
  if (!clientUserId) return false
  if (clientUserId.toLowerCase() === a.id.toLowerCase()) return true
  if (a.clientScope === 'none') return false
  return !!assigneeId && assigneeId.toLowerCase() === a.id.toLowerCase()
}
