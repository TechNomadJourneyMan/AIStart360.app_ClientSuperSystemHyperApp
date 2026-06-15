'use client'

// Expert view of a client's Точка Б — same goal-driven plan the client sees,
// computed via /api/expert/clients/[id]/point-b (service-role, RLS bypass).
// Read-only: the expert reviews; the client owns recalculation/persistence.

import { useEffect, useState, useCallback } from 'react'
import PointBView from '@/components/point-b/PointBView'
import type { PointBV2 } from '@/lib/point-b/engine'

export function PointBTab({ clientId }: { clientId: string }) {
  const [pointB, setPointB] = useState<PointBV2 | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [reason, setReason] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/expert/clients/${clientId}/point-b`, { cache: 'no-store' })
      const json = (await res.json()) as { ok: boolean; data?: PointBV2 | null; reason?: string; error?: string }
      if (!res.ok || !json.ok) {
        setError(json.error || `Ошибка ${res.status}`)
        setPointB(null)
        setReason(null)
      } else {
        setPointB(json.data ?? null)
        setReason(json.reason ?? null)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка сети')
    } finally {
      setLoading(false)
    }
  }, [clientId])

  useEffect(() => { load() }, [load])

  return <PointBView pointB={pointB} loading={loading} error={error} reason={reason} onRecalculate={load} actionPlanUserId={clientId} />
}
