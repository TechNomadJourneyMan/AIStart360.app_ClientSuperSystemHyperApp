/**
 * diagnostics-bridge.ts
 *
 * Maps medical-pipeline outputs (patient_segments, revenue_losses, growth_bundles, totals)
 * → diagnostics row with 5 block scores: finance / sales / marketing / operations / strategy.
 *
 * Goal: so the generic /dashboard (which reads diagnostics) shows live Точка А
 * scores derived from uploaded files, instead of forcing the user to fill the
 * separate generic anketa.
 *
 * Scoring scale per block: 0–10. overall_score is the average × 10 (0–100).
 */

import { randomUUID } from 'node:crypto'

export interface SegmentRow {
  monetary_kzt: number
  frequency: number
  recency_days: number
  segment: string
}

export interface LossRow {
  estimated_loss_kzt: number
  severity: 'critical' | 'high' | 'medium' | 'low'
}

export interface BundleRow {
  estimated_revenue_kzt: number
  target_patient_count: number
}

export interface BlockScore {
  score: number
  status: 'critical' | 'weak' | 'developing' | 'strong'
  top_issues: string[]
  recommendations: string[]
}

export interface DiagnosticsRow {
  id: string
  user_id: string
  company_id: string | null
  version: number
  overall_score: number
  health_index: number
  stage: 'seed' | 'growth' | 'scale' | 'mature'
  finance_score: BlockScore
  sales_score: BlockScore
  marketing_score: BlockScore
  operations_score: BlockScore
  strategy_score: BlockScore
  risks: string[]
  insights: string[]
  quick_wins: string[]
  data_gaps: string[]
  is_current: boolean
  calculated_at: string
}

function classify(score: number): BlockScore['status'] {
  if (score < 3) return 'critical'
  if (score < 5) return 'weak'
  if (score < 7) return 'developing'
  return 'strong'
}

export interface BridgeInput {
  userId: string
  companyId: string | null
  segments: SegmentRow[]
  losses: LossRow[]
  bundles: BundleRow[]
}

