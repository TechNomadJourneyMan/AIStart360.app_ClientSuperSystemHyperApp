/**
 * Helpers of the GIGA integration routes (/api/giga-admin/integrations/**).
 *
 * Permissions (lib/admin/rbac.ts, existing rights — no new permission):
 *   users.view    see every company's connections (status, errors; never a key)
 *   company.edit  connect / test / sync / disconnect a client's integration
 *                 («Данные компании клиента»: admin, super_admin, crm_manager,
 *                 super_expert). Every change is written to admin_audit_log
 *                 BEFORE it happens (required audit) — without a key in it.
 */
import { NextResponse } from 'next/server'
import { companyExists } from './store'

const COMPANY_ID = /^[A-Za-z0-9_-]{1,64}$/

export async function checkCompany(companyId: string): Promise<NextResponse | null> {
  if (!COMPANY_ID.test(companyId)) return NextResponse.json({ ok: false, error: 'Неверный идентификатор компании' }, { status: 400 })
  if (!(await companyExists(companyId))) return NextResponse.json({ ok: false, error: 'Компания не найдена' }, { status: 404 })
  return null
}

export function auditUnavailable(): NextResponse {
  return NextResponse.json({ ok: false, error: 'Журнал аудита недоступен — действие не выполнено' }, { status: 503 })
}
