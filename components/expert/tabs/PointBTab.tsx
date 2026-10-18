'use client'

// Expert view of a client's Точка Б — same goal-driven plan the client sees,
// plus an expert-correction editor. Saving writes a version of the client's PLAN (server-side, the
// one write path of plan Task 6) and sends it for approval: the client sees it only after Admin /
// Super Admin approves it. Goal verification and the version list live in the GIGA panel (User 360).

import { useEffect, useState, useCallback } from 'react'
import PointBView from '@/components/point-b/PointBView'
import type { PointBV2 } from '@/lib/point-b/engine'

interface ExpertVersion { expert_notes: string; author_name?: string | null; created_at?: string; is_approved?: boolean }

export function PointBTab({ clientId }: { clientId: string }) {
  const [pointB, setPointB] = useState<PointBV2 | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [reason, setReason] = useState<string | null>(null)

  const [version, setVersion] = useState<ExpertVersion | null>(null)
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveMsg, setSaveMsg] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/expert/clients/${clientId}/point-b`, { cache: 'no-store' })
      const json = (await res.json()) as { ok: boolean; data?: PointBV2 | null; reason?: string; error?: string }
      if (!res.ok || !json.ok) {
        setError(json.error || `Ошибка ${res.status}`)
        setPointB(null); setReason(null)
      } else {
        setPointB(json.data ?? null); setReason(json.reason ?? null)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка сети')
    } finally {
      setLoading(false)
    }
  }, [clientId])

  const loadVersion = useCallback(async () => {
    try {
      const res = await fetch(`/api/expert/clients/${clientId}/point-b-version`, { cache: 'no-store' })
      const json = (await res.json()) as { ok: boolean; data?: ExpertVersion | null }
      if (json.ok) { setVersion(json.data ?? null); setDraft(json.data?.expert_notes ?? '') }
    } catch { /* non-fatal */ }
  }, [clientId])

  useEffect(() => { load(); loadVersion() }, [load, loadVersion])

  const save = async () => {
    const notes = draft.trim()
    if (!notes) { setSaveMsg('Введите текст корректировки'); return }
    setSaving(true); setSaveMsg(null)
    try {
      const res = await fetch(`/api/expert/clients/${clientId}/point-b-version`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ expert_notes: notes }),
      })
      const json = (await res.json()) as { ok: boolean; error?: string }
      if (!res.ok || !json.ok) setSaveMsg(json.error || 'Не удалось сохранить')
      else { setSaveMsg('Версия плана отправлена на одобрение. Клиент увидит её после одобрения Admin или Super Admin'); await loadVersion() }
    } catch (e) {
      setSaveMsg(e instanceof Error ? e.message : 'Ошибка сети')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-6">
      {/* Expert correction editor */}
      <div className="rounded-2xl border border-secondary/25 bg-secondary/[0.05] p-5">
        <div className="flex items-center gap-2 mb-2">
          <span className="material-symbols-outlined text-secondary text-lg" aria-hidden>rate_review</span>
          <p className="text-sm font-semibold text-on-surface">Экспертная корректировка плана</p>
        </div>
        <p className="text-xs text-on-surface-variant mb-3">
          Усильте/скорректируйте Точку Б клиента. Текст сохраняется как новая версия плана и уходит на одобрение Admin или Super Admin; клиент увидит его как «Экспертную корректировку» только после одобрения.
        </p>
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={4}
          placeholder="Например: цель агрессивная — сфокусируйтесь в Q1 на конверсии (скрипты, follow-up); найм РОПа отложите до закрытия кассового разрыва…"
          className="w-full bg-surface-container border border-white/[0.08] rounded-xl px-4 py-3 text-sm text-on-surface placeholder:text-on-surface-variant/30 focus:outline-none focus:border-secondary/50 resize-none"
        />
        <div className="flex items-center gap-3 mt-3">
          <button
            onClick={save}
            disabled={saving}
            className="inline-flex items-center gap-2 bg-secondary/15 hover:bg-secondary/25 border border-secondary/30 text-secondary text-sm px-5 py-2 rounded-xl transition-all disabled:opacity-50"
          >
            <span className="material-symbols-outlined text-base" aria-hidden>{saving ? 'progress_activity' : 'save'}</span>
            {saving ? 'Отправка…' : 'Отправить на одобрение'}
          </button>
          {saveMsg && <span className="text-xs text-on-surface-variant">{saveMsg}</span>}
          {version?.created_at && !saveMsg && (
            <span className="text-xs text-on-surface-variant/60">
              Последняя: {new Date(version.created_at).toLocaleDateString('ru-RU')}
              {version.is_approved === undefined ? '' : version.is_approved ? ' · одобрена' : ' · ждёт одобрения'}
            </span>
          )}
        </div>
      </div>

      <PointBView pointB={pointB} loading={loading} error={error} reason={reason} onRecalculate={load} actionPlanUserId={clientId} expertNote={version} />
    </div>
  )
}
