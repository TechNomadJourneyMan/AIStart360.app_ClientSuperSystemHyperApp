'use client'

import { useEffect, useRef, useState } from 'react'
import { flushEvents, track } from '@/lib/events/client'

/** CONTENT_VIEWED on open; CONTENT_COMPLETED when the end is reached or the user marks it. */
export default function ContentTracker({ slug, pageId }: { slug: string; pageId: string }) {
  const endRef = useRef<HTMLDivElement>(null)
  const [done, setDone] = useState(false)

  useEffect(() => {
    track('CONTENT_VIEWED', { entityType: 'cms_page', entityId: pageId, metadata: { slug } })
  }, [slug, pageId])

  useEffect(() => {
    const el = endRef.current
    if (!el || done) return
    const obs = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        track('CONTENT_COMPLETED', { entityType: 'cms_page', entityId: pageId, metadata: { slug, how: 'scrolled' } })
        flushEvents()
        setDone(true)
      }
    }, { threshold: 1 })
    obs.observe(el)
    return () => obs.disconnect()
  }, [slug, pageId, done])

  return (
    <div ref={endRef} className="mt-10 flex items-center justify-center gap-2 text-xs text-on-surface-variant">
      <span className="material-symbols-outlined text-base text-primary" aria-hidden>{done ? 'task_alt' : 'menu_book'}</span>
      {done ? 'Материал изучен' : 'Конец материала'}
    </div>
  )
}
