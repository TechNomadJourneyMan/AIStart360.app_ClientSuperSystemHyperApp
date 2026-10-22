import { ExpertSidebar } from '@/components/layout/ExpertSidebar'
import { ExpertHeader }  from '@/components/layout/ExpertHeader'
import { MascotLauncher } from '@/components/assistant/mascot/MascotLauncher'
import { getRequestUser } from '@/lib/request-user'
import { loadExpertCabinetLink } from '@/lib/client-shell/server'

export default async function ExpertLayout({ children }: { children: React.ReactNode }) {
  // «Открыть кабинет клиента (проверка)» — the role is checked here, on the
  // server (profiles.role / staff_roles of the session user), never on the client.
  const cabinet = await loadExpertCabinetLink(await getRequestUser())
  return (
    <div className="min-h-screen bg-background flex">
      <ExpertSidebar />
      <div className="flex-1 flex flex-col min-w-0 lg:ml-[220px]">
        <ExpertHeader cabinet={cabinet} />
        <main className="flex-1 pt-16">
          <div className="px-4 md:px-6 lg:px-8 py-6 max-w-[1400px] mx-auto">
            {children}
          </div>
        </main>
      </div>
      {/* TUT-01: mascot / page tours for the expert role (was unmounted). */}
      <MascotLauncher />
    </div>
  )
}
