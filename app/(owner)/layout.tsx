import { OwnerSidebar } from '@/components/layout/OwnerSidebar'
import { OwnerHeader }  from '@/components/layout/OwnerHeader'
import { DashboardShell } from '@/components/layout/DashboardShell'

export default function OwnerLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-background flex">
      <OwnerSidebar />
      <DashboardShell>
        <OwnerHeader />
        <main className="flex-1 pt-16">
          <div className="px-4 md:px-6 lg:px-8 py-6 max-w-[1600px] mx-auto">
            {children}
          </div>
        </main>
      </DashboardShell>
    </div>
  )
}
