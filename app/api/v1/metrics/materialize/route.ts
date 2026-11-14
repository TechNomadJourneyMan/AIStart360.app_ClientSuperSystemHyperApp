// ============================================================
// app/api/v1/metrics/materialize/route.ts
// POST /api/v1/metrics/materialize[?companyId=]   — recalculates (writes)
// GET  /api/v1/metrics/materialize[?companyId=]   — status only, never writes
//
// POST runs the registry resolver for the caller's company and upserts every
// resolvable value into `public.metrics`. The /metrics page calls it once
// on first mount (if every catalog value is empty) — components/metrics/
// MetricsLiveCatalog.tsx, method POST.
//
// R-147: writing is POST only (a GET that writes can be fired cross-site by
// an <img> / link prefetch) and needs the right to manage the company
// (tenant.canManage = can_manage_company: owner / company admin /
// partner_admin / platform admin); a reader (viewer, member, partner_expert,
// read-only staff) gets 403 { code: 'read_only' }. GET answers whether the
// caller may recalculate, and does nothing else.
//
// Authorisation: lib/tenancy (read access to the company). After that check
// the inputs are read AND the rows written with the service role
// (lib/metrics/materialize-tenant.ts): since migration 088 users cannot
// insert/update metrics themselves (source / confidence / provenance cannot
// be forged from the browser), and reading the inputs through the caller's
// RLS would hide the owner's rows without company_id from a member / partner /
// staff user — whose recalculation then deleted the owner's values.
// A failed write (upsert or stale-row cleanup) answers 500 { ok:false }.
// ============================================================

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase-service'
import { resolveTenantWith, tenantErrorMessage, type TenantContext } from '@/lib/tenancy'
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

type Resolved =
  | { ok: true; tenant: TenantContext; supabase: Awaited<ReturnType<typeof createClient>> }
  | { ok: false; response: NextResponse }

async function resolve(req: Request): Promise<Resolved> {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return { ok: false, response: apiError(tenantErrorMessage('unauthenticated'), 401) }

  const companyId = new URL(req.url).searchParams.get('companyId')
  const tenant = await resolveTenantWith(supabase, user.id, { companyId, access: 'read' })
  if (!tenant.ok) {
    // No company yet: soft signal, the client renders its empty state (200 as before).
    if (tenant.error === 'no_company' && !companyId) return { ok: false, response: NextResponse.json({ ok: false, error: 'no_company' }, { status: 200 }) }
    return {
      ok: false,
      response: apiError(tenant.error === 'no_company' ? 'no_company' : tenantErrorMessage(tenant.error), tenant.status, {
        message: tenantErrorMessage(tenant.error),
      }),
    }
  }
  return { ok: true, tenant: tenant.tenant, supabase }
}

async function run(req: Request): Promise<NextResponse> {
  const resolved = await resolve(req)
  if (!resolved.ok) return resolved.response
  const { supabase, tenant } = resolved
  // R-147: recalculating writes public.metrics — the right to manage the company, not only to read it.
  if (!tenant.canManage) {
    return apiError('Пересчитать метрики может владелец или администратор компании', 403, { code: 'read_only' })
  }

  try {
    const { result } = await materializeForTenant(supabase, createServiceClient(), tenant)
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

/** Status only (R-147): may the caller recalculate? Never writes. */
export async function GET(req: Request) {
  try {
    const resolved = await resolve(req)
    if (!resolved.ok) return resolved.response
    return NextResponse.json({
      ok: true,
      data: { companyId: resolved.tenant.companyId, canMaterialize: resolved.tenant.canManage, method: 'POST' },
    })
  } catch (err) {
    console.error('[api/v1/metrics/materialize GET]', err)
    return apiError(safeErrorMessage(err, 'Не удалось проверить доступ'), 500)
  }
}
