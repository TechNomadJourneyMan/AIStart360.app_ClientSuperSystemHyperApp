'use client'

import { useEffect, useState, useCallback } from 'react'
import PointBView from './PointBView'
import PointBPaywall from './PointBPaywall'
import { isUpgradeRequired } from './pointBAccess'
import type { PointBV2 } from '@/lib/point-b/engine'

/**
 * The OLD «Подробности» view of Point B (plan Phase 2 Task 8) — R3 (M3, решение PO): no longer mounted for the
 * client (the page shows one calculation, the model); the code stays until the PO says to remove V2. Fetches
 * the session-scoped, goal-driven plan from /api/v1/diagnostics/point-b (auth via session
 * cookie — no user_id param, so no cross-tenant read) and feeds {@link PointBView}, which owns
 * every loading/empty/error/insufficient/valid state. It is mounted when the tab is first
 * opened, so a visit that stays on «Обзор» does not pay for this request.
 */
export default function PointBDetails() {
  const [pointB, setPointB] = useState<PointBV2 | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [reason, setReason] = useState<string | null>(null)
  const [expertNote, setExpertNote] = useState<{ expert_notes: string; author_name?: string | null; created_at?: string } | null>(null)
  const [aiStatus, setAiStatus] = useState<PointBV2['ai_status']>('none')
  const [locked, setLocked] = useState(false)

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
      if (isUpgradeRequired(res.status, json)) {
        // The tariff gate was turned on (or the tab was open before it): Pro placeholder, no data.
        setLocked(true)
        setPointB(null)
        setReason(null)
        setAiStatus('none')
      } else if (!res.ok || !json.ok) {
        setError(json.error || `Ошибка загрузки (${res.status})`)
        setPointB(null)
        setReason(null)
        setAiStatus('none')
      } else {
        setPointB(json.data ?? null)
        setReason(json.reason ?? null)
        setExpertNote(json.expert_version ?? null)
        setAiStatus(json.data?.ai_status ?? 'none')
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

  // R3 (S3, решение PO): the AI strategy of Точка Б is a draft for staff only — this client view never starts it
  // and never polls it (the routes answer «none» to a client anyway). The old view shows no AI section action.

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

  if (locked) return <PointBPaywall />

  return (
    <div className="space-y-4">
      <PointBView
        pointB={pointB}
        loading={loading}
        error={error}
        reason={reason}
        onRecalculate={load}
        aiStatus={aiStatus}
        onSaveCurrentRevenue={saveCurrentRevenue}
        expertNote={expertNote}
      />
    </div>
  )
}
