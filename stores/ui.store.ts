import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Goal } from '@/types'

// PERF-09: toasts are handled by the single global `sonner` <Toaster>; this
// store owns only sidebar + pinned-goals UI state now.
interface UIState {
  sidebarCollapsed: boolean

  // Pinned growth goals
  pinnedGoals: Goal[]
  addGoal: (goal: Goal) => void
  removeGoal: (goalId: string) => void
  updateGoal: (goalId: string, data: Partial<Goal>) => void

  // Actions
  toggleSidebar: () => void
  setSidebarCollapsed: (collapsed: boolean) => void
}

export const useUIStore = create<UIState>()(
  persist(
    (set) => ({
      sidebarCollapsed: false,
      pinnedGoals: [],

      toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
      setSidebarCollapsed: (collapsed) => set({ sidebarCollapsed: collapsed }),

      addGoal: (goal) => set((s) => ({ pinnedGoals: [...s.pinnedGoals, goal] })),
      removeGoal: (id) => set((s) => ({ pinnedGoals: s.pinnedGoals.filter((g) => g.id !== id) })),
      updateGoal: (id, data) =>
        set((s) => ({
          pinnedGoals: s.pinnedGoals.map((g) => (g.id === id ? { ...g, ...data } : g)),
        })),
    }),
    {
      name: 'aistart360-ui',
      partialize: (s) => ({ sidebarCollapsed: s.sidebarCollapsed, pinnedGoals: s.pinnedGoals }),
    }
  )
)
