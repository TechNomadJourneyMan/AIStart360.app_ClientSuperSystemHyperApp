export const dynamic = "force-dynamic"

import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { getSetting } from '@/lib/settings/store'
import PointAV4Page from '@/components/point-a-v4/PointAV4Page'
// The previous page (setting off); its client components load only when it is shown (W4).
import PointALegacyPage from '@/components/point-a/legacy/PointALegacyPage'
// Round 2 (R2-A): paid section — the same gate as /client/point-a and the API (402).
import FeatureGate from '@/components/access/FeatureGate'
import { isClientForPointB } from '@/components/point-b/pointBAccess'
import { getRequestUser } from '@/lib/request-user'
import { createServerClient } from '@/lib/supabase-server'
import { getSessionRole } from '@/lib/api-identity'
import { hrefWithQuery } from '@/lib/client-shell/nav'

export const metadata: Metadata = { title: 'Точка А — Текущее состояние' }

export default async function PointAPage({ searchParams }: { searchParams?: Record<string, string | string[] | undefined> }) {
  // R-094: a client has ONE Point A — the cabinet's (`/client/point-a`, the same
  // paywall and the same menu), as with /point-b. This shell version is for
  // staff (never gated). Same rule as /point-b: anyone who is not staff.
  const user = await getRequestUser()
  if (user && isClientForPointB(await getSessionRole(createServerClient(), user.id))) {
    redirect(hrefWithQuery('/client/point-a', searchParams))
  }
  // One Point A (spec 2026-10-12 §4): with point_a_v4 on (default) this is the
  // new page, inside the cabinet's own layout (staff keep their navigation).
  const v4 = await getSetting('point_a_v4').catch(() => true)
  return <FeatureGate feature="point_a" wrapperClassName="px-4 py-6">{v4 ? <PointAV4Page /> : <PointALegacyPage />}</FeatureGate>
}
