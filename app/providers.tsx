'use client'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { ToastContainer } from '@/components/ui/Toast'
import { useAuthStore } from '@/stores/auth.store'
import { useThemeStore } from '@/stores/theme.store'

function AuthProvider({ children }: { children: React.ReactNode }) {
  const { init } = useAuthStore()

  useEffect(() => {
    init()
  }, [init])

  return <>{children}</>
}

function ThemeSyncProvider({ children }: { children: React.ReactNode }) {
  const { theme } = useThemeStore()

  useEffect(() => {
    const root = document.documentElement
    if (theme === 'dark') {
      root.classList.add('dark')
      root.classList.remove('light')
    } else {
      root.classList.remove('dark')
      root.classList.add('light')
    }
  }, [theme])

  return <>{children}</>
}

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { staleTime: 5 * 60 * 1000, retry: 1 },
        },
      })
  )

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeSyncProvider>
        <AuthProvider>
          {children}
          <ToastContainer />
        </AuthProvider>
      </ThemeSyncProvider>
    </QueryClientProvider>
  )
}
