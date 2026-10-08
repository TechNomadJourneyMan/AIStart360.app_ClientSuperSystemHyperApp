'use client'

import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Save } from 'lucide-react'
import PointBView from '@/components/point-b/PointBView'
import type { PointBV2 } from '@/lib/point-b/engine'
import { Button, ErrorState, GigaApiError, Panel, fmtDateTime, gigaFetch, inputClass, useGigaQuery } from '../kit'

/**
 * Точка Б клиента: тот же расчёт, что видит клиент, и экспертная корректировка
 * (point_b_versions). Править может только тот, у кого есть clients.review.
 */

interface Version { id: string; expert_notes: string; author_name: string | null; is_approved: boolean; created_at: string }
interface PointBData { pointB: PointBV2 | null; reason: string | null; version: Version | null }

export function PointBTab({ userId, canReview }: { userId: string; canReview: boolean }) {
  const { data, error, loading, reload } = useGigaQuery<{ data: PointBData }>(`/api/giga-admin/users/${userId}/point-b`)
  const d = data?.data
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => { setDraft(d?.version?.expert_notes ?? '') }, [d?.version?.id, d?.version?.expert_notes])

  const save = async () => {
    if (!draft.trim()) return
    setSaving(true)
    try {
      await gigaFetch(`/api/giga-admin/users/${userId}/point-b`, { method: 'POST', json: { expert_notes: draft.trim() } })
      toast.success('Корректировка сохранена — клиент её увидит')
      reload()
    } catch (e) {
      toast.error(e instanceof GigaApiError ? e.message : 'Не удалось сохранить')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-4">
      {canReview && d?.pointB && (
        <Panel
          title="Экспертная корректировка плана"
          description="Текст увидит клиент на странице Точки Б как «Экспертную корректировку»."
        >
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={4}
            maxLength={8000}
            placeholder="Например: цель агрессивная — в первом квартале сфокусируйтесь на конверсии; найм РОПа отложите до закрытия кассового разрыва…"
            className={inputClass}
          />
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
            <span className="text-[11px] text-slate-600">
              {d.version ? `Последняя: ${fmtDateTime(d.version.created_at)}${d.version.author_name ? ` · ${d.version.author_name}` : ''}` : 'Корректировок ещё не было'}
            </span>
            <Button variant="primary" icon={<Save size={13} />} loading={saving} disabled={!draft.trim() || draft.trim() === d.version?.expert_notes} onClick={() => void save()}>
              Сохранить корректировку
            </Button>
          </div>
        </Panel>
      )}
      <ErrorState error={error} onRetry={reload} />
      {!error && (
        <PointBView
          pointB={d?.pointB ?? null}
          loading={loading && !d}
          reason={d?.reason ?? null}
          onRecalculate={reload}
          actionPlanUserId={userId}
          expertNote={canReview ? null : d?.version ?? null}
        />
      )}
    </div>
  )
}
