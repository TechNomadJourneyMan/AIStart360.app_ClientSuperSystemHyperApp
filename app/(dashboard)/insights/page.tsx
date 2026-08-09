export const dynamic = "force-dynamic"

import type { Metadata } from 'next'

import { InsightsClient } from '@/components/insights/InsightsClient'

export const metadata: Metadata = { title: 'Инсайты' }

/**
 * Thin shell. The feed, its counts and its empty state all come from
 * /api/v1/point-a/insights at runtime — the page no longer reads
 * `prisma.griReport`, whose aggregates were computed off a legacy table that is
 * empty in production (docs/SESSION-HANDOFF-2026-06-15.md:51) and rendered as
 * if they were live metrics.
 */
export default function InsightsPage() {
  return <InsightsClient />
}
