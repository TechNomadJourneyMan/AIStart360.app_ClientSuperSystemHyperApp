// Legacy /client/dashboard — its content (Point A radar, KPI cards, AI
// analysis, risks, insights, etc.) fully duplicates /client/point-a. Keep
// this route alive as a permanent redirect so existing links / bookmarks
// don't break, but the canonical client landing page is now /client/point-a.

import { redirect } from 'next/navigation'

export const dynamic = 'force-dynamic'

export default function ClientDashboardRedirect() {
  redirect('/client/point-a')
}
