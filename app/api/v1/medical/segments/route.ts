/**
 * GET /api/v1/medical/segments
 *
 * Returns aggregate segment summary for the current client's patient_segments.
 * Used by SegmentationCard. RLS-scoped via patient_segments_client_read_own.
 */

export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'

import { createServerClient } from '@/lib/supabase-server'
import { SEGMENT_LABELS, type PatientSegmentId } from '@/lib/rfm-segmentation'

export async function GET() {
  const sb = createServerClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user?.id) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }

  const { data, error } = await sb
    .from('patient_segments')
    .select('segment, monetary_kzt, recency_days, priority')
    .eq('client_id', user.id)

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  }

  const rows = (data ?? []) as Array<{
    segment: PatientSegmentId
    monetary_kzt: number
    recency_days: number
    priority: number
  }>

  const summary: Record<PatientSegmentId, {
    segment: PatientSegmentId
    label: string
    count: number
    total_ltv_kzt: number
    avg_ltv_kzt: number
    avg_recency_days: number
    priority: number
  }> = {} as Record<PatientSegmentId, ReturnType<typeof emptyBucket>>

  for (const id of Object.keys(SEGMENT_LABELS) as PatientSegmentId[]) {
    summary[id] = emptyBucket(id)
  }

  for (const r of rows) {
    const bucket = summary[r.segment]
    if (!bucket) continue
    bucket.count += 1
    bucket.total_ltv_kzt += r.monetary_kzt
    bucket.avg_recency_days += r.recency_days
    bucket.priority = r.priority
  }
  for (const id of Object.keys(summary) as PatientSegmentId[]) {
    const b = summary[id]
    if (b.count > 0) {
      b.avg_ltv_kzt = Math.round(b.total_ltv_kzt / b.count)
      b.avg_recency_days = Math.round(b.avg_recency_days / b.count)
    }
  }

  return NextResponse.json({
    ok: true,
    data: Object.values(summary).sort((a, b) => a.priority - b.priority),
  })
}

function emptyBucket(id: PatientSegmentId) {
  return {
    segment: id,
    label: SEGMENT_LABELS[id],
    count: 0,
    total_ltv_kzt: 0,
    avg_ltv_kzt: 0,
    avg_recency_days: 0,
    priority: 99,
  }
}
