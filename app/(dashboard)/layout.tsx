import ActivityTracker from '@/components/analytics/ActivityTracker'
import ImpersonationBanner from '@/components/impersonation/ImpersonationBanner'
import { Sidebar } from '@/components/layout/Sidebar'
import { Header } from '@/components/layout/Header'
import { MobileNav } from '@/components/layout/MobileNav'
import { DashboardShell } from '@/components/layout/DashboardShell'
import { MascotLauncher } from '@/components/assistant/mascot/MascotLauncher'
import { NotificationsBellSync } from '@/components/notifications/NotificationsBellSync'
import AnnouncementBar from '@/components/platform/AnnouncementBar'
import { PlatformSectionsProvider } from '@/hooks/usePlatformSections'
import { createServerClient } from '@/lib/supabase-server'
import { visibleSectionsFor } from '@/lib/platform/sections'

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  // Sections switched off in GIGA-CRM are filtered out of the menu on the
  // server, so nothing flashes in before the client fetch returns.
  const { data: auth } = await createServerClient().auth.getUser()
  const { sections, hiddenPaths } = await visibleSectionsFor(auth?.user?.id ?? null)
  const initial = { sections: sections.map((s) => ({ key: s.key, title: s.title, description: s.description, icon: s.icon, href: s.nav_href })), hiddenPaths }

  return (
    <PlatformSectionsProvider initial={initial}>
    <div className="min-h-screen bg-background flex">
      <ActivityTracker />
      <ImpersonationBanner />
      {/* Sidebar — скрыт на мобильных */}
      <Sidebar />

      {/* Основной контент — отступ динамически реагирует на collapse */}
      <DashboardShell>
        <Header />
        <main className="flex-1 pt-16">
          {/* pb reserves space for the floating assistant FAB (bottom-6) and the
              mobile bottom nav so page action rows never sit under them. */}
          <div className="px-4 md:px-6 lg:px-8 pt-6 pb-28 lg:pb-24 max-w-[1600px] mx-auto">
            <AnnouncementBar className="mb-4" />
            {children}
          </div>
        </main>
      </DashboardShell>

      {/* Mobile Bottom Navigation */}
      <MobileNav />

      {/* Floating AI assistant — the mascot «Гри» (falls back to the static
          launcher when NEXT_PUBLIC_FEATURE_MASCOT='0' or on a mascot crash) */}
      <MascotLauncher />

      {/* Keeps the header bell's unread badge in sync with the real feed */}
      <NotificationsBellSync />
    </div>
    </PlatformSectionsProvider>
  )
}
