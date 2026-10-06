// GET /api/v1/reports?companyId=<optional>
//
// Published report versions of the caller's company (Point A today). The
// company is resolved and authorised by lib/tenancy; rows are read with the
// caller's own session client, so RLS decides visibility (tenants see only
// status 'published'), and the query asks for 'published' explicitly as well.
// Returns summaries; the full frozen snapshot is GET /api/v1/reports/:id.

export const dynamic = 'force-dynamic'

import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { resolveTenantWith, tenantErrorMessage } from '@/lib/tenancy'
import { apiError, dbError, safeErrorMessage } from '@/lib/api-error'
import { CLIENT_REPORT_COLUMNS, summarize, toClientReport } from '@/lib/reports/client-access'

export async function GET(req: NextRequest) {
  try {
    const companyId = req.nextUrl.searchParams.get('companyId')
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    const resolved = await resolveTenantWith(supabase, user?.id ?? null, { companyId, access: 'read' })
    if (!resolved.ok) {
      if (resolved.error === 'no_company') return apiError('no_company', 404, { message: tenantErrorMessage('no_company') })
      return apiError(tenantErrorMessage(resolved.error), resolved.status)
    }

    const { data, error } = await supabase
      .from('report_versions')
      .select(CLIENT_REPORT_COLUMNS)
      .eq('company_id', resolved.tenant.companyId)
      .eq('status', 'published')
      .order('published_at', { ascending: false })
      .limit(20)
    if (error) return dbError('api/v1/reports', error, 'Не удалось загрузить отчёты')

    const items = ((data ?? []) as Array<Record<string, unknown>>).map((r) => summarize(toClientReport(r)))
    return NextResponse.json({ ok: true, data: { companyId: resolved.tenant.companyId, items } })
  } catch (err) {
    console.error('[api/v1/reports]', err)
    return apiError(safeErrorMessage(err, 'Не удалось загрузить отчёты'), 500)
  }
}
