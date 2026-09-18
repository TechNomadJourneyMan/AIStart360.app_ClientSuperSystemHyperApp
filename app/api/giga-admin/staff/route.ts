export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { requireGiga } from '@/lib/admin/giga-actor'
import { createServiceClient } from '@/lib/supabase-service'
import { PERMISSIONS, ROLE_PERMISSIONS, STAFF_ROLE_LABELS, STAFF_ROLES, grantableRoles } from '@/lib/admin/rbac'

// GET /api/giga-admin/staff — staff list + the permission matrix (as enforced).
export async function GET(req: NextRequest) {
  const guard = await requireGiga(req, 'dashboard.view')
  if (guard.response) return guard.response
  const matrix = STAFF_ROLES.map((r) => ({ role: r, label: STAFF_ROLE_LABELS[r], permissions: Array.from(ROLE_PERMISSIONS[r]) }))
  const base = { matrix, permissions: PERMISSIONS, grantable: grantableRoles(guard.actor.role), me: { role: guard.actor.role } }
  if (!guard.actor.permissions.includes('roles.manage')) return NextResponse.json({ ok: true, data: { ...base, staff: null } })

  const sb = createServiceClient()
  const { data: rows, error } = await sb.from('staff_roles').select('user_id, role, granted_by, granted_at, updated_at').order('granted_at', { ascending: true })
  if (error) return NextResponse.json({ ok: false, error: 'Не удалось загрузить сотрудников' }, { status: 500 })
  const ids = (rows ?? []).map((r) => r.user_id)
  const { data: people } = ids.length
    ? await sb.from('profiles').select('id, email, full_name, status, last_seen_at').in('id', ids)
    : { data: [] as Array<{ id: string; email: string; full_name: string | null; status: string; last_seen_at: string | null }> }
  const byId = new Map((people ?? []).map((p) => [p.id, p]))
  return NextResponse.json({ ok: true, data: { ...base, staff: (rows ?? []).map((r) => ({ ...r, person: byId.get(r.user_id) ?? null })) } })
}
