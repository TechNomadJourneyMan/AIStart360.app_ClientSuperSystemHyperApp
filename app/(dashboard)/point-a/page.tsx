export const dynamic = "force-dynamic"

import type { Metadata } from 'next'
import { getSetting } from '@/lib/settings/store'
import PointAV4Page from '@/components/point-a-v4/PointAV4Page'
// The previous page (setting off); its client components load only when it is shown (W4).
import PointALegacyPage from '@/components/point-a/legacy/PointALegacyPage'

export const metadata: Metadata = { title: 'Точка А — Текущее состояние' }

export default async function PointAPage() {
  // One Point A (spec 2026-10-12 §4): with point_a_v4 on (default) this is the
  // new page, inside the cabinet's own layout (staff keep their navigation).
  if (await getSetting('point_a_v4').catch(() => true)) return <PointAV4Page />
  return <PointALegacyPage />
}
