import { create } from 'zustand'
import { persist } from 'zustand/middleware'

type Theme = 'dark' | 'light'

interface ThemeState {
  theme: Theme
  toggleTheme: () => void
  setTheme: (theme: Theme) => void
}

export const useThemeStore = create<ThemeState>()(
  persist(
    (set) => ({
      theme: 'dark',

      toggleTheme: () =>
        set((s) => {
          const next: Theme = s.theme === 'dark' ? 'light' : 'dark'
          // Sync with document class for Tailwind/next-themes
          if (typeof document !== 'undefined') {
            document.documentElement.classList.toggle('dark', next === 'dark')
            document.documentElement.classList.toggle('light', next === 'light')
          }
          return { theme: next }
        }),

      setTheme: (theme) => {
        if (typeof document !== 'undefined') {
          document.documentElement.classList.toggle('dark', theme === 'dark')
          document.documentElement.classList.toggle('light', theme === 'light')
        }
        set({ theme })
      },
    }),
    {
      name: 'aistart360_theme',
      partialize: (s) => ({ theme: s.theme }),
    }
  )
)
