'use client'

import { useEffect, useRef, useState } from 'react'
import { readSnapshotPointA, type PointAStateSlice, type SnapshotPointA } from '@/lib/survey/snapshot'

const POLL_MS = 5000
const POLL_LIMIT_MS = 3 * 60_000

/**
 * Point A for the «Экспресс + блоки» screens (GET /api/v1/point-a/state):
 * polled while a recalculation runs or until a snapshot newer than
 * `freshSince` («Готово» / a block save) arrives — at most 3 minutes.
 * `onSettled` fires once, when the first final view is known.
 */
export function usePointAView(freshSince: number | null, onSettled?: (view: SnapshotPointA) => void): SnapshotPointA {
  const [view, setView] = useState<SnapshotPointA>({ state: 'loading' })
  const settled = useRef(false)
  const cb = useRef(onSettled)
  cb.current = onSettled

  useEffect(() => {
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | null = null
    const started = Date.now()
    const load = async () => {
      const json = await fetch('/api/v1/point-a/state', { credentials: 'include', cache: 'no-store' }).then((r) => r.json()).catch(() => null)
      if (cancelled) return
      const data = (json?.ok ? json.data : null) as PointAStateSlice | null
      const timedOut = Date.now() - started > POLL_LIMIT_MS
      const r = readSnapshotPointA(data, timedOut ? null : freshSince)
      setView(r.view)
      if (!settled.current && (!r.poll || timedOut)) {
        settled.current = true
        cb.current?.(r.view)
      }
      if (r.poll && !timedOut) timer = setTimeout(() => void load(), POLL_MS)
    }
    void load()
    return () => { cancelled = true; if (timer) clearTimeout(timer) }
  }, [freshSince])
  return view
}
