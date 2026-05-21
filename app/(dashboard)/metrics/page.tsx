export const dynamic = 'force-dynamic'

import type { Metadata } from 'next'
import { cookies } from 'next/headers'
import { auth } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import MetricsPageClient from '@/components/metrics/MetricsPageClient'
import { loadMetricsPageData } from '@/lib/metrics/page-data'

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
  // Resolve userId from ALL auth sources (mirrors point-a/page.tsx)
  const session = await auth()
  const cookieStore = await cookies()
  const staffUserId = cookieStore.get('aistart360_user_id')?.value ?? null

  let supabaseUserId: string | null = null
  try {
    const supabase = await createClient()
    const { data: { user: sbUser } } = await supabase.auth.getUser()
    supabaseUserId = sbUser?.id ?? null
  } catch {
    // Supabase auth not available — fall back
  }

  const userId =
    staffUserId ?? supabaseUserId ?? (session?.user?.id ?? null)

  const pageData = await loadMetricsPageData(userId)

  return (
    <MetricsPageClient
      userId={pageData.userId}
      griAssessment={pageData.griAssessment}
      company={pageData.company}
      surveyAnswers={pageData.surveyAnswers}
    />
  )
}
