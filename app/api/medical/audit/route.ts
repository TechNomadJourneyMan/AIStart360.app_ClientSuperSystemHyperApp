export const dynamic = 'force-dynamic'

// GET /api/medical/audit
// Returns persisted patient_segments / growth_bundles / revenue_losses
// for the caller without re-running the RFM pipeline. Use this on dashboard
// mount; use POST /api/medical/audit/run only when the user explicitly
// asks to recompute (or after a new patient_base upload).

import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase-server'
import { SEGMENT_LABELS, type PatientSegmentId } from '@/lib/rfm-segmentation'
import { BUNDLE_TEMPLATES, type BundleKey } from '@/lib/clinic-bundles'
import { LOSS_LABELS, type LossKey, type LossSeverity } from '@/lib/revenue-audit'

function srBase() {
  return {
    url: (process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').replace(/\/$/, ''),
    key: process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  }
}

async function srGet<T>(path: string, range?: [number, number]): Promise<T | null> {
  const { url, key } = srBase()
  const headers: Record<string, string> = { apikey: key, Authorization: `Bearer ${key}` }
  if (range) {
    headers['Range'] = `${range[0]}-${range[1]}`
    headers['Range-Unit'] = 'items'
  }
  const res = await fetch(`${url}/rest/v1/${path}`, { headers, cache: 'no-store' })
  if (!res.ok) return null
  return (await res.json()) as T
}

interface PatientRow {
  segment: PatientSegmentId
  monetary_kzt: number
  frequency: number
  recency_days: number
  priority: number
}

interface BundleRow {
  bundle_key: BundleKey
  target_segments: PatientSegmentId[]
  target_patient_count: number
  estimated_conversion: number
  estimated_revenue_kzt: number
  priority: number
  complexity: 'easy' | 'medium' | 'hard'
  effect_timeline: string
  trigger_description: string
  script_preview: string
}

interface LossRow {
  loss_key: LossKey
  estimated_loss_kzt: number
  severity: LossSeverity
  source_data: string
  linked_bundle_key: BundleKey | null
}

export async function GET() {
  const sb = createServerClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })

  // Paginate patient_segments (PostgREST default limit 1000)
  let segments: PatientRow[] = []
  let offset = 0
  while (true) {
    const page = await srGet<PatientRow[]>(
      `patient_segments?client_id=eq.${user.id}&select=segment,monetary_kzt,frequency,recency_days,priority`,
      [offset, offset + 999],
    )
    if (!page || page.length === 0) break
    segments = segments.concat(page)
    if (page.length < 1000) break
    offset += 1000
    if (offset > 50_000) break
  }

  if (segments.length === 0) {
    return NextResponse.json({ ok: false, empty: true }, { status: 404 })
  }

  const [bundles, losses] = await Promise.all([
    srGet<BundleRow[]>(`growth_bundles?client_id=eq.${user.id}&order=priority.asc`),
    srGet<LossRow[]>(`revenue_losses?client_id=eq.${user.id}&order=estimated_loss_kzt.desc`),
  ])

  // ── Aggregate totals + segment summary from raw patient_segments ──
  const totalPatients = segments.length
  const withRevenue = segments.filter((p) => (p.monetary_kzt ?? 0) > 0)
  const totalLtv = segments.reduce((s, p) => s + (p.monetary_kzt ?? 0), 0)
  const avgCheck = withRevenue.length > 0
    ? Math.round(withRevenue.reduce((s, p) => s + p.monetary_kzt / Math.max(1, p.frequency || 1), 0) / withRevenue.length)
    : 0
  const activeLast90 = segments.filter((p) => p.recency_days <= 90).length
  const sleeping180Plus = segments.filter((p) => p.recency_days > 180 && p.recency_days < 99999).length
  const deadLeads = segments.filter((p) => p.segment === 'dead_lead').length

  const segMap = new Map<PatientSegmentId, { count: number; total_ltv: number; recency_sum: number; recency_count: number; priority: number }>()
  for (const p of segments) {
    const cur = segMap.get(p.segment) ?? { count: 0, total_ltv: 0, recency_sum: 0, recency_count: 0, priority: p.priority }
    cur.count += 1
    cur.total_ltv += p.monetary_kzt ?? 0
    if (p.recency_days < 99999) {
      cur.recency_sum += p.recency_days
      cur.recency_count += 1
    }
    cur.priority = p.priority
    segMap.set(p.segment, cur)
  }
  const segmentsSummary = Array.from(segMap.entries()).map(([segment, v]) => ({
    segment,
    label: SEGMENT_LABELS[segment],
    count: v.count,
    total_ltv_kzt: v.total_ltv,
    avg_ltv_kzt: v.count > 0 ? Math.round(v.total_ltv / v.count) : 0,
    avg_recency_days: v.recency_count > 0 ? Math.round(v.recency_sum / v.recency_count) : 0,
    priority: v.priority,
  })).sort((a, b) => a.priority - b.priority)

  // ── Reshape bundles + losses to match POST endpoint response ──
  const bundlesOut = (bundles ?? []).map((b) => ({
    key: b.bundle_key,
    label: BUNDLE_TEMPLATES[b.bundle_key]?.label ?? b.bundle_key,
    target_segments: b.target_segments,
    target_patient_count: b.target_patient_count,
    estimated_conversion: b.estimated_conversion,
    estimated_revenue_kzt: b.estimated_revenue_kzt,
    priority: b.priority,
    complexity: b.complexity,
    effect_timeline: b.effect_timeline,
    trigger_description: b.trigger_description,
    script_preview: b.script_preview,
  }))

  const totalLoss = (losses ?? []).reduce((s, l) => s + (l.estimated_loss_kzt ?? 0), 0)
  const lossesOut = (losses ?? []).map((l) => ({
    key: l.loss_key,
    label: LOSS_LABELS[l.loss_key] ?? l.loss_key,
    estimated_loss_kzt: l.estimated_loss_kzt,
    severity: l.severity,
    source_data: l.source_data,
    linked_bundle_key: l.linked_bundle_key,
  }))

  return NextResponse.json({
    ok: true,
    totals: {
      total_patients: totalPatients,
      total_ltv_kzt: totalLtv,
      avg_check_kzt: avgCheck,
      active_last_90d: activeLast90,
      sleeping_180d_plus: sleeping180Plus,
      dead_leads: deadLeads,
    },
    segments: segmentsSummary,
    bundles: bundlesOut,
    audit: {
      total_loss_kzt: totalLoss,
      narrative: `Карта потерь: ${lossesOut.length} источников на сумму ${Math.round(totalLoss / 1_000_000)}M ₸/мес`,
      losses: lossesOut,
    },
  })
}
