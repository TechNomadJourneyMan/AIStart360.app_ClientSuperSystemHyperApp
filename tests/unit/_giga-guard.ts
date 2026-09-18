/**
 * Test double for `requireGiga`: route tests mock `getGigaActor` (and sometimes
 * `isGigaSuperAdmin`); this keeps them meaningful after routes moved to
 * permission checks. Actors without a role are treated as super_admin, and the
 * REAL RBAC matrix decides access.
 */
import { NextResponse } from 'next/server'
import { hasPermission, permissionsFor, type Permission, type StaffRole } from '@/lib/admin/rbac'

type ActorLike = { id: string; kind: string; role?: StaffRole; email?: string } | null

export function makeRequireGiga(getActor: () => Promise<ActorLike> | ActorLike, isSuper?: () => Promise<boolean> | boolean) {
  return async (_req: unknown, permission: Permission | Permission[]) => {
    if (isSuper && !(await isSuper())) return { response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
    const a = await getActor()
    if (!a) return { response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
    const role: StaffRole = a.role ?? 'super_admin'
    const needed = Array.isArray(permission) ? permission : [permission]
    if (needed.some((p) => !hasPermission(role, p))) return { response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
    return { actor: { ...a, role, permissions: permissionsFor(role) } }
  }
}
