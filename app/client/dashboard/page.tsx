// Legacy /client/dashboard — kept alive as a redirect so existing links and
// bookmarks don't break. The canonical client landing page is /client/home
// (User Assessment Dashboard); the detailed diagnostics stay at /client/point-a.

import { redirect } from 'next/navigation'

export const dynamic = 'force-dynamic'

export default function ClientDashboardRedirect() {
  redirect('/client/home')
}
