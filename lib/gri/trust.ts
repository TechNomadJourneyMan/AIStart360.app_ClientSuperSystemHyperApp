/**
 * lib/gri/trust.ts — "Доверие к данным" (data confidence).
 *
 * The honest companion to removing the hardcoded trustScore (lib/gri/logic.ts):
 * instead of faking a trust *score*, we tell the user how much to trust their
 * own diagnosis given how complete their data is. Pure and deterministic; the
 * signals are gathered by the API layer from real sources (survey completion,
 * financials, documents, CRM, metrics, GRI history, market confirmations).
 * See docs/SPEC-2026-07-09-AI-FEATURES/03-trust-methodology.md §B2.
 */

export interface TrustSignals {
  /** Survey completion 0..1, or null if unknown. */
  surveyCompletion: number | null
  hasFinancials: boolean
  /** Financials internally consistent, or null if not evaluated. */
  financialsConsistent: boolean | null
  documentsCount: number
  hasCrm: boolean
  hasMetrics: boolean
  griHistoryCount: number
  /** Age of the current assessment in days, or null. */
  dataFreshnessDays: number | null
  marketConfirmedCount: number
}

export interface DataConfidence {
  /** 0–100. */
  score: number
  level: 'low' | 'medium' | 'high'
  /** Human-readable categories the user could fill to raise confidence. */
  missing: string[]
}

const WEIGHTS = {
  completion: 0.3,
  financials: 0.2,
  consistency: 0.1,
  documents: 0.1,
  crm: 0.1,
  metrics: 0.05,
  history: 0.05,
  freshness: 0.05,
  market: 0.05,
} as const

function freshnessValue(days: number | null): number {
  if (days == null) return 0
  if (days <= 90) return 1
  return Math.max(0, 1 - (days - 90) / 180)
}

/**
 * Data-confidence score, or `null` when there is too little to honestly assess
 * (fewer than 3 signals present). Never fabricates a number from thin air.
 */
export function computeDataConfidence(s: TrustSignals): DataConfidence | null {
  const present = [
    s.surveyCompletion != null,
    s.hasFinancials,
    s.financialsConsistent != null,
    s.documentsCount > 0,
    s.hasCrm,
    s.hasMetrics,
    s.griHistoryCount > 0,
    s.dataFreshnessDays != null,
    s.marketConfirmedCount > 0,
  ].filter(Boolean).length

  if (present < 3) return null

  const contributions =
    WEIGHTS.completion * (s.surveyCompletion ?? 0) +
    WEIGHTS.financials * (s.hasFinancials ? 1 : 0) +
    WEIGHTS.consistency * (s.financialsConsistent ? 1 : 0) +
    WEIGHTS.documents * Math.min(s.documentsCount / 3, 1) +
    WEIGHTS.crm * (s.hasCrm ? 1 : 0) +
    WEIGHTS.metrics * (s.hasMetrics ? 1 : 0) +
    WEIGHTS.history * Math.min(s.griHistoryCount / 3, 1) +
    WEIGHTS.freshness * freshnessValue(s.dataFreshnessDays) +
    WEIGHTS.market * Math.min(s.marketConfirmedCount / 5, 1)

  const score = Math.round(contributions * 100)
  const level = score >= 67 ? 'high' : score >= 34 ? 'medium' : 'low'

  const missing: string[] = []
  if (s.surveyCompletion == null || s.surveyCompletion < 0.8) missing.push('Полнота анкеты')
  if (!s.hasFinancials) missing.push('Финансовые данные')
  if (s.documentsCount <= 0) missing.push('Документы')
  if (!s.hasCrm) missing.push('CRM')
  if (!s.hasMetrics) missing.push('Метрики')
  if (s.griHistoryCount <= 0) missing.push('История GRI')
  if (s.marketConfirmedCount <= 0) missing.push('Рыночные данные')

  return { score, level, missing }
}
