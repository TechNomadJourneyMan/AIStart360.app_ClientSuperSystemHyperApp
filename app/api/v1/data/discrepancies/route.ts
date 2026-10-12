// ============================================================
// GET /api/v1/data/discrepancies[?companyId=&status=open|all]
//
// Data discrepancies of the caller's company (migration 110,
// lib/data-layer/reconcile.ts): values of one period that disagree between
// sources, implausible values, anomalies. Read with the caller's session —
// RLS (can_read_company) scopes the rows. Before migration 110 the list is
// empty with `migrated: false`.
// ============================================================
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { resolveTenantWith, tenantErrorMessage } from '@/lib/tenancy'
import { apiError } from '@/lib/api-error'
import { getMetricById } from '@/lib/metrics/registry'
import { periodLabel } from '@/lib/data-layer/period-key'

export const dynamic = 'force-dynamic'

export async function GET(req: Request): Promise<NextResponse> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return apiError(tenantErrorMessage('unauthenticated'), 401)

  const url = new URL(req.url)
  const tenant = await resolveTenantWith(supabase, user.id, { companyId: url.searchParams.get('companyId'), access: 'read' })
  if (!tenant.ok) return apiError(tenantErrorMessage(tenant.error), tenant.status)

  let q = supabase
    .from('data_discrepancies')
    .select('id, metric_key, period_key, kind, candidates, chosen_value, detail, status, resolved_by, resolution_value, resolution_note, created_at, resolved_at')
    .eq('company_id', tenant.tenant.companyId)
    .order('created_at', { ascending: false })
    .limit(200)
  if (url.searchParams.get('status') !== 'all') q = q.eq('status', 'open')
  const { data, error } = await q
  if (error) {
    if (error.code === '42P01' || error.code === 'PGRST205') return NextResponse.json({ ok: true, data: { items: [], migrated: false } })
    console.error('[api/v1/data/discrepancies] read failed', error.code)
    return apiError('Не удалось загрузить расхождения', 500)
  }
  const items = ((data ?? []) as Array<Record<string, unknown>>).map((r) => ({
    ...r,
    metric_label: getMetricById(String(r.metric_key))?.label ?? r.metric_key,
    period_label: periodLabel(String(r.period_key)),
  }))
  return NextResponse.json({ ok: true, data: { items, migrated: true } })
}
