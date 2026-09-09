import type { Metadata } from 'next'
import MedicalDashboardPage from '@/app/client/dashboard-medical/page'

export const metadata: Metadata = {
  title: 'Клиника | AIStart360',
}

/**
 * Shared-shell entry point for the medical vertical.
 *
 * The legacy /client/dashboard-medical page remains available for old links,
 * while all current navigation lands here so Sidebar, Header and MobileNav do
 * not disappear after the user opens their clinic cabinet.
 */
export default function ClinicDashboardPage() {
  return (
    <div className="-mx-4 -mt-6 md:-mx-6 lg:-mx-8 [&>div]:min-h-[calc(100vh-4rem)] [&_header]:top-16">
      <MedicalDashboardPage />
    </div>
  )
}
