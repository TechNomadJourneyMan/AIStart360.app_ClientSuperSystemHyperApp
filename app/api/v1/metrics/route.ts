import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import type { MetricSummary } from '@/types/metrics'
import { resolveTenantWith } from '@/lib/tenancy'
import { loadMetricSummaries, requestedMetricIds } from '@/lib/metrics/summary'

// GET /api/v1/metrics — KPI summaries of the caller's company.
//
//   ?keys= / ?ids=   comma lists of registry metric ids (lib/metrics/registry.ts;
//                    short aliases such as `revenue`, `cac` are accepted).
//                    Without them: the top KPIs (lib/metrics/summary.ts).
//   ?companyId=      optional; authorised by lib/tenancy (read access).
//
// Response envelope (unchanged): { source: 'db' | 'empty', data: MetricSummary[] }.
// Values come only from this company's public.metrics rows (trend from
// metric_value_history). A metric without a value is absent from `data`.
//
// DATA INTEGRITY: never mock/fabricated numbers. The legacy Prisma
// `financial_snapshots` source is not tenant-scoped and stays unused here.
// `period` / `product` / `manager` filters are accepted but not applied:
// materialised values are not split by product or manager yet.

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)

  try {
    // Require an authenticated session — never serve metric data anonymously.
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ source: 'empty', data: [] as MetricSummary[] }, { status: 401 })
    }

    const companyId = searchParams.get('companyId')
    const tenant = await resolveTenantWith(supabase, user.id, { companyId, access: 'read' })
    if (!tenant.ok) {
      // No company yet (or not visible) → honest empty list; 404 only when one was named explicitly.
      const status = companyId ? tenant.status : tenant.status === 401 ? 401 : 200
      return NextResponse.json({ source: 'empty', data: [] as MetricSummary[], ...(companyId ? { error: tenant.error } : {}) }, { status })
    }

    const ids = requestedMetricIds(searchParams.get('keys'), searchParams.get('ids'))
    const data = await loadMetricSummaries(supabase, tenant.tenant.companyId, ids)
    return NextResponse.json({ source: data.length > 0 ? 'db' : 'empty', data })
  } catch (err) {
    console.error('[api/v1/metrics]', err)
    // A real 5xx so the client (fetchMetrics throws on !res.ok) and monitoring
    // can tell a server failure from an honestly-empty list.
    return NextResponse.json({ source: 'error', error: 'metrics_failed' }, { status: 500 })
  }
}
