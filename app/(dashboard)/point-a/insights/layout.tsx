import type { ReactNode } from 'react'
import FeatureGate from '@/components/access/FeatureGate'

/**
 * /point-a/insights (and /client/point-a/insights, which redirects here) — part
 * of the paid section Точка А (Round 2, R2-A). The page is a client component,
 * so the server gate sits in this layout: closed → the one paywall, the feed is
 * not mounted (its API /api/v1/point-a/insights answers 402 the same way).
 */
export default function PointAInsightsLayout({ children }: { children: ReactNode }) {
  return <FeatureGate feature="point_a" wrapperClassName="px-4 py-6">{children}</FeatureGate>
}
