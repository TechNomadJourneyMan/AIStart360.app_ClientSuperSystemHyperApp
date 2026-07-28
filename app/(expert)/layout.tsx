import { ExpertSidebar } from '@/components/layout/ExpertSidebar'
import { ExpertHeader }  from '@/components/layout/ExpertHeader'
import { RoleMobileNav } from '@/components/layout/RoleMobileNav'

export default function ExpertLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-background flex">
      <ExpertSidebar />
      <div className="flex-1 flex flex-col min-w-0 lg:ml-[220px]">
        <ExpertHeader />
        <main className="flex-1 pt-16 pb-20 lg:pb-0">
          <div className="px-4 md:px-6 lg:px-8 py-6 max-w-[1400px] mx-auto">
            {children}
          </div>
        </main>
      </div>
      <RoleMobileNav role="expert" />
    </div>
  )
}
