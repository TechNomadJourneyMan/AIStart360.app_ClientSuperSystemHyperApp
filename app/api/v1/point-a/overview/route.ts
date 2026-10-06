// GET /api/v1/point-a/overview?companyId=<optional>
//
// Point A executive overview (contract: types/point-a-overview.ts).
// The company is resolved and authorised by lib/tenancy (read access); every
// input is read with the caller's own session client, so RLS decides what is
// visible. 404 { ok:false, error:'no_company' } lets the UI render the
// «компания ещё не создана» empty state instead of an error.

export const dynamic = 'force-dynamic'

import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { resolveTenantWith, tenantErrorMessage } from '@/lib/tenancy'
import { loadPointAOverview } from '@/lib/point-a/overview'
import { apiError, safeErrorMessage } from '@/lib/api-error'
import type { PointAOverviewResponse } from '@/types/point-a-overview'

export async function GET(req: NextRequest) {
  try {
    const companyId = req.nextUrl.searchParams.get('companyId')
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    const resolved = await resolveTenantWith(supabase, user?.id ?? null, { companyId, access: 'read' })
    if (!resolved.ok) {
      if (resolved.error === 'no_company') {
        return apiError('no_company', 404, { message: tenantErrorMessage('no_company') })
      }
      return apiError(tenantErrorMessage(resolved.error), resolved.status)
    }

    const data = await loadPointAOverview(supabase, resolved.tenant)
    const body: PointAOverviewResponse = { ok: true, data }
    return NextResponse.json(body)
  } catch (err) {
    console.error('[api/v1/point-a/overview]', err)
    return apiError(safeErrorMessage(err, 'Не удалось собрать обзор Точки А'), 500)
  }
}
