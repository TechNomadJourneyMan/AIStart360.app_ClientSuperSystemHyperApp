import ActivityTracker from '@/components/analytics/ActivityTracker'
import ImpersonationBanner from '@/components/impersonation/ImpersonationBanner'
import { Sidebar } from '@/components/layout/Sidebar'
import { Header } from '@/components/layout/Header'
import { MobileNav } from '@/components/layout/MobileNav'
import { DashboardShell } from '@/components/layout/DashboardShell'
import { MascotLauncher } from '@/components/assistant/mascot/MascotLauncher'
import { ChatHost } from '@/components/ai-chat/ChatHost'
import { NotificationsBellSync } from '@/components/notifications/NotificationsBellSync'
import AnnouncementBar from '@/components/platform/AnnouncementBar'
import { ClientNav } from '@/components/client/ClientNav'
import { PlatformSectionsProvider } from '@/hooks/usePlatformSections'
import { getRequestUser } from '@/lib/request-user'
import { visibleSectionsFor } from '@/lib/platform/sections'
import { clientShellData, loadDashboardClientShell } from '@/lib/client-shell/server'

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  // Sections switched off in GIGA-CRM are filtered out of the menu on the
  // server, so nothing flashes in before the client fetch returns.
  // getRequestUser / visibleSectionsFor are memoised per request: the page
  // below reuses these reads instead of repeating the Auth round trip.
  const user = await getRequestUser()
  const [{ sections, hiddenPaths }, client] = await Promise.all([
    visibleSectionsFor(user?.id ?? null),
    // R-028: is the viewer a client (not staff)? Then the cabinet bar.
    loadDashboardClientShell(user),
  ])
  const initial = { sections: sections.map((s) => ({ key: s.key, title: s.title, description: s.description, icon: s.icon, href: s.nav_href })), hiddenPaths }

  // R-028 (quick step of one shell): a client on /dashboard, /gri, /settings,
  // /notifications… gets the SAME bar as in /client/* — «Главная», «Анкета»,
  // «Сообщения», the bell — on the phone too, instead of the staff sidebar,
  // header and bottom bar. Staff keep the old shell below, unchanged.
  if (client) {
    const shell = clientShellData(client.account, hiddenPaths, client.lockedKeys)
    return (
      <PlatformSectionsProvider initial={initial}>
      <div className="min-h-screen bg-background">
        <ActivityTracker />
        <ImpersonationBanner />
        <ClientNav items={shell.items} panel={shell.panel} email={shell.email} notifications={shell.notifications} more={shell.more} />
        <main>
          {/* pb reserves space for the floating assistant FAB (bottom-6). */}
          <div className="px-4 md:px-6 lg:px-8 pt-6 pb-24 max-w-[1600px] mx-auto">
            <AnnouncementBar className="mb-4" />
            {children}
          </div>
        </main>
        <MascotLauncher />
        <ChatHost />
      </div>
      </PlatformSectionsProvider>
    )
  }

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
      <ChatHost />

      {/* Keeps the header bell's unread badge in sync with the real feed */}
      <NotificationsBellSync />
    </div>
    </PlatformSectionsProvider>
  )
}
