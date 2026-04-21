// 9 growth bundles for clinic vertical. Metadata + per-clinic revenue calc.
// Target numbers calibrated on Sau Zhurek — when applied to another clinic
// the potential_kzt scales by that clinic's own segment sizes and check.
//
// Sau Zhurek baseline (from Start_Sau_Zhurek_Clinic_Strategy.docx):
//   Total potential: ₸10.985M/мес additional revenue across 9 bundles

import type { PatientSegmentId, SegmentationResult } from '@/lib/rfm-segmentation'

export type BundleKey =
  | 'no_show'
  | 'cross_sell_after_ekg'
  | 'follow_up_diagnostics'
  | 'reactivation'
  | 'nps_referral'
  | 'instant_callback'
  | 'upsell_at_booking'
  | 'seasonal_campaigns'
  | 'chronic_control'

export type BundleComplexity = 'easy' | 'medium' | 'hard'

export interface BundleTemplate {
  key: BundleKey
  label: string
  /** Which RFM segments are touched by this bundle */
  target_segments: PatientSegmentId[]
  trigger_description: string
  script_preview: string
  /** Bundle mechanics — used for per-clinic revenue estimation */
  conversion_pct: number      // expected conversion of target segment
  /** Multiplier of clinic's avg_check_kzt applied to target count */
  check_multiplier: number
  complexity: BundleComplexity
  effect_timeline: string     // '24–48h' | '3–7d' | '2–4w' | etc
}

export const BUNDLE_TEMPLATES: Record<BundleKey, BundleTemplate> = {
  no_show: {
    key: 'no_show',
    label: 'Подтверждение записи (no-show защита)',
    target_segments: ['vip_retention', 'loyal_active', 'churn_risk', 'one_time_fresh'],
    trigger_description: 'Пациент записался → цепочка подтверждений за 48ч/24ч/2ч/no-show',
    script_preview:
      '«{Имя}, ваш приём у кардиолога в {клинике} — {дата}, {время}. Нажмите ✅ приду / 🔄 перенести»',
    conversion_pct: 22,   // фактически — снижение no-show с 30% до 8% = 22pp экономии
    check_multiplier: 1.0,
    complexity: 'easy',
    effect_timeline: '24–48h',
  },
  cross_sell_after_ekg: {
    key: 'cross_sell_after_ekg',
    label: 'Cross-sell после ЭКГ',
    target_segments: ['loyal_active', 'churn_risk', 'one_time_fresh'],
    trigger_description: 'Через 30–60 мин после результата ЭКГ — предложение консультации кардиолога',
    script_preview:
      '«{Имя}, ваша ЭКГ готова. Врач рекомендует обсудить результат — 15 мин, сегодня в 14:30 или 16:00»',
    conversion_pct: 65,
    check_multiplier: 1.0,
    complexity: 'easy',
    effect_timeline: '3–7d',
  },
  follow_up_diagnostics: {
    key: 'follow_up_diagnostics',
    label: 'Follow-up после Холтера / СМАД / УЗИ',
    target_segments: ['loyal_active', 'churn_risk', 'vip_retention'],
    trigger_description: 'Через 24ч после готовности диагностики — запись к профильному врачу',
    script_preview:
      '«{Имя}, результаты {исследования} готовы. Доктор {ФИО} изучил — есть важные моменты. Когда удобно?»',
    conversion_pct: 70,
    check_multiplier: 1.2,
    complexity: 'easy',
    effect_timeline: '3–7d',
  },
  reactivation: {
    key: 'reactivation',
    label: 'Реактивация спящей базы (60+ / 90+ дней)',
    target_segments: ['churn_risk', 'sleeping', 'vip_reactivation'],
    trigger_description: 'Пациент не был 60+ дней → персонализированный повод вернуться',
    script_preview:
      '«{Имя}, добрый день! Вы были у нас {дата}. Прошло {N} дней — врач рекомендовал контрольный осмотр»',
    conversion_pct: 20,
    check_multiplier: 1.0,
    complexity: 'medium',
    effect_timeline: '2–4w',
  },
  nps_referral: {
    key: 'nps_referral',
    label: 'NPS + реферальная программа',
    target_segments: ['vip_retention', 'loyal_active', 'one_time_fresh'],
    trigger_description: 'Через 1ч после визита → NPS. Позитив → реферал. Негатив → админу',
    script_preview:
      '«{Имя}, как прошло? Оцените 1–5. Если 4–5 — поделитесь с знакомыми, им скидка 10%»',
    conversion_pct: 5,   // конверсия в реферал
    check_multiplier: 1.0,
    complexity: 'medium',
    effect_timeline: '1–2m',
  },
  instant_callback: {
    key: 'instant_callback',
    label: 'Мгновенный callback (60 сек)',
    target_segments: ['dead_lead', 'one_time_old'],
    trigger_description: 'Пропущенный входящий → автоматический перезвон через 60 сек',
    script_preview:
      '«Здравствуйте! Вы звонили в {клинике}. Чем могу помочь? Записать к врачу или другой вопрос?»',
    conversion_pct: 65,
    check_multiplier: 1.0,
    complexity: 'easy',
    effect_timeline: '24–48h',
  },
  upsell_at_booking: {
    key: 'upsell_at_booking',
    label: 'Upsell при подтверждении записи',
    target_segments: ['loyal_active', 'churn_risk', 'one_time_fresh', 'vip_retention'],
    trigger_description: 'Пациент подтвердил запись → предложение комплексного пакета',
    script_preview:
      '«{Имя}, к вашей ЭКГ добавим консультацию + расшифровку — 11 000 ₸ вместо 13 500. Оформить?»',
    conversion_pct: 35,
    check_multiplier: 0.25,   // средний чек вырастает на 25%
    complexity: 'easy',
    effect_timeline: '1–2w',
  },
  seasonal_campaigns: {
    key: 'seasonal_campaigns',
    label: 'Сезонные кампании (Октябрь, НГ, 14 февраля, 1 сентября)',
    target_segments: ['sleeping', 'one_time_old', 'churn_risk', 'dead_lead'],
    trigger_description: '2–4 раза в год массовая кампания по всей базе',
    script_preview:
      '«Октябрь — Месяц сердца. ЭКГ + кардиолог за 10 000 ₸ (−25%). До 31 октября. Записать?»',
    conversion_pct: 12,
    check_multiplier: 1.2,
    complexity: 'medium',
    effect_timeline: 'плановый',
  },
  chronic_control: {
    key: 'chronic_control',
    label: 'Профилактический контроль для хроников',
    target_segments: ['vip_retention', 'loyal_active'],
    trigger_description: 'Хроники (АГ, ХСН, аритмии) — напоминания о квартальном контроле',
    script_preview:
      '«{Имя}, 3 месяца с последнего визита. Доктор рекомендовал контроль — запишем на этой неделе?»',
    conversion_pct: 40,
    check_multiplier: 1.2,
    complexity: 'medium',
    effect_timeline: '1–3m',
  },
}

