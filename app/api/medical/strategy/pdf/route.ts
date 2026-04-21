export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// GET /api/medical/strategy/pdf
// Streams a brand-styled PDF strategy for the authenticated client.
// Pulls segments / bundles / losses from DB (persisted by /api/medical/audit/run).

import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase-server'
import { srGet } from '@/lib/expert-auth'
import { generateStrategyPdf } from '@/lib/pdf-strategy'
import { SEGMENT_LABELS, type PatientSegmentId } from '@/lib/rfm-segmentation'
import type { BundleCalculation, BundleKey } from '@/lib/clinic-bundles'
import type { RevenueLoss, LossKey, LossSeverity } from '@/lib/revenue-audit'
import type { Branding } from '@/lib/verticals'

interface SegRow {
  segment: PatientSegmentId
  recency_days: number
  monetary_kzt: number
  frequency: number
}

interface BundleRow {
  bundle_key: BundleKey
  target_patient_count: number
  estimated_conversion: number | string
  estimated_revenue_kzt: number | string
  priority: number
  complexity: 'easy' | 'medium' | 'hard'
  effect_timeline: string | null
  trigger_description: string | null
  script_preview: string | null
  target_segments: PatientSegmentId[]
}

interface LossRow {
  loss_key: LossKey
  estimated_loss_kzt: number | string
  severity: LossSeverity
  source_data: string | null
  linked_bundle_key: BundleKey | null
}

interface ProfileRow {
  email: string | null
  branding: Branding | null
}

interface CompanyRow {
  name: string | null
  contact_email: string | null
}

