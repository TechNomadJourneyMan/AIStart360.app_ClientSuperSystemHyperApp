// ============================================================
// app/api/v1/metrics/materialize/route.ts
// POST (or GET) /api/v1/metrics/materialize[?companyId=]
//
// Runs the registry resolver for the caller's company and upserts every
// resolvable value into `public.metrics`. The /metrics page calls this once
// on first mount (if every catalog value is empty).
//
// Authorisation: lib/tenancy (read access to the company). Inputs are read
// with the caller's session (RLS); the WRITE goes through the service role
// (lib/metrics/materialize-tenant.ts) — since migration 088 users cannot
// insert/update metrics themselves, so source / confidence / provenance
// cannot be forged from the browser.
// A failed write (upsert or stale-row cleanup) answers 500 { ok:false }.
// ============================================================

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase-service'
import { resolveTenantWith, tenantErrorMessage } from '@/lib/tenancy'
import { materializeForTenant } from '@/lib/metrics/materialize-tenant'
import { apiError, safeErrorMessage } from '@/lib/api-error'

export const dynamic = 'force-dynamic'

interface OkBody {
  ok: true
  data: {
    written: number
    total: number
    skipped: number
    errors: Array<{ metricId: string; error: string }>
  }
}

async function run(req: Request): Promise<NextResponse> {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return apiError(tenantErrorMessage('unauthenticated'), 401)

  const companyId = new URL(req.url).searchParams.get('companyId')
  const tenant = await resolveTenantWith(supabase, user.id, { companyId, access: 'read' })
  if (!tenant.ok) {
    // No company yet: soft signal, the client renders its empty state (200 as before).
    if (tenant.error === 'no_company' && !companyId) return NextResponse.json({ ok: false, error: 'no_company' }, { status: 200 })
    return apiError(tenant.error === 'no_company' ? 'no_company' : tenantErrorMessage(tenant.error), tenant.status, {
      message: tenantErrorMessage(tenant.error),
    })
  }

  try {
    const { result } = await materializeForTenant(supabase, createServiceClient(), tenant.tenant)
    const errors = result.errors.map((e) => ({ metricId: e.metricId, error: safeErrorMessage(new Error(e.error), 'Ошибка записи метрик') }))
    if (errors.length > 0) {
      // A failed write is an error, not «no values yet»: with ok:true the
      // client refetched an empty catalog and asked the user to fill the survey.
      console.error('[api/v1/metrics/materialize] write failed', result.errors)
      return apiError('Не удалось записать значения метрик', 500, {
        data: { written: result.written, total: result.total, skipped: result.skipped, errors },
      })
    }
    const body: OkBody = {
      ok: true,
      data: {
        written: result.written,
        total: result.total,
        skipped: result.skipped,
        errors: [],
      },
    }
    return NextResponse.json(body, { status: 200 })
  } catch (err) {
    console.error('[api/v1/metrics/materialize]', err)
    return apiError(safeErrorMessage(err, 'Не удалось пересчитать метрики'), 500)
  }
}

export async function POST(req: Request) {
  return run(req)
}

// Some clients prefer GET for simple idempotent triggers.
export async function GET(req: Request) {
  return run(req)
}
