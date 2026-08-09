// This route used to render a partially survey-backed dashboard mixed with
// hard-coded ecommerce KPIs. Keep the URL for old bookmarks, but always send
// clients to the canonical dashboard where every value has provenance.

import { redirect } from 'next/navigation'
import { CLIENT_DASHBOARD_PATH } from '@/lib/role-landing'

export const dynamic = 'force-dynamic'

export default function EcommerceDashboardRedirect() {
  redirect(CLIENT_DASHBOARD_PATH)
}
