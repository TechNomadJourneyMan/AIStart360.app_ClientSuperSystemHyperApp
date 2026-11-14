export const dynamic = 'force-dynamic'

import type { Metadata } from 'next'
import { getRequestUser } from '@/lib/request-user'
import MetricsPageClient from '@/components/metrics/MetricsPageClient'
import { loadMetricsPageData } from '@/lib/metrics/page-data'
import { OnboardingStatusBadges } from '@/components/dashboard/OnboardingStatusBadges'
import { getRequestAccess } from '@/lib/access/request-access'

/**
 * R2-A (ревью H-3): the GRI tab is the full GRI — a paid section. Closed → the
 * row is not read (the page reads with the service role) and the tab shows the
 * paywall. A failed decision counts as closed here: the data is read on the server.
 */
async function griOpen(userId: string | null): Promise<boolean> {
  if (!userId) return false
  try {
    return (await getRequestAccess(userId)).sections.gri_full
  } catch (err) {
    console.error('[metrics] access decision failed — GRI tab closed:', err instanceof Error ? err.message : err)
    return false
  }
}

export const metadata: Metadata = { title: 'Метрики — AIStart360' }

/**
 * /metrics — full system of metrics for the current user.
 *
 * All data is live + realtime-synced:
 *   - GRI Score / 7 blocks / insights ← public.gri_assessments (latest is_current)
 *   - Goals tab                       ← public.companies.target_revenue_*_kzt
 *                                       + survey s6_goal_12months / s6_goal_3years
 *   - KPI tab                         ← survey answers + company targets
 *   - Biz tab + header catalog        ← public.metrics (via metrics resolver)
 *
 * Realtime invalidation runs client-side via useRealtimeSync on the four
 * watched tables, calling router.refresh() on each event (debounced 250ms).
 */
export default async function MetricsPage() {
  // Identity from the Supabase session only (forgeable staff cookie removed —
  // it enabled cross-user data reads / IDOR). Audit 2026-07-02.
  let supabaseUserId: string | null = null
  try {
    // Verified user, shared with the cabinet layout (one Auth round trip per render).
    const sbUser = await getRequestUser()
    supabaseUserId = sbUser?.id ?? null
  } catch {
    // Supabase auth not available
  }

  const userId = supabaseUserId

  const includeGri = await griOpen(userId)
  const pageData = await loadMetricsPageData(userId, { includeGri })

  return (
    <>
      <div className="flex items-center justify-end gap-2 px-4 pt-4">
        <OnboardingStatusBadges />
      </div>
      <MetricsPageClient
        userId={pageData.userId}
        griAssessment={pageData.griAssessment}
        company={pageData.company}
        surveyAnswers={pageData.surveyAnswers}
        griLocked={!includeGri}
      />
    </>
  )
}
