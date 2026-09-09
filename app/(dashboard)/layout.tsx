import { Sidebar } from '@/components/layout/Sidebar'
import { Header } from '@/components/layout/Header'
import { MobileNav } from '@/components/layout/MobileNav'
import { DashboardShell } from '@/components/layout/DashboardShell'
import { MascotLauncher } from '@/components/assistant/mascot/MascotLauncher'
import { NotificationsBellSync } from '@/components/notifications/NotificationsBellSync'
import { getCurrentOrgVertical } from '@/lib/vertical'

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  // Resolve from the authenticated profile on the server. This makes the first
  // HTML frame correct and avoids a client-side Store → Clinic navigation flash.
  const verticalContext = await getCurrentOrgVertical()
  const vertical = verticalContext?.vertical ?? 'generic'
  const serverRole = verticalContext?.role ?? 'client'

  return (
    <div className="min-h-screen bg-background flex">
      {/* Sidebar — скрыт на мобильных */}
      <Sidebar vertical={vertical} serverRole={serverRole} />

      {/* Основной контент — отступ динамически реагирует на collapse */}
      <DashboardShell>
        <Header />
        <main className="flex-1 pt-16">
          {/* pb reserves space for the floating assistant FAB (bottom-6) and the
              mobile bottom nav so page action rows never sit under them. */}
          <div className="px-4 md:px-6 lg:px-8 pt-6 pb-28 lg:pb-24 max-w-[1600px] mx-auto">
            {children}
          </div>
        </main>
      </DashboardShell>

      {/* Mobile Bottom Navigation */}
      <MobileNav vertical={vertical} serverRole={serverRole} />

      {/* Floating AI assistant — the mascot «Гри» (falls back to the static
          launcher when NEXT_PUBLIC_FEATURE_MASCOT='0' or on a mascot crash) */}
      <MascotLauncher />

      {/* Keeps the header bell's unread badge in sync with the real feed */}
      <NotificationsBellSync />
    </div>
  )
}
