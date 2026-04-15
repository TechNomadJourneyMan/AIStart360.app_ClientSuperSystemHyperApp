export const dynamic = 'force-dynamic'

import type { Metadata } from 'next'
import { MarketPortal } from '@/components/market/MarketPortal'

export const metadata: Metadata = { title: 'Market Intelligence' }

/**
 * /market — Market Intelligence Portal.
 *
 * The outer DashboardShell enforces authentication, so this page is just a
 * thin wrapper that mounts the client-side tabbed portal. Data currently
 * comes from static mock fixtures in components/market/mock-data.ts;
 * TODO(supabase) comments in each view mark the integration points.
 */
export default function MarketPage() {
  return <MarketPortal />
}
