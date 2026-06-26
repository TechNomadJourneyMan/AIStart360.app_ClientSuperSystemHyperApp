'use client'

import { QueryClient } from '@tanstack/react-query'
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client'
import { createSyncStoragePersister } from '@tanstack/query-sync-storage-persister'
import { useEffect, useState } from 'react'
import { ToastContainer } from '@/components/ui/Toast'
import { OfflineIndicator } from '@/components/common/OfflineIndicator'
import { useAuthStore } from '@/stores/auth.store'
import { ThemeProvider } from 'next-themes'

function AuthProvider({ children }: { children: React.ReactNode }) {
  const { init } = useAuthStore()

  useEffect(() => {
    init()
  }, [init])

  return <>{children}</>
}

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 5 * 60 * 1000,
            // Keep entries long enough to be worth persisting (24h).
            gcTime: 24 * 60 * 60 * 1000,
            retry: 1,
          },
        },
      })
  )

  // Persist the query cache to localStorage so data shows instantly on the next
  // visit and stays readable offline. `createSyncStoragePersister` falls back to
  // a no-op when storage is unavailable (SSR), so this is hydration-safe.
  const [persister] = useState(() =>
    createSyncStoragePersister({
      storage: typeof window !== 'undefined' ? window.localStorage : undefined,
      key: 'aistart360_rq_cache',
      throttleTime: 1000,
    })
  )

  return (
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={{ persister, maxAge: 24 * 60 * 60 * 1000, buster: 'v1' }}
    >
      <ThemeProvider attribute="class" defaultTheme="dark" enableSystem>
        <AuthProvider>
          <OfflineIndicator />
          {children}
          <ToastContainer />
        </AuthProvider>
      </ThemeProvider>
    </PersistQueryClientProvider>
  )
}
