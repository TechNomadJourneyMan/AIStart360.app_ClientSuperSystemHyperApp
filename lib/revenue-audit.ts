// Revenue-loss audit: the «where does money leak» map from a
// SegmentationResult + bundle calculations.
//
// R-041 (BI-53) — honest numbers:
//   • the money base comes from the CLIENT's facts: monthly visits / revenue /
//     average check passed in `facts`, else derived from the patient base
//     (active patients of the last 90 days × visits per active patient, the
//     base's own average check). No floor (was: max(active, 300) visits for ANY
//     clinic) and no default check (was: 10 000 ₸);
//   • without a monthly revenue there is nothing to measure a loss against:
//     status 'no_data', no amounts;
//   • every rate (no-show 30 %, upsell 35 % …) is a named ASSUMPTION
//     (REVENUE_AUDIT_ASSUMPTIONS), printed with the loss, overridable;
//   • the total is capped at a share of the monthly revenue (30 % by default):
//     a clinic with ≈0.75 M ₸/мес no longer «loses» ≈3.2 M ₸/мес;
//   • severity is relative to the revenue, not absolute tenge.

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
  /** Every estimate rests on assumptions (REVENUE_AUDIT_ASSUMPTIONS), never on a measured loss. */
  basis?: 'assumption'
  /** The assumptions this loss rests on, human-readable. */
  assumptions?: string[]
}

