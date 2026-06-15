'use client'

import { useEffect, useState, useCallback } from 'react'
import PointBView from './PointBView'
import type { PointBV2 } from '@/lib/point-b/engine'

/**
 * Client container for Point B. Fetches the session-scoped, goal-driven plan
 * from /api/v1/diagnostics/point-b (auth via session cookie — no user_id param,
 * so no cross-tenant read) and feeds {@link PointBView}, which owns every
 * loading/empty/error/insufficient/valid state.
 *
 * Mounted on all client-facing Point B surfaces so behaviour is identical no
 * matter which route the owner reaches (/client/point-b, /point-b, /owner/point-b).
 */
export default function PointBContainer() {
  const [pointB, setPointB] = useState<PointBV2 | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [reason, setReason] = useState<string | null>(null)
  const [expertNote, setExpertNote] = useState<{ expert_notes: string; author_name?: string | null; created_at?: string } | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/v1/diagnostics/point-b', { cache: 'no-store' })
      const json = (await res.json()) as {
        ok: boolean
        data?: PointBV2 | null
        reason?: string
        error?: string
        expert_version?: { expert_notes: string; author_name?: string | null; created_at?: string } | null
      }
      if (!res.ok || !json.ok) {
        setError(json.error || `Ошибка загрузки (${res.status})`)
        setPointB(null)
        setReason(null)
      } else {
        setPointB(json.data ?? null)
        setReason(json.reason ?? null)
        setExpertNote(json.expert_version ?? null)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка сети')
      setPointB(null)
      setReason(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const saveCurrentRevenue = useCallback(async (year: number) => {
    const res = await fetch('/api/v1/diagnostics/point-b/current-revenue', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ revenue_year: year }),
    })
    const json = (await res.json()) as { ok: boolean; error?: string }
    if (!res.ok || !json.ok) throw new Error(json.error || 'Не удалось сохранить выручку')
    await load()
  }, [load])

  return (
    <PointBView
      pointB={pointB}
      loading={loading}
      error={error}
      reason={reason}
      onRecalculate={load}
      onSaveCurrentRevenue={saveCurrentRevenue}
      expertNote={expertNote}
    />
  )
}
