export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { requireGiga } from '@/lib/admin/giga-actor'
import { createServiceClient } from '@/lib/supabase-service'
import { hasPermission } from '@/lib/admin/rbac'

// GET /api/giga-admin/overview?days=30 — platform state for the CRM home.
export async function GET(req: NextRequest) {
  const guard = await requireGiga(req, 'dashboard.view')
  if (guard.response) return guard.response
  const days = Math.min(180, Math.max(7, Number(req.nextUrl.searchParams.get('days')) || 30))
  const { data, error } = await createServiceClient().rpc('admin_overview', { p_days: days })
  if (error) return NextResponse.json({ ok: false, error: 'Не удалось собрать сводку' }, { status: 500 })
  const d = (data ?? {}) as Record<string, unknown>
  const role = guard.actor.role
  // Personal rows only for roles that may see people; admin actions only for auditors.
  if (!hasPermission(role, 'users.view')) d.recent_events = []
  if (!hasPermission(role, 'audit.view')) d.recent_admin_actions = []
  if (!hasPermission(role, 'analytics.view')) { d.top_pages = []; d.events_by_day = [] }
  if (!hasPermission(role, 'cjm.view')) d.funnel = null
  if (!hasPermission(role, 'gri.view')) d.gri = null
  return NextResponse.json({ ok: true, data: d })
}