export interface RevenueAudit {
  losses: RevenueLoss[]
  total_loss_kzt: number
  top_3_losses: RevenueLoss[]
  /** Structural summary shown to expert/client */
  narrative: string
  /** 'no_data': no monthly revenue to measure against — no amounts at all. */
  status?: 'ok' | 'no_data'
  /** Losses not estimated, with the missing data. */
  not_estimated?: Array<{ key: LossKey; label: string; reason: string }>
  /** The money base used (null = unknown). */
  monthly_revenue_kzt?: number | null
  monthly_visits?: number | null
  avg_check_kzt?: number | null
  /** Ceiling of the total (share of the monthly revenue) and whether it applied. */
  cap_kzt?: number | null
  capped?: boolean
  assumptions?: RevenueAuditAssumptions
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

/**
 * Rates of the loss model. These are ASSUMPTIONS (industry rules of thumb
 * calibrated on one clinic, Sau Zhurek), not facts of the client — every loss
 * says which of them it rests on. Override per clinic via `opts.assumptions`.
 */
export const REVENUE_AUDIT_ASSUMPTIONS = {
  /** Visits per month of a patient active in the last 90 days (when visits are not given). */
  visitsPerActivePatientPerMonth: 1,
  noShowRate: 0.30,
  /** Missed incoming calls per day as a share of daily visits. */
  missedCallsPerVisit: 0.5,
  missedCallBookRate: 0.60,
  missedCallCheckShare: 0.60,
  followUpDropRate: 0.30,
  followUpCheckMultiplier: 1.2,
  /** Monthly bleed of the accumulated LTV of the churn-risk segment. */
  churnRiskMonthlyLtvShare: 0.01,
  reactivationRate: 0.20,
  reactivationVisits: 2,
  chronicDropRate: 0.25,
  chronicCheckMultiplier: 1.2,
  referralRate: 0.05,
  referralVisits: 2,
  seasonalConversion: 0.12,
  seasonalCheckMultiplier: 1.2,
  seasonalEveryMonths: 3,
  upsellRate: 0.35,
  upsellCheckShare: 0.25,
  /** Ceiling of the total estimated loss as a share of the monthly revenue. */
  maxLossShareOfRevenue: 0.30,
} as const

export type RevenueAuditAssumptions = { -readonly [K in keyof typeof REVENUE_AUDIT_ASSUMPTIONS]: number }

/** What the client actually told us (onboarding, documents). Missing = derive from the base. */
export interface RevenueAuditFacts {
  monthlyVisits?: number | null
  monthlyRevenueKzt?: number | null
  avgCheckKzt?: number | null
}

export interface RevenueAuditOptions {
  facts?: RevenueAuditFacts
  assumptions?: Partial<RevenueAuditAssumptions>
}

function positive(v: number | null | undefined): number | null {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null
}

function pct(v: number): string {
  return `${Math.round(v * 1000) / 10}%`
}

function kzt(v: number): string {
  return `${Math.round(v).toLocaleString('ru-RU')} ₸`
}

/** Severity relative to the monthly revenue (≥10 % critical, ≥5 % high, ≥2 % medium). */
function severityOf(amount: number, revenue: number): LossSeverity {
  const share = amount / revenue
  if (share >= 0.10) return 'critical'
  if (share >= 0.05) return 'high'
  if (share >= 0.02) return 'medium'
  return 'low'
}

export function auditRevenueLosses(
  seg: SegmentationResult,
  bundles: BundleCalculation[],
  opts: RevenueAuditOptions = {},
): RevenueAudit {
  const A: RevenueAuditAssumptions = { ...REVENUE_AUDIT_ASSUMPTIONS, ...(opts.assumptions ?? {}) }
  const facts = opts.facts ?? {}
  const byBundle = new Map(bundles.map((b) => [b.key, b]))

  // ── The money base: facts first, then the patient base; never a constant ──
  const factCheck = positive(facts.avgCheckKzt)
  const avgCheck = factCheck ?? positive(seg.totals.avg_check_kzt)
  const factVisits = positive(facts.monthlyVisits)
  const activeBase = seg.totals.active_last_90d
  const monthlyVisits = factVisits ?? (activeBase > 0 ? Math.round(activeBase * A.visitsPerActivePatientPerMonth) : null)
  const factRevenue = positive(facts.monthlyRevenueKzt)
  const monthlyRevenue = factRevenue ?? (monthlyVisits !== null && avgCheck !== null ? monthlyVisits * avgCheck : null)

  const visitsNote = factVisits !== null
    ? `${monthlyVisits} визитов/мес (факт клиента)`
    : `${monthlyVisits ?? 0} визитов/мес (допущение: ${activeBase} активных за 90 дн. × ${A.visitsPerActivePatientPerMonth} визит/мес)`
  const checkNote = avgCheck === null ? '' : `${kzt(avgCheck)}${factCheck !== null ? ' (факт клиента)' : ' (средний чек по базе)'}`
  const revenueNote = monthlyRevenue === null ? null : `${kzt(monthlyRevenue)}/мес${factRevenue !== null ? ' (факт клиента)' : ` (${visitsNote} × ${checkNote})`}`

  const assumptionsUsed: RevenueAuditAssumptions = { ...A }
  const base = {
    monthly_revenue_kzt: monthlyRevenue === null ? null : Math.round(monthlyRevenue),
    monthly_visits: monthlyVisits,
    avg_check_kzt: avgCheck === null ? null : Math.round(avgCheck),
    assumptions: assumptionsUsed,
  }

  // Nothing to measure a loss against: say so instead of inventing a base.
  if (monthlyRevenue === null) {
    const reason = avgCheck === null
      ? 'нет данных о среднем чеке (в базе нет сумм, клиент не указал чек)'
      : 'нет данных о визитах (нет активных пациентов за 90 дней, клиент не указал визиты/выручку)'
    return {
      status: 'no_data',
      losses: [],
      total_loss_kzt: 0,
      top_3_losses: [],
      not_estimated: (Object.keys(LOSS_LABELS) as LossKey[]).map((key) => ({ key, label: LOSS_LABELS[key], reason })),
      cap_kzt: null,
      capped: false,
      ...base,
      narrative: `Потери не оценены: ${reason}. Укажите выручку или число визитов в месяц и средний чек — оценка будет построена от ваших цифр.`,
    }
  }

  const losses: RevenueLoss[] = []
  const notEstimated: Array<{ key: LossKey; label: string; reason: string }> = []
  const add = (key: LossKey, amount: number, source: string, assumptions: string[]) => {
    const value = Math.round(amount)
    if (!(value > 0)) return
    losses.push({
      key, label: LOSS_LABELS[key], estimated_loss_kzt: value, severity: 'low',
      source_data: `${source}. Допущения: ${assumptions.join(', ')}`,
      linked_bundle_key: BUNDLE_TO_LOSS[key], basis: 'assumption', assumptions,
    })
  }
  const skip = (key: LossKey, reason: string) => notEstimated.push({ key, label: LOSS_LABELS[key], reason })
  const needCheck = 'нет данных о среднем чеке'
  const needVisits = 'нет данных о визитах в месяц'

  // ── 1. No-show ────────────────────────────────────────────────────────────
  if (monthlyVisits !== null && avgCheck !== null) {
    add('no_shows', monthlyVisits * A.noShowRate * avgCheck,
      `${visitsNote} × ${pct(A.noShowRate)} неявок × ${checkNote}`, [`no-show ${pct(A.noShowRate)}`])
  } else skip('no_shows', monthlyVisits === null ? needVisits : needCheck)

  // ── 2. Missed calls ───────────────────────────────────────────────────────
  if (monthlyVisits !== null && avgCheck !== null) {
    const daily = (monthlyVisits / 30) * A.missedCallsPerVisit
    add('missed_calls', daily * 30 * A.missedCallBookRate * avgCheck * A.missedCallCheckShare,
      `${Math.round(daily * 10) / 10} пропущенных звонков/день × ${pct(A.missedCallBookRate)} записи × ${pct(A.missedCallCheckShare)} от ${checkNote}`,
      [`${A.missedCallsPerVisit} пропущенных звонка на визит`, `запись ${pct(A.missedCallBookRate)}`])
  } else skip('missed_calls', monthlyVisits === null ? needVisits : needCheck)

  // ── 3. Missing follow-up after diagnostics ─────────────────────────────────
  const followUpB = byBundle.get('follow_up_diagnostics')
  if (followUpB && avgCheck !== null) {
    add('missing_follow_up', followUpB.target_patient_count * A.followUpDropRate * avgCheck * A.followUpCheckMultiplier,
      `${followUpB.target_patient_count} диагностик × ${pct(A.followUpDropRate)} не дошли × ${checkNote} × ${A.followUpCheckMultiplier}`,
      [`не дошли ${pct(A.followUpDropRate)}`])
  } else if (followUpB) skip('missing_follow_up', needCheck)

  // ── 4. Post-diagnostic drop (churn-risk LTV) ───────────────────────────────
  const s4 = seg.summary.find((x) => x.segment === 'churn_risk')
  if (s4 && s4.total_ltv_kzt > 0) {
    add('post_diagnostic_drop', s4.total_ltv_kzt * A.churnRiskMonthlyLtvShare,
      `${s4.count} пациентов риска оттока × ${pct(A.churnRiskMonthlyLtvShare)} от их LTV ${(s4.total_ltv_kzt / 1_000_000).toFixed(1)} млн ₸`,
      [`${pct(A.churnRiskMonthlyLtvShare)} LTV в месяц`])
  }

  // ── 5. Missing reactivation (sleeping segment) ─────────────────────────────
  const sleeping = seg.summary.find((x) => x.segment === 'sleeping')
  if (sleeping && sleeping.count > 0) {
    if (avgCheck !== null) {
      add('missing_reactivation', sleeping.count * A.reactivationRate * avgCheck * A.reactivationVisits,
        `${sleeping.count} спящих × ${pct(A.reactivationRate)} вернутся × ${checkNote} × ${A.reactivationVisits} визита`,
        [`возврат ${pct(A.reactivationRate)}`, `${A.reactivationVisits} визита`])
    } else skip('missing_reactivation', needCheck)
  }

  // ── 6. Missing chronic control ────────────────────────────────────────────
  const chronicB = byBundle.get('chronic_control')
  if (chronicB && avgCheck !== null) {
    add('missing_chronic_control', chronicB.target_patient_count * A.chronicDropRate * avgCheck * A.chronicCheckMultiplier,
      `${chronicB.target_patient_count} потенциальных хроников × ${pct(A.chronicDropRate)} × ${checkNote} × ${A.chronicCheckMultiplier}`,
      [`выпадают ${pct(A.chronicDropRate)}`])
  } else if (chronicB) skip('missing_chronic_control', needCheck)

  // ── 7. Weak NPS (referral loss) ───────────────────────────────────────────
  if (byBundle.get('nps_referral')) {
    if (monthlyVisits !== null && avgCheck !== null) {
      add('weak_nps', monthlyVisits * A.referralRate * avgCheck * A.referralVisits,
        `${visitsNote} × ${pct(A.referralRate)} рекомендаций × ${checkNote} × ${A.referralVisits}`,
        [`рекомендации ${pct(A.referralRate)}`])
    } else skip('weak_nps', monthlyVisits === null ? needVisits : needCheck)
  }

  // ── 8. Missing seasonal campaigns ─────────────────────────────────────────
  const allBase = seg.totals.total_patients
  if (allBase > 0 && avgCheck !== null) {
    add('missing_seasonal', (allBase * A.seasonalConversion * avgCheck * A.seasonalCheckMultiplier) / A.seasonalEveryMonths,
      `база ${allBase} × ${pct(A.seasonalConversion)} отклик × ${checkNote} × ${A.seasonalCheckMultiplier} / ${A.seasonalEveryMonths} мес`,
      [`отклик ${pct(A.seasonalConversion)}`, `кампания раз в ${A.seasonalEveryMonths} мес`])
  }

  // ── 9. Missing upsell ─────────────────────────────────────────────────────
  if (monthlyVisits !== null && avgCheck !== null) {
    add('missing_upsell', monthlyVisits * A.upsellRate * avgCheck * A.upsellCheckShare,
      `${visitsNote} × ${pct(A.upsellRate)} допродаж × ${pct(A.upsellCheckShare)} от ${checkNote}`,
      [`допродажа ${pct(A.upsellRate)}`, `${pct(A.upsellCheckShare)} чека`])
  } else skip('missing_upsell', monthlyVisits === null ? needVisits : needCheck)

  // ── Ceiling: the estimated total never exceeds a share of the revenue ────
  const capKzt = Math.round(monthlyRevenue * A.maxLossShareOfRevenue)
  const rawTotal = losses.reduce((s, l) => s + l.estimated_loss_kzt, 0)
  const capped = rawTotal > capKzt
  if (capped) {
    const k = capKzt / rawTotal
    for (const l of losses) {
      l.estimated_loss_kzt = Math.floor(l.estimated_loss_kzt * k)
      l.source_data += `. Уменьшено пропорционально: сумма оценок ${kzt(rawTotal)} > потолка ${pct(A.maxLossShareOfRevenue)} выручки`
    }
  }
  for (const l of losses) l.severity = severityOf(l.estimated_loss_kzt, monthlyRevenue)

  losses.sort((a, b) => b.estimated_loss_kzt - a.estimated_loss_kzt)
  const totalLoss = losses.reduce((s, l) => s + l.estimated_loss_kzt, 0)
  const top3 = losses.slice(0, 3)

  const narrative =
    `Оценка-гипотеза потерь: ~${(totalLoss / 1_000_000).toFixed(2)} млн ₸/мес ` +
    `(${pct(totalLoss / monthlyRevenue)} выручки ${revenueNote}). ` +
    (top3.length ? `Крупнейшие: ${top3.map((l) => l.label).join(', ')}. ` : '') +
    `Расчёт опирается на отраслевые допущения (неявки ${pct(A.noShowRate)}, допродажи ${pct(A.upsellRate)} и др.) — ` +
    `уточните их по своим данным${capped ? `; сумма ограничена ${pct(A.maxLossShareOfRevenue)} выручки` : ''}.`

  return {
    status: 'ok',
    losses,
    total_loss_kzt: totalLoss,
    top_3_losses: top3,
    not_estimated: notEstimated,
    cap_kzt: capKzt,
    capped,
    ...base,
    narrative,
  }
}
