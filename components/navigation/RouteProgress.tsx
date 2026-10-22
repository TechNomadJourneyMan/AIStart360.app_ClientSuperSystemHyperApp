'use client'

/**
 * Safety net for the global loading bar (nextjs-toploader in app/layout.tsx):
 *  - a committed route change always finishes the bar (pathname changed);
 *  - a bar that was started and never finished is closed by the watchdog
 *    after PROGRESS_FALLBACK_MS, so the page never looks frozen forever.
 * Renders nothing. Reduced motion is handled in globals.css (#nprogress).
 */
import { useEffect, useRef } from 'react'
import { usePathname } from 'next/navigation'
import { useTopLoader } from 'nextjs-toploader'
import { PROGRESS_WATCH_INTERVAL_MS, createProgressWatchdog, type ProgressWatchdog } from '@/lib/route-progress'

export function RouteProgress() {
  const pathname = usePathname()
  const loader = useTopLoader()
  const watchdog = useRef<ProgressWatchdog | null>(null)

  useEffect(() => {
    const dog = createProgressWatchdog({ isStarted: () => loader.isStarted(), done: () => loader.done(true), now: () => Date.now() })
    watchdog.current = dog
    const id = window.setInterval(() => dog.tick(), PROGRESS_WATCH_INTERVAL_MS)
    return () => window.clearInterval(id)
    // The loader is a thin wrapper over the nprogress singleton: one watchdog per mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (loader.isStarted()) loader.done()
    watchdog.current?.reset()
    // Only the committed pathname matters here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname])

  return null
}
