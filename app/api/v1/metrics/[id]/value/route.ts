// ============================================================
// app/api/v1/metrics/[id]/value/route.ts
// GET /api/v1/metrics/:id/value
// Returns the latest materialized value for a single metric +
// provenance. If `public.metrics` has no row for this
// (company, metric) pair, falls back to a live resolver run
// (without persisting) so the UI always sees a usable number.
// ============================================================

import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getMetricById } from '@/lib/metrics/registry'
import { gatherResolverContext } from '@/lib/metrics/materialize'
import { resolveMetric } from '@/lib/metrics/resolver'
import type { PeriodQuarter } from '@/lib/metrics/types'

const FRESH_WINDOW_MS = 24 * 60 * 60 * 1000

interface ValuePayload {
  metric_id: string
  label: string
  unit: string
  value: number | null
  period: { year: number | null; quarter: string | null }
  source: string
  confidence: number | null
  provenance: unknown
  computed_at: string | null
  fresh: boolean
}

function isFresh(computedAt: string | null, now: Date): boolean {
  if (!computedAt) return false
  const ts = Date.parse(computedAt)
  if (Number.isNaN(ts)) return false
  return now.getTime() - ts <= FRESH_WINDOW_MS
}

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } | Promise<{ id: string }> },
) {
  try {
    const resolved = await Promise.resolve(params)
    const metricId = resolved.id

    const supabase = await createClient()

    // 1. Auth
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json(
        { ok: false, error: 'Unauthorized' },
        { status: 401 },
      )
    }

    // 2. Registry lookup
    const entry = getMetricById(metricId)
    if (!entry) {
      return NextResponse.json(
        { ok: false, error: `Unknown metric id "${metricId}"` },
        { status: 404 },
      )
    }

    // 3. Resolve company_id for this user
    const { data: companyRow, error: companyError } = await supabase
      .from('companies')
      .select('id')
      .eq('user_id', user.id)
      .maybeSingle()

    if (companyError) {
      return NextResponse.json(
        { ok: false, error: companyError.message },
        { status: 500 },
      )
    }
    if (!companyRow) {
      return NextResponse.json(
        { ok: false, error: 'No company found for user' },
        { status: 404 },
      )
    }
    const companyId = companyRow.id as string

    // 4. Look up latest materialized row
    const { data: rows, error: metricsError } = await supabase
      .from('metrics')
      .select(
        'metric_value, metric_unit, period_year, period_quarter, source, confidence, provenance, computed_at, recorded_at',
      )
      .eq('company_id', companyId)
      .eq('metric_key', metricId)
      .order('computed_at', { ascending: false, nullsFirst: false })
      .order('recorded_at', { ascending: false })
      .limit(1)

    if (metricsError) {
      return NextResponse.json(
        { ok: false, error: metricsError.message },
        { status: 500 },
      )
    }

    const now = new Date()
    const row = rows && rows.length > 0 ? rows[0] : null

    if (row) {
      const computedAt =
        (row.computed_at as string | null) ??
        (row.recorded_at as string | null) ??
        null

      const payload: ValuePayload = {
        metric_id: metricId,
        label: entry.label,
        unit: (row.metric_unit as string | null) ?? entry.unit ?? '',
        value:
          row.metric_value === null || row.metric_value === undefined
            ? null
            : Number(row.metric_value),
        period: {
          year: (row.period_year as number | null) ?? null,
          quarter: (row.period_quarter as string | null) ?? null,
        },
        source: (row.source as string | null) ?? 'resolver',
        confidence:
          row.confidence === null || row.confidence === undefined
            ? null
            : Number(row.confidence),
        provenance: row.provenance ?? null,
        computed_at: computedAt,
        fresh: isFresh(computedAt, now),
      }

      return NextResponse.json({ ok: true, data: payload })
    }

    // 5. No materialized row → live resolve (no persist)
    const ctx = await gatherResolverContext(supabase, {
      userId: user.id,
      companyId,
      now,
    })
    const value = resolveMetric(metricId, ctx, { entry })

    const payload: ValuePayload = {
      metric_id: metricId,
      label: entry.label,
      unit: entry.unit ?? '',
      value: value.numeric,
      period: {
        year: value.periodYear ?? null,
        quarter: (value.periodQuarter as PeriodQuarter | null) ?? null,
      },
      source: 'live',
      confidence: value.picked ? value.confidence : null,
      provenance: {
        picked: value.picked,
        considered: value.considered,
        notes: value.notes,
        raw_value: value.value,
      },
      computed_at: value.computedAt,
      fresh: isFresh(value.computedAt, now),
    }

    return NextResponse.json({ ok: true, data: payload })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json(
      { ok: false, error: message },
      { status: 500 },
    )
  }
}