export function computeMedicalDiagnostics(input: BridgeInput): DiagnosticsRow {
  const { userId, companyId, segments, losses, bundles } = input

  const totalPatients = segments.length
  const totalLtv = segments.reduce((s, p) => s + (p.monetary_kzt || 0), 0)
  const withRevenue = segments.filter((p) => (p.monetary_kzt || 0) > 0)
  const avgCheck = withRevenue.length > 0
    ? Math.round(withRevenue.reduce((s, p) => s + p.monetary_kzt / Math.max(1, p.frequency), 0) / withRevenue.length)
    : 0
  const activeLast90 = segments.filter((p) => p.recency_days <= 90).length
  const newPatients = segments.filter((s) => s.segment === 'new').length
  const vipPatients = segments.filter((s) => s.segment === 'vip_retention' || s.segment === 'vip_reactivation').length
  const sleepingPatients = segments.filter((s) => p_seg_is_sleeping(s.segment)).length

  const totalLossKzt = losses.reduce((s, l) => s + (l.estimated_loss_kzt || 0), 0)
  const recoveryPotential = bundles.reduce((s, b) => s + (b.estimated_revenue_kzt || 0), 0)

  // ─── Финансы ─────────────────────────────────────────────────────────────
  const lossRatio = totalLtv > 0 ? totalLossKzt / totalLtv : 1
  const financeBase =
    lossRatio < 0.05 ? 9 :
    lossRatio < 0.15 ? 7 :
    lossRatio < 0.30 ? 5 :
    lossRatio < 0.50 ? 3 : 1
  const financeScore = +Math.max(0, Math.min(10, financeBase)).toFixed(1)

  // ─── Продажи (retention proxy) ──────────────────────────────────────────
  const retention = totalPatients > 0 ? activeLast90 / totalPatients : 0
  const salesBase =
    retention >= 0.5 ? 9 :
    retention >= 0.35 ? 7 :
    retention >= 0.20 ? 5 :
    retention >= 0.10 ? 3 : 1
  const salesScore = +Math.max(0, Math.min(10, salesBase)).toFixed(1)

  // ─── Маркетинг (acquisition + base composition) ─────────────────────────
  const newRatio = totalPatients > 0 ? newPatients / totalPatients : 0
  const vipShare = totalPatients > 0 ? vipPatients / totalPatients : 0
  // Healthy clinic: ~10-20% new, ~5-15% VIP. Score combines both.
  const marketingBase = Math.round(Math.min(10, (newRatio * 25) + (vipShare * 50)))
  const marketingScore = +Math.max(0, Math.min(10, marketingBase)).toFixed(1)

  // ─── Операции (data quality from segments) ──────────────────────────────
  const withFrequencyAndMoney = segments.filter((p) => (p.frequency ?? 0) > 0 && (p.monetary_kzt ?? 0) > 0).length
  const dataQuality = totalPatients > 0 ? withFrequencyAndMoney / totalPatients : 0
  const operationsBase =
    dataQuality >= 0.9 ? 9 :
    dataQuality >= 0.75 ? 7 :
    dataQuality >= 0.50 ? 5 :
    dataQuality >= 0.30 ? 3 : 1
  const operationsScore = +Math.max(0, Math.min(10, operationsBase)).toFixed(1)

  // ─── Стратегия (recovery potential vs current revenue) ──────────────────
  const recoveryRatio = totalLtv > 0 ? recoveryPotential / totalLtv : 0
  const strategyBase =
    recoveryRatio >= 0.5 ? 9 :
    recoveryRatio >= 0.25 ? 7 :
    recoveryRatio >= 0.10 ? 5 :
    recoveryRatio >= 0.05 ? 3 : 2
  const strategyScore = +Math.max(0, Math.min(10, strategyBase)).toFixed(1)

  // ─── Overall ────────────────────────────────────────────────────────────
  const avgBlock = (financeScore + salesScore + marketingScore + operationsScore + strategyScore) / 5
  const overallScore = +(avgBlock * 10).toFixed(2)            // 0–100
  const healthIndex = +avgBlock.toFixed(2)                     // 0–10

  // Stage heuristic by LTV scale
  const stage: DiagnosticsRow['stage'] =
    totalLtv >= 500_000_000 ? 'mature' :
    totalLtv >= 100_000_000 ? 'scale' :
    totalLtv >= 20_000_000  ? 'growth' : 'seed'

  // ─── Issues/recommendations per block ───────────────────────────────────
  const blockIssue = (label: string, val: number, threshold: string) => `${label}: ${threshold}`

  const finance: BlockScore = {
    score: financeScore,
    status: classify(financeScore),
    top_issues: [
      `Потери выручки: ${(lossRatio * 100).toFixed(0)}% от LTV (≈ ${Math.round(totalLossKzt / 1_000_000)}M ₸)`,
      avgCheck < 5000 ? 'Низкий средний чек' : `Средний чек: ${avgCheck.toLocaleString('ru-RU')} ₸`,
    ].filter(Boolean) as string[],
    recommendations: [
      'Запустить топ-3 связки роста выручки',
      'Сократить топ-3 источника потерь по карте audit',
    ],
  }

  const sales: BlockScore = {
    score: salesScore,
    status: classify(salesScore),
    top_issues: [
      `Активные за 90 дней: ${(retention * 100).toFixed(0)}% базы`,
      sleepingPatients > 0 ? `Спящие: ${sleepingPatients} пациентов без визита 90+ дней` : '',
    ].filter(Boolean) as string[],
    recommendations: [
      'WhatsApp реактивация спящих (см. сценарии)',
      'Follow-up после первого визита (24 часа)',
    ],
  }

  const marketing: BlockScore = {
    score: marketingScore,
    status: classify(marketingScore),
    top_issues: [
      `Новые пациенты: ${(newRatio * 100).toFixed(0)}% базы (рекомендуется 10-20%)`,
      `VIP сегмент: ${(vipShare * 100).toFixed(0)}% (рекомендуется 5-15%)`,
    ],
    recommendations: [
      'Запустить реферальную программу для VIP',
      'Тест 2-3 каналов привлечения новых',
    ],
  }

  const operations: BlockScore = {
    score: operationsScore,
    status: classify(operationsScore),
    top_issues: [
      `Качество данных: ${(dataQuality * 100).toFixed(0)}% записей полные`,
      dataQuality < 0.8 ? 'Многие записи без сумм или частоты визитов' : '',
    ].filter(Boolean) as string[],
    recommendations: [
      'Обновить регламент заполнения CRM',
      'Автоматизировать сбор контактов на ресепшене',
    ],
  }

  const strategy: BlockScore = {
    score: strategyScore,
    status: classify(strategyScore),
    top_issues: [
      `Потенциал восстановления: ${Math.round(recoveryPotential / 1_000_000)}M ₸ (${(recoveryRatio * 100).toFixed(0)}% от LTV)`,
      bundles.length === 0 ? 'Связки роста не сгенерированы' : '',
    ].filter(Boolean) as string[],
    recommendations: [
      `Внедрить ${bundles.length} AI-связок поэтапно`,
      'Пересчитывать стратегию ежемесячно',
    ],
  }

  // ─── Top-level aggregates ───────────────────────────────────────────────
  const risks: string[] = []
  if (financeScore < 4) risks.push(`Финансовые потери ${(lossRatio * 100).toFixed(0)}% — критический уровень`)
  if (salesScore < 4) risks.push(`Низкое удержание (${(retention * 100).toFixed(0)}% активных)`)
  if (dataQuality < 0.5) risks.push('Низкое качество данных мешает дальнейшему анализу')

  const insights: string[] = []
  if (vipPatients > 0) insights.push(`${vipPatients} VIP-пациентов формируют значительную долю выручки`)
  if (recoveryRatio >= 0.15) insights.push(`Потенциал восстановления ${(recoveryRatio * 100).toFixed(0)}% выручки`)
  if (newRatio < 0.05) insights.push('Малый приток новых пациентов — узкое место роста')

  const quickWins: string[] = []
  if (sleepingPatients > 50) quickWins.push(`WhatsApp кампания на спящих (${sleepingPatients} человек)`)
  if (vipShare > 0.05) quickWins.push('Реферальная программа для VIP сегмента')
  if (avgCheck > 0 && avgCheck < 10_000) quickWins.push('Upsell на дополнительные процедуры для роста чека')

  const dataGaps: string[] = []
  if (dataQuality < 0.75) dataGaps.push('Записи без сумм/частоты визитов — требуется чистка базы')
  if (totalPatients < 100) dataGaps.push('Малая выборка — выводы пока статистически слабые')

  return {
    id: randomUUID(),
    user_id: userId,
    company_id: companyId,
    version: 1,
    overall_score: overallScore,
    health_index: healthIndex,
    stage,
    finance_score: finance,
    sales_score: sales,
    marketing_score: marketing,
    operations_score: operations,
    strategy_score: strategy,
    risks,
    insights,
    quick_wins: quickWins,
    data_gaps: dataGaps,
    is_current: true,
    calculated_at: new Date().toISOString(),
  }
}

function p_seg_is_sleeping(segment: string): boolean {
  return segment === 'sleeping' || segment === 'churn_risk' || segment === 'lapsed' || segment === 'dormant'
}
