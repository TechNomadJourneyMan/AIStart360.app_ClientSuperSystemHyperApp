'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { Pencil, Sparkles, Trash2 } from 'lucide-react'
import { Badge, Button, GigaApiError, cx, fmtDateTime, gigaFetch, inputClass } from '../../kit'
import type { DraftComment } from './types'

/** Черновой комментарий: чтение, правка на месте, удаление. */
export function CommentItem({ userId, comment, onChanged, onDelete }: {
  userId: string
  comment: DraftComment
  onChanged: () => void
  onDelete: (c: DraftComment) => void
}) {
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState(comment.text)
  const [busy, setBusy] = useState(false)
  const flags = comment.ai_flags ?? []
  const hasError = flags.some((f) => f.severity === 'error')

  const save = async () => {
    if (!text.trim()) return
    setBusy(true)
    try {
      await gigaFetch(`/api/giga-admin/users/${userId}/review/comments/${comment.id}`, { method: 'PUT', json: { text: text.trim() } })
      toast.success('Комментарий сохранён')
      setEditing(false)
      onChanged()
    } catch (e) {
      toast.error(e instanceof GigaApiError ? e.message : 'Не удалось сохранить')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={cx('rounded-xl border bg-white/[0.02] p-3', hasError ? 'border-red-500/30' : 'border-white/[0.06]')}>
      {editing ? (
        <>
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={5} maxLength={5000} className={inputClass} aria-label="Текст комментария" />
          <div className="mt-2 flex items-center justify-between">
            <span className="text-[11px] text-slate-600">{text.length}/5000</span>
            <div className="flex gap-2">
              <Button size="sm" variant="ghost" onClick={() => { setText(comment.text); setEditing(false) }} disabled={busy}>Отмена</Button>
              <Button size="sm" variant="primary" loading={busy} disabled={!text.trim()} onClick={() => void save()}>Сохранить</Button>
            </div>
          </div>
        </>
      ) : (
        <div className="flex items-start justify-between gap-3">
          <p className="min-w-0 flex-1 whitespace-pre-wrap break-words text-sm text-slate-200">{comment.text}</p>
          <div className="flex shrink-0 items-center gap-1">
            <button type="button" onClick={() => setEditing(true)} aria-label="Изменить комментарий" title="Изменить" className="rounded-lg p-1.5 text-slate-500 hover:text-slate-200">
              <Pencil size={13} />
            </button>
            <button type="button" onClick={() => onDelete(comment)} aria-label="Удалить комментарий" title="Удалить" className="rounded-lg p-1.5 text-slate-500 hover:text-red-400">
              <Trash2 size={13} />
            </button>
          </div>
        </div>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px] text-slate-600">
        {comment.source === 'ai' && <Badge tone="violet"><Sparkles size={10} /> ИИ-черновик</Badge>}
        <span>{comment.author_name ?? 'Эксперт'} · {fmtDateTime(comment.updated_at)}</span>
      </div>
      {flags.length > 0 && (
        <ul className="mt-2 space-y-1">
          {flags.map((f, i) => (
            <li key={i} className={cx('text-[11px]', f.severity === 'error' ? 'text-red-300' : 'text-amber-300')}>
              {f.severity === 'error' ? 'Ошибка проверки: ' : 'Проверьте: '}{f.note}
            </li>
          ))}
          <li className="text-[10px] text-slate-600">Отредактируйте и сохраните текст — пометки снимутся.</li>
        </ul>
      )}
    </div>
  )
}
