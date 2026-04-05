'use client'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { ToastContainer } from '@/components/ui/Toast'
import { useAuthStore } from '@/stores/auth.store'
import { ThemeProvider } from 'next-themes'

function AuthProvider({ children }: { children: React.ReactNode }) {
  const { init } = useAuthStore()

  useEffect(() => {
    init()
  }, [init])

  // Cookies are now httpOnly and set server-side via auth actions.
  // No client-side document.cookie sync needed.

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
      <ThemeProvider attribute="class" defaultTheme="dark" enableSystem>
        <AuthProvider>
          {children}
          <ToastContainer />
        </AuthProvider>
      </ThemeProvider>
    </QueryClientProvider>
  )
}
