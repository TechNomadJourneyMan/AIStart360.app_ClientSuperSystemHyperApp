import { create } from 'zustand'
import { persist } from 'zustand/middleware'

// PERF-09: toasts are handled by the single global `sonner` <Toaster>; this
// store owns only the sidebar state now. Growth goals moved to the server
// (public.metric_targets, /api/v1/goals — hooks/useGoals.ts).
/** Where pre-server goals are kept until the owner dismisses them (components/dashboard/GoalsBar.tsx). */
export const LEGACY_GOALS_KEY = 'aistart360-legacy-goals'

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
      // Goals pinned before they moved to the server: keep them aside before
      // the first write drops them, so the goals strip can show them once.
      onRehydrateStorage: () => (state) => {
        const legacy = (state as unknown as { pinnedGoals?: unknown } | undefined)?.pinnedGoals
        if (!Array.isArray(legacy) || !legacy.length) return
        try {
          if (!window.localStorage.getItem(LEGACY_GOALS_KEY)) window.localStorage.setItem(LEGACY_GOALS_KEY, JSON.stringify(legacy))
        } catch { /* storage unavailable */ }
      },
    }
  )
)
