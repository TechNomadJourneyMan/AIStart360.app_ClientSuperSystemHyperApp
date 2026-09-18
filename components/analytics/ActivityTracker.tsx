'use client'

import { useEffect, useRef } from 'react'
import { usePathname } from 'next/navigation'
import { flushEvents, track } from '@/lib/events/client'

/**
 * Page views + explicit clicks for the user-facing app. Clicks are recorded
 * only for elements marked `data-track="label"` — no blanket click capture.
 */
export default function ActivityTracker() {
  const pathname = usePathname()
  const last = useRef<string | null>(null)

  useEffect(() => {
    if (!pathname || pathname === last.current) return
    last.current = pathname
    track('PAGE_VIEWED', { page: pathname, metadata: { title: document.title.slice(0, 120) } })
  }, [pathname])

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const el = (e.target as HTMLElement | null)?.closest?.('[data-track]') as HTMLElement | null
      if (!el) return
      track('BUTTON_CLICKED', { metadata: { label: (el.dataset.track || '').slice(0, 80) } })
    }
    const onHide = () => { if (document.visibilityState === 'hidden') flushEvents(true) }
    document.addEventListener('click', onClick, { capture: true })
    document.addEventListener('visibilitychange', onHide)
    window.addEventListener('pagehide', onHide)
    return () => {
      document.removeEventListener('click', onClick, { capture: true })
      document.removeEventListener('visibilitychange', onHide)
      window.removeEventListener('pagehide', onHide)
    }
  }, [])

  return null
}
