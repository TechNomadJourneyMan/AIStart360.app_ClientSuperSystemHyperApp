export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase-service'
import { aggregatePointA } from '@/lib/point-a/aggregator'
import { resolveTenantWith, tenantErrorMessage, type TenantContext } from '@/lib/tenancy'
import { companyOwnerId } from '@/lib/metrics/materialize-tenant'
import { safeErrorMessage } from '@/lib/api-error'
import type { ApiResult, PointA } from '@/types/onboarding'

type Resolved = { ok: true; supabase: Awaited<ReturnType<typeof createClient>>; tenant: TenantContext } | { ok: false; res: NextResponse }

/**
 * Session + company of the request (lib/tenancy, read access; optional
 * ?companyId=). 404 { error: 'no_company' } is the client's empty state.
 */
async function resolve(req: Request): Promise<Resolved> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const companyId = new URL(req.url).searchParams.get('companyId')
  const tenant = await resolveTenantWith(supabase, user?.id ?? null, { companyId, access: 'read' })
  if (!tenant.ok) {
    const error = tenant.error === 'no_company' ? 'no_company' : tenantErrorMessage(tenant.error)
    const body: ApiResult<PointA> = { ok: false, error }
    return { ok: false, res: NextResponse.json(body, { status: tenant.status }) }
  }
  return { ok: true, supabase, tenant: tenant.tenant }
}

async function aggregate(req: Request, materialize: boolean): Promise<NextResponse> {
  const r = await resolve(req)
  if (!r.ok) return r.res
  try {
    // The questionnaire of the company's primary owner feeds Point A.
    const ownerId = (await companyOwnerId(r.supabase, r.tenant.companyId)) ?? r.tenant.userId
    const pointA = await aggregatePointA(r.supabase, ownerId, r.tenant.companyId, {
      skipMaterialize: !materialize,
      documentsScope: 'company',
      // Writes to public.metrics go through the service role after the
      // tenant check above (users have no write grant since migration 088).
      ...(materialize ? { writeClient: createServiceClient() } : {}),
    })
    const body: ApiResult<PointA> = { ok: true, data: pointA }
    return NextResponse.json(body)
  } catch (err) {
    console.error('[api/v1/point-a/aggregate]', err)
    const body: ApiResult<PointA> = { ok: false, error: safeErrorMessage(err, 'Не удалось собрать Точку А') }
    return NextResponse.json(body, { status: 500 })
  }
}

/**
 * GET /api/v1/point-a/aggregate — rule-based Point A + `intelligence`.
 * Does NOT re-materialize `public.metrics`.
 */
export async function GET(req: Request) {
  return aggregate(req, false)
}

/**
 * POST /api/v1/point-a/aggregate — same payload, and refreshes
 * `public.metrics` (after a document upload or a survey step).
 */
export async function POST(req: Request) {
  return aggregate(req, true)
}
