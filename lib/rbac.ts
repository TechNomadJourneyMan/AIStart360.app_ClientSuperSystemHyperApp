import { auth } from '@/lib/auth'
import { NextResponse } from 'next/server'
import type { UserRole } from '@prisma/client'

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

export async function getAdminSession(): Promise<AuthSession | null> {
  const session = await auth()
  if (!session?.user?.id) return null
  // @ts-ignore — role is injected in auth.ts session callback
  if (!session.user.role) return null
  return session as unknown as AuthSession
}

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
