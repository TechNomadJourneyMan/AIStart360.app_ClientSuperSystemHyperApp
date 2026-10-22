'use client'

import { useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { useTopLoader } from 'nextjs-toploader'
import { shouldStartProgress } from '@/lib/route-progress'

/**
 * `useRouter()` whose push / replace also start the global loading bar.
 * Link clicks start it on their own (nextjs-toploader); programmatic
 * navigation did not, so a button that called router.push looked frozen
 * until the next page arrived. The bar finishes when the URL commits
 * (nextjs-toploader) or, at the latest, by the RouteProgress watchdog.
 */
export function useProgressRouter(): ReturnType<typeof useRouter> {
  const router = useRouter()
  const loader = useTopLoader()
  return useMemo(() => {
    const start = (href: string) => {
      if (typeof window !== 'undefined' && shouldStartProgress(window.location.href, href)) loader.start()
    }
    return {
      ...router,
      push: (href, options) => {
        start(href)
        router.push(href, options)
      },
      replace: (href, options) => {
        start(href)
        router.replace(href, options)
      },
    }
    // `loader` wraps a module singleton; the router instance is stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router])
}
