import type { ReactNode } from 'react'
import FeatureGate from '@/components/access/FeatureGate'

/**
 * /client/point-b — the paid section Точка Б (Round 2, R2-A). The page is a
 * client component; the server gate sits in this layout so a closed account
 * gets the one paywall straight from the server (no loading flash, no data
 * request). PointBAccessGate inside the page stays as the fallback for a
 * switch turned on after the page was loaded (the API answers 402).
 */
export default function ClientPointBLayout({ children }: { children: ReactNode }) {
  return <FeatureGate feature="point_b">{children}</FeatureGate>
}
