// ============================================================
// app/api/v1/metrics/[id]/anomalies/route.ts
// GET /api/v1/metrics/:id/anomalies?period=ALL
//
// Pulls the metric's history for the caller's company, runs the
// pure rolling-z anomaly detector, returns the contract expected
// by `hooks/useTimeseries.ts::useAnomalies`:
//   { data: AnomalyPoint[] }
// ============================================================

import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { fetchTimeseries, resolveSeriesCompany, type FetchPeriod } from '@/lib/metrics/timeseries-fetch'
import { detectAnomalies } from '@/lib/metrics/anomalies'
import { safeErrorMessage } from '@/lib/api-error'

const PeriodSchema = z.enum(['1M', '3M', '6M', '1Y', 'ALL']).default('ALL')

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } | Promise<{ id: string }> },
) {
  try {
    const resolved = await Promise.resolve(params)
    const metricId = resolved.id

    const parsed = PeriodSchema.safeParse(req.nextUrl.searchParams.get('period') ?? 'ALL')
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid period' }, { status: 400 })
    }
    const period: FetchPeriod = parsed.data

    const supabase = await createClient()
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Same tenancy as the catalog / value routes: members and partners read
    // the company's history too, and ?companyId= picks one of several.
    const company = await resolveSeriesCompany(supabase, user.id, req.nextUrl.searchParams.get('companyId'))
    if (!company.ok) {
      return NextResponse.json({ error: company.error }, { status: company.status })
    }
    const companyId = company.companyId
    const series = companyId
      ? await fetchTimeseries(supabase, { companyId, metricKey: metricId, period })
      : []

    const data = detectAnomalies(series)
    return NextResponse.json({ data })
  } catch (err) {
    console.error('[v1/metrics/[id]/anomalies]', err instanceof Error ? err.message : err)
    const message = safeErrorMessage(err, 'Не удалось рассчитать аномалии')
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
