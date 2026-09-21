'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { Pin, PinOff, Plus, Trash2 } from 'lucide-react'
import { Button, ConfirmDialog, EmptyState, ErrorState, GigaApiError, Panel, Skeleton, cx, fmtDateTime, gigaFetch, inputClass, useGigaQuery } from '../kit'
import { useStaff } from '../StaffContext'

/** Заметки сотрудников о клиенте: кто что выяснил и когда. */

interface Note {
  id: string
  body: string
  pinned: boolean
  author_id: string
  author_email: string | null
  author_role: string | null
  created_at: string
  updated_at: string
}

export function NotesTab({ userId }: { userId: string }) {
  const { me } = useStaff()
  const { data, error, loading, reload } = useGigaQuery<{ data: Note[]; unavailable?: boolean }>(`/api/giga-admin/users/${userId}/notes`)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [toDelete, setToDelete] = useState<Note | null>(null)

  const notes = data?.data ?? []
  const mine = (n: Note) => n.author_id === me?.id

  const add = async () => {
    if (!draft.trim()) return
    setBusy(true)
    try {
      await gigaFetch(`/api/giga-admin/users/${userId}/notes`, { method: 'POST', json: { body: draft.trim() } })
      setDraft('')
      toast.success('Заметка добавлена')
      reload()
    } catch (e) {
      toast.error(e instanceof GigaApiError ? e.message : 'Не удалось сохранить')
    } finally {
      setBusy(false)
    }
  }

  const togglePin = async (n: Note) => {
    try {
      await gigaFetch(`/api/giga-admin/users/${userId}/notes/${n.id}`, { method: 'PATCH', json: { pinned: !n.pinned } })
      reload()
    } catch (e) {
      toast.error(e instanceof GigaApiError ? e.message : 'Не удалось изменить')
    }
  }

  const remove = async () => {
    if (!toDelete) return
    try {
      await gigaFetch(`/api/giga-admin/users/${userId}/notes/${toDelete.id}`, { method: 'DELETE' })
      toast.success('Заметка удалена')
      setToDelete(null)
      reload()
    } catch (e) {
      toast.error(e instanceof GigaApiError ? e.message : 'Не удалось удалить')
    }
  }

  return (
    <div className="space-y-4">
      <Panel title="Новая заметка" description="Видна только персоналу. Клиент её не увидит.">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={3}
          maxLength={4000}
          placeholder="Что выяснили на созвоне, о чём договорились, что мешает клиенту"
          className={inputClass}
        />
        <div className="mt-2 flex items-center justify-between">
          <span className="text-[11px] text-slate-600">{draft.length}/4000</span>
          <Button variant="primary" icon={<Plus size={13} />} loading={busy} disabled={!draft.trim()} onClick={() => void add()}>
            Добавить
          </Button>
        </div>
      </Panel>

      <ErrorState error={error} onRetry={reload} />
      {data?.unavailable && (
        <p className="rounded-xl border border-amber-500/20 bg-amber-500/[0.06] px-4 py-2.5 text-xs text-amber-200">
          Хранилище заметок недоступно — вероятно, не применена миграция 082.
        </p>
      )}
      {loading && !data && <Skeleton className="h-32" />}

      {data && !notes.length && (
        <EmptyState title="Заметок пока нет" text="Первая заметка появится здесь — с вашим именем и временем." />
      )}

      {notes.map((n) => (
        <Panel key={n.id} bodyClassName="p-4">
          <div className="flex items-start justify-between gap-3">
            <p className="min-w-0 flex-1 whitespace-pre-wrap break-words text-sm text-slate-200">{n.body}</p>
            <div className="flex shrink-0 items-center gap-1">
              <button
                onClick={() => void togglePin(n)}
                title={n.pinned ? 'Открепить' : 'Закрепить'}
                aria-label={n.pinned ? 'Открепить заметку' : 'Закрепить заметку'}
                className={cx('rounded-lg p-1.5 transition-colors', n.pinned ? 'text-amber-300 hover:text-amber-200' : 'text-slate-600 hover:text-slate-300')}
              >
                {n.pinned ? <Pin size={13} /> : <PinOff size={13} />}
              </button>
              {mine(n) && (
                <button
                  onClick={() => setToDelete(n)}
                  title="Удалить"
                  aria-label="Удалить заметку"
                  className="rounded-lg p-1.5 text-slate-600 transition-colors hover:text-red-400"
                >
                  <Trash2 size={13} />
                </button>
              )}
            </div>
          </div>
          <p className="mt-2 text-[11px] text-slate-600">
            {n.author_email || n.author_id} · {fmtDateTime(n.created_at)}
            {n.updated_at !== n.created_at && ' · изменена'}
          </p>
        </Panel>
      ))}

      <ConfirmDialog
        open={!!toDelete}
        onClose={() => setToDelete(null)}
        onConfirm={remove}
        title="Удалить заметку?"
        text="Заметка исчезнет безвозвратно. Факт удаления останется в журнале."
        confirmLabel="Удалить"
      />
    </div>
  )
}
