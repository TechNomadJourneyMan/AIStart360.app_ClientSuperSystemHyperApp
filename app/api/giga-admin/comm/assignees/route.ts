export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { STAFF_ROLE_LABELS, hasPermission, isStaffRole, type StaffRole } from '@/lib/admin/rbac'
import { commError, guardComm } from '@/lib/comm/admin'

/**
 * GET /api/giga-admin/comm/assignees — who can be made responsible for a
 * conversation: approved staff whose role sees the inbox (inbox.view).
 */
export async function GET(req: NextRequest) {
  const g = await guardComm(req, 'inbox.view')
  if (g.response) return g.response
  const [{ data: roles, error }, { data: supers }] = await Promise.all([
    g.sb.from('staff_roles').select('user_id, role'),
    g.sb.from('profiles').select('id').eq('role', 'super_admin').eq('status', 'approved'),
  ])
  if (error) return commError('Не удалось загрузить сотрудников', 500)

  const roleById = new Map<string, StaffRole>()
  for (const r of (roles ?? []) as Array<{ user_id: string; role: string }>) if (isStaffRole(r.role)) roleById.set(r.user_id, r.role)
  for (const s of (supers ?? []) as Array<{ id: string }>) roleById.set(s.id, 'super_admin')
  const ids = Array.from(roleById.entries()).filter(([, role]) => hasPermission(role, 'inbox.view')).map(([id]) => id)
  if (!ids.length) return NextResponse.json({ ok: true, data: [] })

  const { data: people } = await g.sb.from('profiles').select('id, full_name, email, status').in('id', ids)
  const data = ((people ?? []) as Array<{ id: string; full_name: string | null; email: string | null; status: string | null }>)
    .filter((p) => p.status === 'approved')
    .map((p) => {
      const role = roleById.get(p.id)!
      return { id: p.id, name: p.full_name?.trim() || p.email || p.id, role, roleLabel: STAFF_ROLE_LABELS[role], canAnswer: hasPermission(role, 'inbox.manage') }
    })
    .sort((a, b) => a.name.localeCompare(b.name, 'ru'))
  return NextResponse.json({ ok: true, data })
}
