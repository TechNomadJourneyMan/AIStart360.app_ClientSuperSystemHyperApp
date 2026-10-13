'use client'

import { QueryClient } from '@tanstack/react-query'
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client'
import { createSyncStoragePersister } from '@tanstack/query-sync-storage-persister'
import { useEffect, useState } from 'react'
import { OfflineIndicator } from '@/components/common/OfflineIndicator'
import { useAuthStore } from '@/stores/auth.store'
import { ThemeProvider } from 'next-themes'
import { GRI_ASSESSMENT_KEY, ONBOARDING_STATUS_KEY } from '@/hooks/useOnboardingStatus'
import { ACCESS_ME_KEY } from '@/hooks/useEntitlements'

function AuthProvider({ children }: { children: React.ReactNode }) {
  const { init } = useAuthStore()

  useEffect(() => {
    init()
  }, [init])

  return <>{children}</>
}

// User data shared between components of one screen (hooks/useOnboardingStatus,
// hooks/useEntitlements) lives in memory only, like goals and Point A.
const NOT_PERSISTED = new Set<string>(['goals', 'point-a-state', ONBOARDING_STATUS_KEY[0], GRI_ASSESSMENT_KEY[0], ACCESS_ME_KEY[0]])

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
      persistOptions={{
        persister, maxAge: 24 * 60 * 60 * 1000, buster: 'v2', // v2: drops goals cached before they stopped being persisted
        // Goals and Point A are company data: never kept in localStorage (a
        // shared device would show them to the next user before a refetch).
        dehydrateOptions: { shouldDehydrateQuery: (q) => q.state.status === 'success' && !NOT_PERSISTED.has(String(q.queryKey[0])) },
      }}
    >
      <ThemeProvider attribute="class" defaultTheme="dark" enableSystem>
        <AuthProvider>
          <OfflineIndicator />
          {children}
        </AuthProvider>
      </ThemeProvider>
    </PersistQueryClientProvider>
  )
}
