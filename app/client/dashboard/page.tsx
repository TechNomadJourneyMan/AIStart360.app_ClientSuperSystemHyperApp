// Legacy /client/dashboard stays alive for old links and bookmarks. The shared
// /dashboard route is the canonical client cabinet with the complete sidebar,
// Point A intelligence and the rest of the enabled modules.

import { redirect } from 'next/navigation'
import { CLIENT_DASHBOARD_PATH } from '@/lib/role-landing'

export const dynamic = 'force-dynamic'

export default function ClientDashboardRedirect() {
  redirect(CLIENT_DASHBOARD_PATH)
}
