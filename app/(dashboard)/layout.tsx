import { Sidebar } from '@/components/layout/Sidebar'
import { Header } from '@/components/layout/Header'
import { MobileNav } from '@/components/layout/MobileNav'
import { DashboardShell } from '@/components/layout/DashboardShell'
import { AssistantChatLauncher } from '@/components/assistant/AssistantChatPanel'
import { NotificationsBellSync } from '@/components/notifications/NotificationsBellSync'

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="min-h-screen bg-background flex">
      {/* Sidebar — скрыт на мобильных */}
      <Sidebar />

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
      <MobileNav />

      {/* Floating AI assistant — available on every dashboard page */}
      <AssistantChatLauncher />

      {/* Keeps the header bell's unread badge in sync with the real feed */}
      <NotificationsBellSync />
    </div>
  )
}
