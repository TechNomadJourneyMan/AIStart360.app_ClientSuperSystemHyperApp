/**
 * lib/mcp/principal.ts — who is behind an MCP credential, re-read on EVERY
 * call (and on every OAuth token refresh), so revoking a staff role, blocking
 * or archiving an account takes effect immediately.
 *
 * Same rules as the panel (lib/admin/giga-actor.ts staffRoleOf) and the expert
 * portal (lib/expert-auth.ts resolveExpert):
 *   - only an APPROVED profile gets anything;
 *   - staff: the staff_roles row only (migration 140 — a legacy
 *     profiles.role super_admin / admin without staff_roles is NOT staff,
 *     SR-05); staff are governed ONLY by RBAC (a staff member is never
 *     treated as an expert);
 *   - expert: a non-staff profile whose role is in EXPERT_PROFILE_ROLES
 *     ('expert');
 *   - client scope (lib/mcp/data.ts filters every client read by it): staff —
 *     the panel's effectiveClientScope (staff_roles.client_scope; super_admin
 *     / admin / crm_manager always 'all'); an expert — only the clients
 *     assigned to them (user_assignments), like /api/expert/* and RLS 140.
 * A failed read throws — callers fail closed (503), never «no access».
 */
import { prisma } from '@/lib/db'
import { effectiveClientScope, isStaffRole } from '@/lib/admin/rbac'
import { allowedScopes, EXPERT_PROFILE_ROLES, type McpRole, type McpScope } from './scopes'

export interface McpPrincipal {
  userId: string
  email: string | null
  role: McpRole
  /** Scopes the current role allows (before intersecting with a credential). */
  allowed: McpScope[]
  /** Which clients: every client, or only those assigned to `userId`. */
  clientScope: McpClientScope
}

export type McpClientScope = 'all' | 'assigned'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

interface Row { email: string | null; profile_role: string | null; status: string | null; staff_role: string | null; client_scope?: string | null }

export function roleFromRow(r: Row | undefined | null): McpRole | null {
  if (!r || r.status !== 'approved') return null
  if (isStaffRole(r.staff_role)) return { kind: 'staff', staffRole: r.staff_role }
  if (r.profile_role && EXPERT_PROFILE_ROLES.has(r.profile_role)) return { kind: 'expert', profileRole: r.profile_role }
  return null
}

/** Client scope of a resolved role (see the header). */
export function clientScopeOf(role: McpRole, r: Row | undefined | null): McpClientScope {
  return role.kind === 'staff' ? effectiveClientScope(role.staffRole, r?.client_scope) : 'assigned'
}

export async function resolveMcpPrincipal(userId: string): Promise<McpPrincipal | null> {
  if (!UUID_RE.test(userId)) return null
  const rows = await prisma.$queryRaw<Row[]>`
    SELECT p.email, p.role AS profile_role, p.status, s.role AS staff_role, s.client_scope
    FROM public.profiles p
    LEFT JOIN public.staff_roles s ON s.user_id = p.id
    WHERE p.id = ${userId}::uuid`
  const role = roleFromRow(rows[0])
  if (!role) return null
  return { userId, email: rows[0]?.email ?? null, role, allowed: allowedScopes(role), clientScope: clientScopeOf(role, rows[0]) }
}

/** Short label of the role for audit rows and UI. */
export function roleLabel(role: McpRole): string {
  return role.kind === 'staff' ? role.staffRole : `expert:${role.profileRole}`
}