export const BUNDLE_ORDER: BundleKey[] = [
  'no_show',
  'instant_callback',        // easy + high potential
  'cross_sell_after_ekg',
  'follow_up_diagnostics',
  'upsell_at_booking',
  'reactivation',
  'nps_referral',
  'chronic_control',
  'seasonal_campaigns',
]

export interface BundleCalculation {
  key: BundleKey
  label: string
  target_patient_count: number
  estimated_conversion: number   // 0..100
  estimated_revenue_kzt: number  // per month
  priority: number
  complexity: BundleComplexity
  effect_timeline: string
  trigger_description: string
  script_preview: string
  target_segments: PatientSegmentId[]
}

/**
 * Compute per-clinic bundle potentials from a SegmentationResult.
 * Returns 9 bundles sorted by priority (descending revenue).
 */
export function computeBundles(seg: SegmentationResult): BundleCalculation[] {
  const calcs: BundleCalculation[] = []
  const avgCheck = seg.totals.avg_check_kzt || 10_000   // sensible fallback

  for (const key of BUNDLE_ORDER) {
    const t = BUNDLE_TEMPLATES[key]
    const targetCount = t.target_segments.reduce((sum, s) => {
      const bucket = seg.summary.find((x) => x.segment === s)
      return sum + (bucket?.count ?? 0)
    }, 0)
    const estRevenue = Math.round(
      targetCount * (t.conversion_pct / 100) * avgCheck * t.check_multiplier,
    )
    calcs.push({
      key,
      label: t.label,
      target_patient_count: targetCount,
      estimated_conversion: t.conversion_pct,
      estimated_revenue_kzt: estRevenue,
      priority: 0, // filled after sort
      complexity: t.complexity,
      effect_timeline: t.effect_timeline,
      trigger_description: t.trigger_description,
      script_preview: t.script_preview,
      target_segments: t.target_segments,
    })
  }

  // Sort by revenue desc, assign priority 1..9
  calcs.sort((a, b) => b.estimated_revenue_kzt - a.estimated_revenue_kzt)
  calcs.forEach((c, i) => { c.priority = i + 1 })
  return calcs
}