export async function GET() {
  const sb = createServerClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })

  // Load everything in parallel
  const [profile, company, segs, bundles, losses] = await Promise.all([
    srGet<ProfileRow[]>(`profiles?id=eq.${user.id}&select=email,branding&limit=1`),
    srGet<CompanyRow[]>(`companies?user_id=eq.${user.id}&select=name,contact_email&limit=1`),
    srGet<SegRow[]>(`patient_segments?client_id=eq.${user.id}&select=segment,recency_days,monetary_kzt,frequency`),
    srGet<BundleRow[]>(`growth_bundles?client_id=eq.${user.id}&select=*&order=priority.asc`),
    srGet<LossRow[]>(`revenue_losses?client_id=eq.${user.id}&select=*&order=estimated_loss_kzt.desc`),
  ])

  if (!segs || segs.length === 0 || !bundles || bundles.length === 0) {
    return NextResponse.json(
      { error: 'no audit data found. Run /api/medical/audit/run first.' },
      { status: 404 },
    )
  }

  // ── Reconstruct SegmentationResult from rows ─────────────────────────────
  const segSummary = (Object.keys(SEGMENT_LABELS) as PatientSegmentId[]).map((id, idx) => {
    const inSeg = segs.filter((p) => p.segment === id)
    const totalLtv = inSeg.reduce((s, p) => s + Number(p.monetary_kzt), 0)
    return {
      segment: id,
      label: SEGMENT_LABELS[id],
      count: inSeg.length,
      total_ltv_kzt: totalLtv,
      avg_ltv_kzt: inSeg.length > 0 ? Math.round(totalLtv / inSeg.length) : 0,
      avg_recency_days: inSeg.length > 0
        ? Math.round(inSeg.reduce((s, p) => s + (p.recency_days < 99999 ? p.recency_days : 0), 0) / inSeg.length)
        : 0,
      priority: idx + 1,
    }
  })
  segSummary.sort((a, b) => a.priority - b.priority)

  const totalLtv = segs.reduce((s, p) => s + Number(p.monetary_kzt), 0)
  const withLtv = segs.filter((p) => Number(p.monetary_kzt) > 0)
  const avgCheck = withLtv.length > 0
    ? Math.round(withLtv.reduce((s, p) => s + Number(p.monetary_kzt) / Math.max(1, p.frequency), 0) / withLtv.length)
    : 0

  const segResult = {
    patients: [], // not needed for PDF
    summary: segSummary,
    totals: {
      total_patients: segs.length,
      total_ltv_kzt: totalLtv,
      avg_check_kzt: avgCheck,
      active_last_90d: segs.filter((p) => p.recency_days <= 90).length,
      sleeping_180d_plus: segs.filter((p) => p.recency_days > 180 && p.recency_days < 99999).length,
      dead_leads: segs.filter((p) => p.segment === 'dead_lead').length,
    },
    thresholds: {
      vip_ltv_kzt: 80_000,
      recency_active_days: 90,
      recency_sleeping_days: 180,
    },
  }

  // ── Reconstruct bundles + losses from DB ─────────────────────────────────
  const bundleCalcs: BundleCalculation[] = bundles.map((b) => ({
    key: b.bundle_key,
    label: bundleLabel(b.bundle_key),
    target_patient_count: b.target_patient_count,
    estimated_conversion: Number(b.estimated_conversion),
    estimated_revenue_kzt: Number(b.estimated_revenue_kzt),
    priority: b.priority,
    complexity: b.complexity,
    effect_timeline: b.effect_timeline ?? '',
    trigger_description: b.trigger_description ?? '',
    script_preview: b.script_preview ?? '',
    target_segments: b.target_segments,
  }))

  const auditLosses: RevenueLoss[] = losses?.map((l) => ({
    key: l.loss_key,
    label: lossLabel(l.loss_key),
    estimated_loss_kzt: Number(l.estimated_loss_kzt),
    severity: l.severity,
    source_data: l.source_data ?? '',
    linked_bundle_key: l.linked_bundle_key,
  })) ?? []
  const totalLoss = auditLosses.reduce((s, l) => s + l.estimated_loss_kzt, 0)
  const top3 = [...auditLosses].sort((a, b) => b.estimated_loss_kzt - a.estimated_loss_kzt).slice(0, 3)

  // Generate PDF
  const pdf = await generateStrategyPdf({
    clinic_name: company?.[0]?.name || 'Клиника',
    clinic_email: company?.[0]?.contact_email || profile?.[0]?.email || null,
    segmentation: segResult,
    bundles: bundleCalcs,
    audit: {
      losses: auditLosses,
      total_loss_kzt: totalLoss,
      top_3_losses: top3,
      narrative: `Оценочные ежемесячные потери: ~${(totalLoss / 1_000_000).toFixed(1)}M ₸. ` +
                 `Топ-3: ${top3.map((l) => l.label).join(', ')}. ` +
                 `Работа по 9 связкам закрывает все эти точки системно.`,
    },
    branding: profile?.[0]?.branding ?? null,
  })

  // Need fresh ArrayBuffer for BlobPart
  const ab = new ArrayBuffer(pdf.byteLength)
  new Uint8Array(ab).set(pdf)
  return new NextResponse(ab, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="strategy_${Date.now()}.pdf"`,
      'Cache-Control': 'no-store',
    },
  })
}

// Simple label helpers (avoid circular import with the lib)
function bundleLabel(key: BundleKey): string {
  const m: Record<BundleKey, string> = {
    no_show: 'Подтверждение записи (no-show защита)',
    cross_sell_after_ekg: 'Cross-sell после ЭКГ',
    follow_up_diagnostics: 'Follow-up после диагностики',
    reactivation: 'Реактивация спящей базы',
    nps_referral: 'NPS + реферальная программа',
    instant_callback: 'Мгновенный callback (60 сек)',
    upsell_at_booking: 'Upsell при подтверждении записи',
    seasonal_campaigns: 'Сезонные кампании',
    chronic_control: 'Профилактический контроль хроников',
  }
  return m[key]
}

function lossLabel(key: LossKey): string {
  const m: Record<LossKey, string> = {
    no_shows: 'No-show (неявки)',
    missed_calls: 'Потерянные входящие звонки',
    missing_follow_up: 'Отсутствие follow-up',
    missing_upsell: 'Нет upsell при подтверждении',
    missing_reactivation: 'Не реактивируется спящая база',
    missing_chronic_control: 'Провал с хрониками',
    weak_nps: 'Слабая работа с NPS',
    missing_seasonal: 'Нет сезонных кампаний',
    post_diagnostic_drop: 'Пост-диагностический провал',
  }
  return m[key]
}
