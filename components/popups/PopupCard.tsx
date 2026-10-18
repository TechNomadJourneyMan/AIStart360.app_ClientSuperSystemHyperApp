'use client'

/**
 * components/popups/PopupCard.tsx — a pop-up card in the corner of the cabinet:
 * badge «Эксперт · имя», title, a short preview, quick reply, «Открыть диалог»,
 * «Позже» (3 / 7 / 30 days) and «Закрыть». Built on the project tokens only —
 * the look is to be replaced by the PO's design (spec §12.2).
 */
import { useEffect, useId, useState } from 'react'
import Link from 'next/link'
import { BTN_GHOST, BTN_PRIMARY, CARD, CHIP, Icon } from '@/components/point-a-v4/ui'
import { cn } from '@/lib/utils'
import { MAX_BODY } from '@/lib/comm/types'
import { POPUP_SNOOZE_DAYS, type PopupCandidate, type PopupSnoozeDays } from '@/lib/popups/types'

export interface PopupViewProps {
  popup: PopupCandidate
  onDismiss: () => void | Promise<void>
  onSnooze: (days: PopupSnoozeDays) => void | Promise<void>
  onReply: (text: string) => Promise<void>
}

const SNOOZE_LABEL: Record<PopupSnoozeDays, string> = { 3: '3 дня', 7: '7 дней', 30: '30 дней' }

export const BADGE_TEXT = (p: PopupCandidate) =>
  p.kind === 'expert_message' ? `Эксперт${p.authorName ? ` · ${p.authorName}` : ''}` : p.kind === 'recommendation' ? 'Проверено экспертом' : 'Подсказка платформы'

/** Quick reply: a button that opens a text field; sends to the user's own conversation. */
export function PopupReply({ onReply, autoFocus = false }: { onReply: (text: string) => Promise<void>; autoFocus?: boolean }) {
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const id = useId()

  const send = async () => {
    if (!text.trim() || sending) return
    setSending(true)
    setError(null)
    try {
      await onReply(text)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось отправить ответ')
      setSending(false)
    }
  }

  return (
    <div className="space-y-2">
      <label htmlFor={id} className="sr-only">Ваш ответ эксперту</label>
      <textarea
        id={id}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void send() } }}
        rows={3}
        maxLength={MAX_BODY}
        // eslint-disable-next-line jsx-a11y/no-autofocus
        autoFocus={autoFocus}
        placeholder="Напишите ответ…"
        className="w-full resize-y rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-base text-on-surface placeholder:text-on-surface-variant/60 focus:border-primary/40 focus:outline-none sm:text-sm"
      />
      {error && <p role="alert" className="text-xs text-error">{error}</p>}
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] text-on-surface-variant">Ctrl+Enter — отправить</span>
        <button type="button" onClick={() => void send()} disabled={sending || !text.trim()} className={BTN_PRIMARY}>
          <Icon name="send" className="text-sm" />
          {sending ? 'Отправляем…' : 'Отправить'}
        </button>
      </div>
    </div>
  )
}

/** «Позже» with the three snooze lengths (native <details>: works from the keyboard, no state). */
export function PopupSnooze({ onSnooze }: { onSnooze: (days: PopupSnoozeDays) => void | Promise<void> }) {
  return (
    <details className="group relative">
      <summary className={cn(BTN_GHOST, 'cursor-pointer list-none [&::-webkit-details-marker]:hidden')}>Позже</summary>
      <div role="group" aria-label="Напомнить через" className="mt-2 flex flex-wrap gap-1.5">
        {POPUP_SNOOZE_DAYS.map((d) => (
          <button key={d} type="button" onClick={() => void onSnooze(d)} className={cn(BTN_GHOST, 'px-2.5')}>{SNOOZE_LABEL[d]}</button>
        ))}
      </div>
    </details>
  )
}

export function PopupCard({ popup, onDismiss, onSnooze, onReply }: PopupViewProps) {
  const titleId = useId()
  const [replying, setReplying] = useState(false)
  const [entered, setEntered] = useState(false)
  useEffect(() => { setEntered(true) }, [])

  return (
    <article
      aria-labelledby={titleId}
      className={cn(
        CARD, 'pointer-events-auto w-full space-y-3 shadow-xl shadow-black/40',
        // Under prefers-reduced-motion the `motion-safe:` classes do not apply: no animation.
        'motion-safe:transition-all motion-safe:duration-200',
        !entered && 'motion-safe:translate-y-2 motion-safe:opacity-0',
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <span className={cn(CHIP, 'bg-primary/10 text-primary')}>{BADGE_TEXT(popup)}</span>
        <button type="button" onClick={() => void onDismiss()} aria-label="Закрыть" className="-mr-1 -mt-1 rounded-lg p-1 text-on-surface-variant hover:text-on-surface focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
          <Icon name="close" className="text-base" />
        </button>
      </div>
      <div>
        <h2 id={titleId} className="text-sm font-semibold text-on-surface">{popup.title}</h2>
        <p className="mt-1 line-clamp-3 whitespace-pre-wrap break-words text-sm text-on-surface-variant">{popup.body}</p>
      </div>
      {replying && popup.canReply && <PopupReply onReply={onReply} autoFocus />}
      <div className="flex flex-wrap items-start gap-1.5">
        {popup.canReply && !replying && (
          <button type="button" onClick={() => setReplying(true)} className={BTN_PRIMARY}>
            <Icon name="reply" className="text-sm" />
            Ответить
          </button>
        )}
        {popup.href && (
          <Link href={popup.href} onClick={() => void onDismiss()} className={BTN_GHOST}>Открыть диалог</Link>
        )}
        <PopupSnooze onSnooze={onSnooze} />
      </div>
    </article>
  )
}
