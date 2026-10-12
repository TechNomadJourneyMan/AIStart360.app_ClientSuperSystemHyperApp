// ============================================================
// GET /api/v1/point-a/state[?companyId=] — the Point A page in one read
// (lib/point-a/v4/state.ts): latest snapshot + history, open discrepancies,
// goals, GRI, benchmarks, data sources, recalculation status. Read with the
// caller's session (RLS); the recalculation queue with the service role after
// the tenant check. No snapshot yet → a recalculation is queued.
// ============================================================
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase-service'
import { resolveTenantWith, tenantErrorMessage } from '@/lib/tenancy'
import { apiError } from '@/lib/api-error'
import { loadPointAState } from '@/lib/point-a/v4/state'
import { requestPointARecalc } from '@/lib/point-a/recalc-queue'

export const dynamic = 'force-dynamic'

export async function GET(req: Request): Promise<NextResponse> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return apiError(tenantErrorMessage('unauthenticated'), 401)
  const tenant = await resolveTenantWith(supabase, user.id, { companyId: new URL(req.url).searchParams.get('companyId'), access: 'read' })
  if (!tenant.ok) return apiError(tenantErrorMessage(tenant.error), tenant.status)
  try {
    const state = await loadPointAState(supabase, createServiceClient(), tenant.tenant.companyId)
    if (!state.snapshot && state.recalculation === 'idle' && state.sources.survey.completed > 0) {
      if (await requestPointARecalc(tenant.tenant.companyId, 'first_view', 0)) state.recalculation = 'queued'
    }
    return NextResponse.json({ ok: true, data: { ...state, companyId: tenant.tenant.companyId, canManage: tenant.tenant.canManage, role: tenant.tenant.role } })
  } catch (err) {
    console.error('[api/v1/point-a/state] read failed', err instanceof Error ? err.message : err)
    return apiError('Не удалось загрузить Точку А', 500)
  }
}
