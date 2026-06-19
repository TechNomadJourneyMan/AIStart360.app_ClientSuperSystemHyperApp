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
  const [aiStatus, setAiStatus] = useState<PointBV2['ai_status']>('none')

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

  // Kick off the async AI bridge then start polling. Triggered ONLY on demand —
  // the manual "Сформировать/Обновить план" button, or the server-side fire from
  // /recalculate when the диагностика is rebuilt. We deliberately do NOT call the
  // LLM on page load: entering the page only READS the persisted strategy.
  const generate = useCallback(async () => {
    setAiStatus('processing')
    try {
      await fetch('/api/v1/diagnostics/point-b/ai-generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          pointB?.diagnostic_id ? { diagnostic_id: pointB.diagnostic_id } : {},
        ),
      })
    } catch {
      // Network hiccup on kickoff — the poller below still reflects server truth.
    }
  }, [pointB?.diagnostic_id])

  // Poll for AI status while processing (mirror app/client/point-a polling).
  useEffect(() => {
    if (aiStatus !== 'processing') return
    const interval = setInterval(async () => {
      try {
        const qs = pointB?.diagnostic_id ? `?diagnostic_id=${pointB.diagnostic_id}` : ''
        const res = await fetch(`/api/v1/diagnostics/point-b/ai-status${qs}`, { cache: 'no-store' })
        const json = (await res.json()) as {
          ok: boolean
          data?: { ai_status: PointBV2['ai_status']; ai_strategy: Record<string, unknown> | null }
        }
        if (json.ok && json.data) {
          const next = json.data.ai_status
          setAiStatus(next)
          setPointB((prev) =>
            prev ? { ...prev, ai_status: next, ai_strategy: json.data!.ai_strategy } : prev,
          )
          if (next === 'completed' || next === 'failed') {
            clearInterval(interval)
          }
        }
      } catch {}
    }, 3000)
    return () => clearInterval(interval)
  }, [aiStatus, pointB?.diagnostic_id])

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
      onGenerate={generate}
      aiStatus={aiStatus}
      onSaveCurrentRevenue={saveCurrentRevenue}
      expertNote={expertNote}
    />
  )
}
