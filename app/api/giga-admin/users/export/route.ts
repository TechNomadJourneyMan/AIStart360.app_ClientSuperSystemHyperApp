export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { requireGiga } from '@/lib/admin/giga-actor'
import { createServiceClient } from '@/lib/supabase-service'
import { hasPermission } from '@/lib/admin/rbac'
import { maskEmail, maskPhone } from '@/lib/admin/mask'
import { csvFilename, csvResponse, toCsv } from '@/lib/admin/csv'
import { SURVEY_TOTAL_STEPS } from '@/lib/survey/steps'
import { scopedClientIds } from '@/lib/admin/client-scope'
import { scanAdminListUsers } from '@/lib/admin/list-users'

/**
 * GET /api/giga-admin/users/export?<те же фильтры, что и в списке>
 *
 * Выгружает ровно то, что сотрудник видит в списке с текущими фильтрами —
 * не «всю базу». Раньше за любой выгрузкой шли к разработчику.
 *
 * Контакты маскируются тем же правилом, что и в списке: у роли без доступа к
 * личным данным выгрузка не должна становиться обходным путём.
 */

const SORTS = new Set(['created_at', 'last_seen_at', 'name', 'survey', 'survey_updated', 'gri'])
const SEGMENTS = new Set(['', 'new_7d', 'active_7d', 'inactive_30d', 'survey_not_started', 'survey_in_progress', 'survey_completed', 'gri_not_started', 'gri_in_progress', 'gri_completed', 'staff'])
const STATUSES = new Set(['', 'pending_approval', 'approved', 'rejected', 'requires_clarification', 'blocked', 'archived'])
const ROLES = new Set(['', 'client', 'expert', 'owner', 'admin', 'super_admin', 'manager', 'analyst'])
const MAX_ROWS = 5000

const fmt = (v: unknown) => (v ? new Date(String(v)).toLocaleString('ru-RU') : '')

export async function GET(req: NextRequest) {
  const guard = await requireGiga(req, 'users.view')
  if (guard.response) return guard.response
  const sp = req.nextUrl.searchParams
  const sort = SORTS.has(sp.get('sort') ?? '') ? sp.get('sort')! : 'created_at'
  const segment = sp.get('segment') ?? ''
  const status = sp.get('status') ?? ''
  const role = sp.get('role') ?? ''
  if (!SEGMENTS.has(segment) || !STATUSES.has(status) || !ROLES.has(role)) {
    return NextResponse.json({ ok: false, error: 'Неверный фильтр' }, { status: 400 })
  }

  // Выгрузка честно проходит все страницы: admin_list_users отдаёт не больше
  // 200 строк за вызов. Эксперт со scope 'assigned' выгружает только своих.
  const data = await scanAdminListUsers(createServiceClient(), {
    p_search: (sp.get('q') ?? '').trim().slice(0, 100) || null,
    p_status: status || null,
    p_role: role || null,
    p_segment: segment || null,
    p_sort: sort,
    p_dir: sp.get('dir') === 'asc' ? 'asc' : 'desc',
  }, { allowed: await scopedClientIds(guard.actor), maxRows: MAX_ROWS })
  if (!data) return NextResponse.json({ ok: false, error: 'Не удалось выгрузить' }, { status: 500 })

  const sensitive = hasPermission(guard.actor.role, 'users.sensitive')
  const rows = data as Array<Record<string, unknown>>

  const headers = [
    'Компания', 'Имя', 'Email', 'Телефон', 'Статус', 'Роль', 'Роль персонала', 'Тариф',
    'Шагов анкеты', 'Незаполненные шаги', 'Анкета обновлена',
    'GRI', 'Прохождений GRI', 'Точка А', 'Регистрация', 'Последняя активность', 'ID',
  ]

  const body = toCsv(headers, rows.map((r) => {
    const filled = new Set((r.survey_filled_steps as number[] | null) ?? [])
    const missing = Array.from({ length: SURVEY_TOTAL_STEPS }, (_, i) => i + 1).filter((n) => !filled.has(n))
    return [
      r.company_name ?? r.organization ?? '',
      r.full_name ?? '',
      sensitive ? r.email ?? '' : maskEmail(r.email as string | null),
      sensitive ? r.phone ?? '' : maskPhone(r.phone as string | null),
      r.status ?? '', r.role ?? '', r.staff_role ?? '', r.tier ?? '',
      r.survey_steps ?? 0,
      missing.join(' '),
      fmt(r.survey_updated_at),
      r.gri_index ?? '', r.gri_runs ?? 0,
      r.diag_score == null ? '' : Math.round(Number(r.diag_score)),
      fmt(r.created_at), fmt(r.last_seen_at),
      r.id ?? '',
    ]
  }))

  return csvResponse(body, csvFilename('aistart360-users'))
}
