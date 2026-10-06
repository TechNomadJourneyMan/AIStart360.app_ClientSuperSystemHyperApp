// ============================================================
// app/api/v1/metrics/[id]/timeseries/route.ts
// GET /api/v1/metrics/:id/timeseries?period=3M
//
// Returns the historical series for one metric, scoped to the
// caller's company. Response shape matches the contract expected
// by `hooks/useTimeseries.ts`:
//   { metricId, period, granularity, unit, data: TimeseriesPoint[] }
// ============================================================

import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { getMetricById } from '@/lib/metrics/registry'
import { fetchTimeseries, resolveSeriesCompany, type FetchPeriod } from '@/lib/metrics/timeseries-fetch'
import { safeErrorMessage } from '@/lib/api-error'

const PeriodSchema = z.enum(['1M', '3M', '6M', '1Y', 'ALL']).default('3M')

const GRANULARITY: Record<FetchPeriod, string> = {
  '1M': 'daily',
  '3M': 'weekly',
  '6M': 'monthly',
  '1Y': 'monthly',
  ALL: 'monthly',
}

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } | Promise<{ id: string }> },
) {
  try {
    const resolved = await Promise.resolve(params)
    const metricId = resolved.id

    const parsed = PeriodSchema.safeParse(req.nextUrl.searchParams.get('period') ?? '3M')
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid period' }, { status: 400 })
    }
    const period = parsed.data

    const entry = getMetricById(metricId)
    const unit = entry?.unit ?? ''

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
    const data = companyId
      ? await fetchTimeseries(supabase, { companyId, metricKey: metricId, period })
      : []

    return NextResponse.json({
      metricId,
      period,
      granularity: GRANULARITY[period],
      unit,
      data,
    })
  } catch (err) {
    console.error('[v1/metrics/[id]/timeseries]', err instanceof Error ? err.message : err)
    const message = safeErrorMessage(err, 'Не удалось загрузить историю метрики')
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
