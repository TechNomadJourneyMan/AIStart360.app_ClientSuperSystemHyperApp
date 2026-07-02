import { cache } from 'react'
import { NextResponse } from 'next/server'
import type { UserRole } from '@prisma/client'
import { createClient } from '@/lib/supabase/server'

// ─── Permission definitions ───────────────────────────────────────────────────

export type Permission =
  | 'requests:read'
  | 'requests:write'      // create / update
  | 'requests:approve'    // approve or reject
  | 'requests:assign'     // assign to admin
  | 'requests:bulk'       // bulk operations
  | 'users:read'
  | 'users:write'         // block / unblock / edit
  | 'roles:manage'        // change roles
  | 'companies:read'
  | 'companies:write'
  | 'audit:read'
  | 'analytics:read'
  | 'comments:write'

// ─── RBAC matrix ─────────────────────────────────────────────────────────────

const ROLE_PERMISSIONS: Record<UserRole, Permission[]> = {
  SUPER_ADMIN: [
    'requests:read', 'requests:write', 'requests:approve', 'requests:assign', 'requests:bulk',
    'users:read', 'users:write', 'roles:manage',
    'companies:read', 'companies:write',
    'audit:read', 'analytics:read', 'comments:write',
  ],
  ADMIN: [
    'requests:read', 'requests:write', 'requests:approve', 'requests:assign', 'requests:bulk',
    'users:read', 'users:write',
    'companies:read', 'companies:write',
    'analytics:read', 'comments:write',
  ],
  MANAGER: [
    'requests:read', 'requests:assign',
    'users:read',
    'companies:read',
    'comments:write',
  ],
  ANALYST: [
    'requests:read',
    'companies:read',
    'analytics:read',
  ],
  CLIENT: [],
}

// ─── SLA deadlines by priority (hours) ───────────────────────────────────────

export const SLA_HOURS: Record<string, number> = {
  critical: 2,
  high: 8,
  medium: 24,
  low: 72,
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function hasPermission(role: UserRole | string, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role as UserRole]?.includes(permission) ?? false
}

export function canApproveRequests(role: UserRole | string): boolean {
  return hasPermission(role, 'requests:approve')
}

export function canManageUsers(role: UserRole | string): boolean {
  return hasPermission(role, 'users:write')
}

// ─── Server-side auth guard (for API routes) ─────────────────────────────────

export interface AuthSession {
  user: {
    id: string
    email: string
    name?: string | null
    role: UserRole
  }
}

function mapProfileRoleToUserRole(role: string | null | undefined): UserRole {
  if (role === 'super_admin') return 'SUPER_ADMIN'
  if (role === 'admin') return 'ADMIN'
  if (role === 'manager' || role === 'expert') return 'MANAGER'
  if (role === 'analyst') return 'ANALYST'
  // 'owner' (команда AIStart360) is NOT a platform super-admin — it has its own
  // /owner/* area and is excluded from /api/v1/admin by supabase-admin-guard.
  // Previously owner→SUPER_ADMIN, which let a self-registered "Команда" account
  // reach every /api/admin/* permission. It gets no admin permissions here.
  return 'CLIENT'
}

// Statuses that must NOT grant elevated (non-CLIENT) access. Self-registration
// always starts 'pending_approval' — an admin must approve before any power.
const NON_APPROVED_STATUSES = new Set([
  'pending_approval', 'pending', 'blocked', 'rejected', 'suspended', 'banned',
])

// Wrapped in React `cache()` so multiple guards/components in the SAME request
// (requireAuth → requirePermission, plus any RSC that needs the session) share
// ONE getUser()+profiles round-trip instead of re-hitting Supabase each time.
export const getAdminSession = cache(async (): Promise<AuthSession | null> => {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user?.id || !user.email) return null

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, full_name, status')
    .eq('id', user.id)
    .maybeSingle()

  const mappedRole = mapProfileRoleToUserRole(typeof profile?.role === 'string' ? profile.role : null)
  const status = typeof profile?.status === 'string' ? profile.status : null

  // Defense-in-depth: an un-approved account never carries elevated permissions,
  // whatever its role claims. Closes self-register → instant admin escalation.
  const role: UserRole =
    mappedRole !== 'CLIENT' && status && NON_APPROVED_STATUSES.has(status) ? 'CLIENT' : mappedRole

  return {
    user: {
      id: user.id,
      email: user.email,
      name: typeof profile?.full_name === 'string' ? profile.full_name : null,
      role,
    },
  }
})

/**
 * Require authentication. Returns 401 response or the session.
 */
export async function requireAuth(): Promise<
  { session: AuthSession; error: null } | { session: null; error: NextResponse }
> {
  const session = await getAdminSession()
  if (!session) {
    return { session: null, error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  }
  return { session, error: null }
}

/**
 * Require a specific permission. Returns 401/403 response or the session.
 */
export async function requirePermission(permission: Permission): Promise<
  { session: AuthSession; error: null } | { session: null; error: NextResponse }
> {
  const { session, error } = await requireAuth()
  if (error || !session) {
    return { session: null, error: error ?? NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  }
  if (!hasPermission(session.user.role, permission)) {
    return {
      session: null,
      error: NextResponse.json(
        { error: 'Forbidden', required: permission, yourRole: session.user.role },
        { status: 403 },
      ),
    }
  }
  return { session, error: null }
}
