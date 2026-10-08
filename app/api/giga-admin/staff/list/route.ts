export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { requireGiga } from '@/lib/admin/giga-actor'
import { createServiceClient } from '@/lib/supabase-service'
import { STAFF_ROLE_LABELS, isStaffRole } from '@/lib/admin/rbac'

/**
 * GET /api/giga-admin/staff/list — короткий справочник сотрудников.
 *
 * Полный /api/giga-admin/staff отдаёт матрицу прав и виден только тем, кто
 * управляет ролями. Но чтобы назначить ответственного за клиента, достаточно
 * знать имена — поэтому отдельный маршрут с правом users.view и без единого
 * лишнего поля.
 */
export async function GET(req: NextRequest) {
  const guard = await requireGiga(req, 'users.view')
  if (guard.response) return guard.response

  const sb = createServiceClient()
  // client_scope (миграция 086) — чтобы в выборе ответственного было видно,
  // кто работает только со своими клиентами. Без миграции — прежний набор полей.
  let { data: roles, error } = await sb.from('staff_roles').select('user_id, role, client_scope')
  if (error) ({ data: roles, error } = await sb.from('staff_roles').select('user_id, role'))
  if (error) return NextResponse.json({ ok: false, error: 'Не удалось загрузить сотрудников' }, { status: 500 })

  const ids = (roles ?? []).map((r) => r.user_id as string)
  const { data: people } = ids.length
    ? await sb.from('profiles').select('id, full_name, email, status').in('id', ids)
    : { data: [] as Array<{ id: string; full_name: string | null; email: string | null; status: string }> }
  const byId = new Map((people ?? []).map((p) => [p.id, p]))

  const staff = (roles ?? [])
    .map((r) => {
      const person = byId.get(r.user_id as string)
      const role = isStaffRole(r.role) ? r.role : null
      if (!person || person.status !== 'approved' || !role) return null
      return {
        id: person.id,
        name: person.full_name || person.email || person.id,
        email: person.email,
        role,
        roleLabel: STAFF_ROLE_LABELS[role],
        clientScope: (r as { client_scope?: string | null }).client_scope === 'assigned' ? 'assigned' as const : 'all' as const,
      }
    })
    .filter((x): x is NonNullable<typeof x> => !!x)
    .sort((a, b) => a.name.localeCompare(b.name, 'ru'))

  return NextResponse.json({ ok: true, data: staff })
}
