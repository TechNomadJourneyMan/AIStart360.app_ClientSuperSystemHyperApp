'use client'

/**
 * components/access/UpgradeGate.tsx — kept for its callers (GRIAssessment, …).
 * Round 2 (R2-A): it is the ONE paywall (components/access/Paywall.tsx) — the
 * same copy, the same honest note about payment and the same request
 * «Оставить заявку на доступ» (one open request per user). The old link to
 * «Посмотреть тарифы» led to a billing page without payment (intentional stub).
 */
import Paywall from './Paywall'

export function UpgradeGate({ feature, compact = false }: { feature: string; compact?: boolean }) {
  return <Paywall feature={feature} variant={compact ? 'compact' : 'page'} />
}
