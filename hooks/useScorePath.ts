'use client'

/**
 * «Минимум для Точки А» for the questionnaire's review step (R3-PA, П5): the
 * rule of the official score from the server (GET /api/v1/point-a/state —
 * the express view answers every account), computed on the SAVED answers.
 * Plain fetch: the wizard has no query client.
 */
import { useEffect, useState } from 'react'
import type { ScorePath } from '@/lib/point-a/v4/score-path'

export function useScorePath(enabled: boolean): { path: ScorePath | null; loading: boolean } {
  const [path, setPath] = useState<ScorePath | null>(null)
  const [loading, setLoading] = useState(false)
  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    setLoading(true)
    fetch('/api/v1/point-a/state?view=express', { cache: 'no-store', credentials: 'include' })
      .then((r) => r.json().catch(() => null))
      .then((body) => { if (!cancelled) setPath((body?.ok && body.data?.scorePath) || null) })
      .catch(() => { if (!cancelled) setPath(null) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [enabled])
  return { path, loading }
}
