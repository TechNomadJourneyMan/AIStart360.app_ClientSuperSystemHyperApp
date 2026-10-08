'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { CheckCircle2, Save } from 'lucide-react'
import { Badge, Button, ConfirmDialog, ErrorState, GigaApiError, Panel, Skeleton, fmtDateTime, gigaFetch, inputClass, useGigaQuery } from '../../kit'
import type { PointBVersion } from './types'

/**
 * Экспертная Точка Б: эксперт сохраняет версию (не одобрена — клиент её не
 * видит), Admin / Super Admin одобряет.
 */
export function PointBReview({ userId }: { userId: string }) {
  const { data, error, loading, reload } = useGigaQuery<{
    data: { diagnosticId: string | null; canApprove: boolean; versions: PointBVersion[] }
    unavailable?: boolean
  }>(`/api/giga-admin/users/${userId}/review/point-b`)
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)
  const [toApprove, setToApprove] = useState<PointBVersion | null>(null)
  const [approving, setApproving] = useState(false)

  const d = data?.data
  const versions = d?.versions ?? []

  const save = async () => {
    if (!notes.trim()) return
    setBusy(true)
    try {
      await gigaFetch(`/api/giga-admin/users/${userId}/review/point-b`, { method: 'POST', json: { expert_notes: notes.trim() } })
      setNotes('')
      toast.success('Версия сохранена и ждёт одобрения')
      reload()
    } catch (e) {
      toast.error(e instanceof GigaApiError ? e.message : 'Не удалось сохранить')
    } finally {
      setBusy(false)
    }
  }

  const approve = async () => {
    if (!toApprove) return
    setApproving(true)
    try {
      await gigaFetch(`/api/giga-admin/users/${userId}/review/point-b/approve`, { method: 'POST', json: { versionId: toApprove.id } })
      toast.success('Версия одобрена — клиент увидит её в Точке Б')
      setToApprove(null)
      reload()
    } catch (e) {
      toast.error(e instanceof GigaApiError ? e.message : 'Не удалось одобрить')
    } finally {
      setApproving(false)
    }
  }

  return (
    <Panel title="Экспертная Точка Б" description="Версия эксперта видна клиенту только после одобрения Admin или Super Admin.">
      <ErrorState error={error} onRetry={reload} />
      {loading && !data && <Skeleton className="h-20" />}
      {d && !d.diagnosticId && <p className="text-xs text-slate-500">У клиента ещё нет Точки А — экспертную Точку Б сохранить не к чему.</p>}
      {d?.diagnosticId && (
        <>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={4}
            maxLength={8000}
            placeholder="Стратегические заметки к Точке Б: что поменять в цели и плане и почему"
            className={inputClass}
            aria-label="Заметки эксперта к Точке Б"
          />
          <div className="mt-2 flex items-center justify-between">
            <span className="text-[11px] text-slate-600">{notes.length}/8000</span>
            <Button variant="primary" size="sm" icon={<Save size={12} />} loading={busy} disabled={!notes.trim()} onClick={() => void save()}>
              Сохранить на одобрение
            </Button>
          </div>
        </>
      )}

      {versions.length > 0 && (
        <ul className="mt-4 space-y-2">
          {versions.map((v) => (
            <li key={v.id} className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
              <div className="flex items-start justify-between gap-2">
                <p className="min-w-0 flex-1 whitespace-pre-wrap break-words text-sm text-slate-200">{v.expert_notes}</p>
                {v.is_approved ? (
                  <Badge tone="green">Одобрена</Badge>
                ) : d?.canApprove ? (
                  <Button size="sm" variant="primary" icon={<CheckCircle2 size={12} />} onClick={() => setToApprove(v)}>Одобрить</Button>
                ) : (
                  <Badge tone="amber">Ждёт одобрения</Badge>
                )}
              </div>
              <p className="mt-2 text-[11px] text-slate-600">
                {v.author_name ?? 'Эксперт'} · {fmtDateTime(v.created_at)}
                {v.is_approved && v.approved_at && ` · одобрил ${v.approved_by_name ?? '—'} ${fmtDateTime(v.approved_at)}`}
              </p>
            </li>
          ))}
        </ul>
      )}

      <ConfirmDialog
        open={!!toApprove}
        onClose={() => setToApprove(null)}
        onConfirm={() => void approve()}
        loading={approving}
        tone="primary"
        title="Одобрить экспертную Точку Б?"
        text="После одобрения клиент увидит эту версию в своей Точке Б. Действие попадёт в журнал."
        confirmLabel="Одобрить"
      />
    </Panel>
  )
}
