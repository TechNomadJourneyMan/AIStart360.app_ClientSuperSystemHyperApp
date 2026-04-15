'use client'

import { useState, useRef } from 'react'
import { BLOCK_ORDER, BLOCK_LABELS, type BlockKey } from '@/lib/expert-blocks'

interface Props {
  clientId: string
  onPosted?: () => void
}

type SelectedBlock = BlockKey | 'general'

export function CommentComposer({ clientId, onPosted }: Props) {
  const [text, setText] = useState('')
  const [blockKey, setBlockKey] = useState<SelectedBlock>('general')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    const trimmed = text.trim()
    if (!trimmed) {
      setError('Введите текст комментария')
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch('/api/expert/comments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientId,
          blockKey: blockKey === 'general' ? null : blockKey,
          text: trimmed,
        }),
      })
      if (!res.ok) {
        const json = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(json.error ?? 'Не удалось опубликовать комментарий')
      }
      setText('')
      setBlockKey('general')
      onPosted?.()
      textareaRef.current?.focus()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Неизвестная ошибка')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form
      onSubmit={submit}
      className="rounded-2xl bg-surface-container-low border border-white/[0.04] p-4 space-y-3"
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="material-symbols-outlined text-[18px] text-primary/70">
            forum
          </span>
          <span className="text-xs font-mono uppercase tracking-[0.2em] text-on-surface-variant">
            Новый комментарий
          </span>
        </div>
        <label className="flex items-center gap-2 text-[11px] text-on-surface-variant">
          <span className="hidden sm:inline">Блок:</span>
          <select
            value={blockKey}
            onChange={(e) => setBlockKey(e.target.value as SelectedBlock)}
            disabled={submitting}
            className="rounded-lg bg-surface-container border border-white/[0.06] text-xs text-on-surface px-2 py-1.5 focus:outline-none focus:border-primary/40 transition-all"
          >
            <option value="general">Общее</option>
            {BLOCK_ORDER.map((k) => (
              <option key={k} value={k}>
                {BLOCK_LABELS[k]}
              </option>
            ))}
          </select>
        </label>
      </div>

      <textarea
        ref={textareaRef}
        value={text}
        onChange={(e) => setText(e.target.value)}
        disabled={submitting}
        rows={3}
        maxLength={5000}
        placeholder="Напишите комментарий для клиента..."
        className="w-full rounded-xl bg-surface-container border border-white/[0.06] text-sm text-on-surface placeholder:text-on-surface-variant/60 px-3 py-2.5 focus:outline-none focus:border-primary/40 transition-all resize-none"
      />

      {error && (
        <p className="text-xs text-error flex items-center gap-1.5">
          <span className="material-symbols-outlined text-[14px]">error</span>
          {error}
        </p>
      )}

      <div className="flex items-center justify-between">
        <p className="text-[10px] text-on-surface-variant/60">
          {text.length} / 5000
        </p>
        <button
          type="submit"
          disabled={submitting || text.trim().length === 0}
          className="inline-flex items-center gap-1.5 rounded-xl bg-primary/15 hover:bg-primary/25 border border-primary/30 text-primary text-xs font-medium px-4 py-2 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {submitting ? (
            <>
              <span className="material-symbols-outlined text-[14px] animate-spin">
                progress_activity
              </span>
              Публикация...
            </>
          ) : (
            <>
              <span className="material-symbols-outlined text-[14px]">send</span>
              Опубликовать
            </>
          )}
        </button>
      </div>
    </form>
  )
}
