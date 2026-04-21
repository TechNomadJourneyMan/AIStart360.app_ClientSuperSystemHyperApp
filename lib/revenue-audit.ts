// Revenue-loss audit: compute the "where does money leak" map from a
// SegmentationResult + bundle calculations. Sau Zhurek reference shows
// ~₸13.3M/мес potential losses — more than current monthly revenue.

import type { SegmentationResult } from '@/lib/rfm-segmentation'
import type { BundleCalculation, BundleKey } from '@/lib/clinic-bundles'

export type LossKey =
  | 'no_shows'
  | 'missed_calls'
  | 'missing_follow_up'
  | 'missing_upsell'
  | 'missing_reactivation'
  | 'missing_chronic_control'
  | 'weak_nps'
  | 'missing_seasonal'
  | 'post_diagnostic_drop'

export type LossSeverity = 'critical' | 'high' | 'medium' | 'low'

export interface RevenueLoss {
  key: LossKey
  label: string
  estimated_loss_kzt: number
  severity: LossSeverity
  source_data: string          // how we calculated it — transparent
  linked_bundle_key: BundleKey | null
}

export interface RevenueAudit {
  losses: RevenueLoss[]
  total_loss_kzt: number
  top_3_losses: RevenueLoss[]
  /** Structural summary shown to expert/client */
  narrative: string
}

export const LOSS_LABELS: Record<LossKey, string> = {
  no_shows:                'No-show (неявки)',
  missed_calls:            'Потерянные входящие звонки',
  missing_follow_up:       'Отсутствие follow-up после диагностики',
  missing_upsell:          'Нет upsell при подтверждении',
  missing_reactivation:    'Не реактивируется спящая база',
  missing_chronic_control: 'Провал с контролем хроников',
  weak_nps:                'Слабая работа с NPS / реферальным контуром',
  missing_seasonal:        'Нет сезонных кампаний',
  post_diagnostic_drop:    'Пост-диагностический провал',
}

const BUNDLE_TO_LOSS: Record<LossKey, BundleKey | null> = {
  no_shows:                'no_show',
  missed_calls:            'instant_callback',
  missing_follow_up:       'follow_up_diagnostics',
  missing_upsell:          'upsell_at_booking',
  missing_reactivation:    'reactivation',
  missing_chronic_control: 'chronic_control',
  weak_nps:                'nps_referral',
  missing_seasonal:        'seasonal_campaigns',
  post_diagnostic_drop:    'follow_up_diagnostics',
}

function severityFromAmount(amount: number): LossSeverity {
  if (amount >= 3_000_000) return 'critical'
  if (amount >= 1_500_000) return 'high'
  if (amount >= 500_000) return 'medium'
  return 'low'
}

