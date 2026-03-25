'use client'

import { useUIStore } from '@/stores/ui.store'

export function DashboardShell({ children }: { children: React.ReactNode }) {
  const { sidebarCollapsed } = useUIStore()
  return (
    <div
      className={`flex-1 flex flex-col min-w-0 transition-all duration-300 ${
        sidebarCollapsed ? 'lg:ml-[68px]' : 'lg:ml-[220px]'
      }`}
    >
      {children}
    </div>
  )
}
