import { create } from 'zustand'
import { persist } from 'zustand/middleware'

// PERF-09: toasts are handled by the single global `sonner` <Toaster>; this
// store owns only the sidebar state now. Growth goals moved to the server
// (public.metric_targets, /api/v1/goals — hooks/useGoals.ts).
interface UIState {
  sidebarCollapsed: boolean

  // Actions
  toggleSidebar: () => void
  setSidebarCollapsed: (collapsed: boolean) => void
}

export const useUIStore = create<UIState>()(
  persist(
    (set) => ({
      sidebarCollapsed: false,

      toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
      setSidebarCollapsed: (collapsed) => set({ sidebarCollapsed: collapsed }),
    }),
    {
      name: 'aistart360-ui',
      partialize: (s) => ({ sidebarCollapsed: s.sidebarCollapsed }),
    }
  )
)