export function auditRevenueLosses(
  seg: SegmentationResult,
  bundles: BundleCalculation[],
): RevenueAudit {
  const byBundle = new Map(bundles.map((b) => [b.key, b]))
  const avgCheck = seg.totals.avg_check_kzt || 10_000
  const activeBase = seg.totals.active_last_90d

  // Rough monthly visit estimate: active patients × 1 visit / month
  const monthlyVisits = Math.max(activeBase, 300)

  const losses: RevenueLoss[] = []

  // ── 1. No-show (30% baseline in medical vertical) ──────────────────────────
  const noShowLoss = Math.round(monthlyVisits * 0.30 * avgCheck)
  losses.push({
    key: 'no_shows',
    label: LOSS_LABELS.no_shows,
    estimated_loss_kzt: noShowLoss,
    severity: severityFromAmount(noShowLoss),
    source_data: `${monthlyVisits} визитов/мес × 30% no-show × ${avgCheck.toLocaleString('ru-RU')} ₸`,
    linked_bundle_key: BUNDLE_TO_LOSS.no_shows,
  })

  // ── 2. Missed calls (est 20-30 per day × 60% potential book rate) ──────────
  const missedCallsDaily = Math.round(monthlyVisits / 30 * 0.5)
  const missedCallsLoss = Math.round(missedCallsDaily * 30 * 0.60 * avgCheck * 0.6)
  losses.push({
    key: 'missed_calls',
    label: LOSS_LABELS.missed_calls,
    estimated_loss_kzt: missedCallsLoss,
    severity: severityFromAmount(missedCallsLoss),
    source_data: `Оценка: ${missedCallsDaily} пропусков/день × 60% конверсия × ${avgCheck.toLocaleString('ru-RU')} ₸`,
    linked_bundle_key: BUNDLE_TO_LOSS.missed_calls,
  })

  // ── 3. Missing follow-up after diagnostics (linked to follow_up bundle target_count) ──
  const followUpB = byBundle.get('follow_up_diagnostics')
  if (followUpB) {
    const loss = Math.round(followUpB.target_patient_count * 0.30 * avgCheck * 1.2)
    losses.push({
      key: 'missing_follow_up',
      label: LOSS_LABELS.missing_follow_up,
      estimated_loss_kzt: loss,
      severity: severityFromAmount(loss),
      source_data: `${followUpB.target_patient_count} диагностик × 30% не дошли × ${avgCheck.toLocaleString('ru-RU')} ₸`,
      linked_bundle_key: BUNDLE_TO_LOSS.missing_follow_up,
    })
  }

  // ── 4. Post-diagnostic drop (S4 — риск оттока: LTV потенциал) ────────────
  const s4 = seg.summary.find((x) => x.segment === 'churn_risk')
  if (s4) {
    // 10% of accumulated LTV in churn-risk segment is realistic monthly bleed
    const loss = Math.round(s4.total_ltv_kzt * 0.01)
    losses.push({
      key: 'post_diagnostic_drop',
      label: LOSS_LABELS.post_diagnostic_drop,
      estimated_loss_kzt: loss,
      severity: severityFromAmount(loss),
      source_data: `${s4.count} пациентов риска оттока × 1% от LTV ${(s4.total_ltv_kzt / 1_000_000).toFixed(1)}M ₸`,
      linked_bundle_key: BUNDLE_TO_LOSS.post_diagnostic_drop,
    })
  }

  // ── 5. Missing reactivation (sleeping segment potential) ─────────────────
  const sleeping = seg.summary.find((x) => x.segment === 'sleeping')
  if (sleeping) {
    const loss = Math.round(sleeping.count * 0.20 * avgCheck * 2)  // 20% activate × 2 visits
    losses.push({
      key: 'missing_reactivation',
      label: LOSS_LABELS.missing_reactivation,
      estimated_loss_kzt: loss,
      severity: severityFromAmount(loss),
      source_data: `${sleeping.count} спящих × 20% конверсия × ${avgCheck.toLocaleString('ru-RU')} ₸ × 2 визита`,
      linked_bundle_key: BUNDLE_TO_LOSS.missing_reactivation,
    })
  }

  // ── 6. Missing chronic control ────────────────────────────────────────────
  const chronicB = byBundle.get('chronic_control')
  if (chronicB) {
    const loss = Math.round(chronicB.target_patient_count * 0.25 * avgCheck * 1.2)
    losses.push({
      key: 'missing_chronic_control',
      label: LOSS_LABELS.missing_chronic_control,
      estimated_loss_kzt: loss,
      severity: severityFromAmount(loss),
      source_data: `${chronicB.target_patient_count} потенциальных хроников × 25% × ${avgCheck.toLocaleString('ru-RU')} ₸`,
      linked_bundle_key: BUNDLE_TO_LOSS.missing_chronic_control,
    })
  }

  // ── 7. Weak NPS (referral loss) ──────────────────────────────────────────
  const npsB = byBundle.get('nps_referral')
  if (npsB) {
    const loss = Math.round(monthlyVisits * 0.05 * avgCheck * 2)  // 5% referrals × 2 visits avg
    losses.push({
      key: 'weak_nps',
      label: LOSS_LABELS.weak_nps,
      estimated_loss_kzt: loss,
      severity: severityFromAmount(loss),
      source_data: `${monthlyVisits} визитов × 5% реферальная конверсия × ${avgCheck.toLocaleString('ru-RU')} ₸ × 2`,
      linked_bundle_key: BUNDLE_TO_LOSS.weak_nps,
    })
  }

  // ── 8. Missing seasonal campaigns ────────────────────────────────────────
  const allBase = seg.totals.total_patients
  const seasonalLoss = Math.round(allBase * 0.12 * avgCheck * 1.2 / 3)  // 4 campaigns/year = 1 per 3 months
  losses.push({
    key: 'missing_seasonal',
    label: LOSS_LABELS.missing_seasonal,
    estimated_loss_kzt: seasonalLoss,
    severity: severityFromAmount(seasonalLoss),
    source_data: `База ${allBase} × 12% конверсия × ${avgCheck.toLocaleString('ru-RU')} ₸ / 3 месяца`,
    linked_bundle_key: BUNDLE_TO_LOSS.missing_seasonal,
  })

  // ── 9. Missing upsell ────────────────────────────────────────────────────
  const upsellLoss = Math.round(monthlyVisits * 0.35 * avgCheck * 0.25)
  losses.push({
    key: 'missing_upsell',
    label: LOSS_LABELS.missing_upsell,
    estimated_loss_kzt: upsellLoss,
    severity: severityFromAmount(upsellLoss),
    source_data: `${monthlyVisits} визитов × 35% upsell × 25% от ${avgCheck.toLocaleString('ru-RU')} ₸`,
    linked_bundle_key: BUNDLE_TO_LOSS.missing_upsell,
  })

  // Aggregate + sort
  losses.sort((a, b) => b.estimated_loss_kzt - a.estimated_loss_kzt)
  const totalLoss = losses.reduce((s, l) => s + l.estimated_loss_kzt, 0)
  const top3 = losses.slice(0, 3)

  const narrative =
    `Оценочные ежемесячные потери: ~${(totalLoss / 1_000_000).toFixed(1)}M ₸. ` +
    `Топ-3: ${top3.map((l) => l.label).join(', ')}. ` +
    `Работа по 9 связкам закрывает все эти точки системно.`

  return { losses, total_loss_kzt: totalLoss, top_3_losses: top3, narrative }
}
