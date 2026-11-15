'use client'

/**
 * components/point-b/PointBPaywall.tsx — the Point B placeholder used by the
 * client-side gates of Point B (PointBAccessGate, the container and the tabs on
 * a 402). Round 2 (R2-A): it is the ONE paywall of the platform
 * (components/access/Paywall.tsx) for the section «Точка Б» — same copy, same
 * request («Оставить заявку на доступ», one open request per user).
 * Draws no client data and makes no data request.
 */
import Paywall from '@/components/access/Paywall'

export default function PointBPaywall() {
  return <Paywall feature="point_b" />
}
