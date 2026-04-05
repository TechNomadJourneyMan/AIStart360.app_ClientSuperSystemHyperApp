import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Toast, Goal } from '@/types'
import { generateId } from '@/lib/utils'

interface UIState {
  sidebarCollapsed: boolean
  toasts: Toast[]

  // Pinned growth goals
  pinnedGoals: Goal[]
  addGoal: (goal: Goal) => void
  removeGoal: (goalId: string) => void
  updateGoal: (goalId: string, data: Partial<Goal>) => void

  // Actions
  toggleSidebar: () => void
  setSidebarCollapsed: (collapsed: boolean) => void
  addToast: (toast: Omit<Toast, 'id'>) => void
  removeToast: (id: string) => void
}

export const useUIStore = create<UIState>()(
  persist(
    (set) => ({
      sidebarCollapsed: false,
      toasts: [],
      pinnedGoals: [],

      toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
      setSidebarCollapsed: (collapsed) => set({ sidebarCollapsed: collapsed }),

      addGoal: (goal) => set((s) => ({ pinnedGoals: [...s.pinnedGoals, goal] })),
      removeGoal: (id) => set((s) => ({ pinnedGoals: s.pinnedGoals.filter((g) => g.id !== id) })),
      updateGoal: (id, data) =>
        set((s) => ({
          pinnedGoals: s.pinnedGoals.map((g) => (g.id === id ? { ...g, ...data } : g)),
        })),

      addToast: (toast) =>
        set((s) => ({
          toasts: [...s.toasts, { ...toast, id: generateId() }],
        })),

      removeToast: (id) =>
        set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
    }),
    {
      name: 'aistart360-ui',
      partialize: (s) => ({ sidebarCollapsed: s.sidebarCollapsed, pinnedGoals: s.pinnedGoals }),
    }
  )
)

// Toast helper hooks
export const toast = {
  success: (title: string, description?: string) =>
    useUIStore.getState().addToast({ type: 'success', title, description }),
  error: (title: string, description?: string) =>
    useUIStore.getState().addToast({ type: 'error', title, description }),
  warning: (title: string, description?: string) =>
    useUIStore.getState().addToast({ type: 'warning', title, description }),
  info: (title: string, description?: string) =>
    useUIStore.getState().addToast({ type: 'info', title, description }),
}
