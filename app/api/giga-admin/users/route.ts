export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { requireGiga } from '@/lib/admin/giga-actor'
import { createServiceClient } from '@/lib/supabase-service'
import { hasPermission } from '@/lib/admin/rbac'
import { maskEmail, maskPhone } from '@/lib/admin/mask'
import { scopedClientIds } from '@/lib/admin/client-scope'
import { scanAdminListUsers, type AdminListRow } from '@/lib/admin/list-users'

// GET /api/giga-admin/users — server-side search / filters / segments / sort /
// pagination over all accounts (SQL admin_list_users, migration 073).
const SORTS = new Set(['created_at', 'last_seen_at', 'name', 'survey', 'survey_updated', 'gri'])
const SEGMENTS = new Set(['', 'new_7d', 'active_7d', 'inactive_30d', 'survey_not_started', 'survey_in_progress', 'survey_completed', 'gri_not_started', 'gri_in_progress', 'gri_completed', 'staff'])
const STATUSES = new Set(['', 'pending_approval', 'approved', 'rejected', 'requires_clarification', 'blocked', 'archived'])
const ROLES = new Set(['', 'client', 'expert', 'owner', 'admin', 'super_admin', 'manager', 'analyst'])

type ListRow = AdminListRow

export async function GET(req: NextRequest) {
  const guard = await requireGiga(req, 'users.view')
  if (guard.response) return guard.response
  const sp = req.nextUrl.searchParams
  const pageSize = Math.min(100, Math.max(5, Number(sp.get('pageSize')) || 25))
  const page = Math.max(1, Number(sp.get('page')) || 1)
  const sort = SORTS.has(sp.get('sort') ?? '') ? sp.get('sort')! : 'created_at'
  const dir = sp.get('dir') === 'asc' ? 'asc' : 'desc'
  const segment = sp.get('segment') ?? ''
  const status = sp.get('status') ?? ''
  const role = sp.get('role') ?? ''
  if (!SEGMENTS.has(segment) || !STATUSES.has(status) || !ROLES.has(role)) {
    return NextResponse.json({ ok: false, error: 'Неверный фильтр' }, { status: 400 })
  }
  const search = (sp.get('q') ?? '').trim().slice(0, 100)

  const args = {
    p_search: search || null,
    p_status: status || null,
    p_role: role || null,
    p_segment: segment || null,
    p_sort: sort,
    p_dir: dir,
  }
  const sb = createServiceClient()
  const allowed = await scopedClientIds(guard.actor)

  let rows: ListRow[]
  let total: number
  if (!allowed) {
    const { data, error } = await sb.rpc('admin_list_users', { ...args, p_limit: pageSize, p_offset: (page - 1) * pageSize })
    if (error) return NextResponse.json({ ok: false, error: 'Не удалось загрузить пользователей' }, { status: 500 })
    rows = (data ?? []) as ListRow[]
    total = rows.length ? Number(rows[0].total_count) : 0
  } else {
    // Эксперт видит только назначенных ему клиентов. admin_list_users не умеет
    // фильтровать по списку id (и переопределять её мы не хотим), поэтому
    // проходим отсортированную выдачу страницами по 200 и оставляем своих —
    // порядок, фильтры и поиск остаются серверными, total считается честно.
    const scoped = await scanAdminListUsers(sb, args, { allowed, maxRows: 10000 })
    if (!scoped) return NextResponse.json({ ok: false, error: 'Не удалось загрузить пользователей' }, { status: 500 })
    total = scoped.length
    rows = scoped.slice((page - 1) * pageSize, page * pageSize)
  }

  const sensitive = hasPermission(guard.actor.role, 'users.sensitive')
  return NextResponse.json({
    ok: true,
    data: rows.map(({ total_count: _t, ...r }) => ({
      ...r,
      email: sensitive ? r.email : maskEmail(r.email as string | null),
      phone: sensitive ? r.phone : maskPhone(r.phone as string | null),
      gri_index: r.gri_index == null ? null : Number(r.gri_index),
      diag_score: r.diag_score == null ? null : Number(r.diag_score),
    })),
    total,
    page,
    pageSize,
  })
}
