'use client'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { ToastContainer } from '@/components/ui/Toast'
import { useAuthStore } from '@/stores/auth.store'
import { SessionProvider, useSession } from 'next-auth/react'

/**
 * AuthProvider — runs auth.init() on mount, syncs role to cookie
 * so middleware can protect routes server-side.
 */
/**
 * AuthSync — Synchronizes NextAuth session with Zustand authStore
 */
function AuthSync() {
  const { data: session, status } = useSession()

  useEffect(() => {
    if (status === 'authenticated' && session?.user) {
      useAuthStore.setState({
        // @ts-ignore
        user: session.user,
        // @ts-ignore
        role: session.user.role || 'expert',
        isInitialized: true
      })
    }
  }, [session, status])

  return null
}

function AuthProvider({ children }: { children: React.ReactNode }) {
  const { init, role, isInitialized } = useAuthStore()

  useEffect(() => {
    init()
  }, [init])

  // Sync role to a lightweight cookie for middleware SSR route protection
  useEffect(() => {
    if (!isInitialized) return
    if (role) {
      document.cookie = `aistart360_role=${role}; path=/; max-age=${7 * 24 * 3600}; SameSite=Lax`
    } else {
      document.cookie = 'aistart360_role=; path=/; max-age=0'
    }
  }, [role, isInitialized])

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
    <SessionProvider>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <AuthSync />
          {children}
          <ToastContainer />
        </AuthProvider>
      </QueryClientProvider>
    </SessionProvider>
  )
}
