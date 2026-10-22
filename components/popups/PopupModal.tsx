'use client'

/**
 * components/popups/PopupModal.tsx — the modal window, only for what is important:
 * an expert message «важное / требует ответа», or a critical Point B insight
 * (e.g. a cash gap in the first months — the server decides `display`). Focus moves into the dialog and
 * is trapped there, Esc closes it, focus returns to where it was; on a phone
 * it fills the screen. Built on the project tokens (spec §12.2).
 */
import { useEffect, useId, useRef } from 'react'
import Link from 'next/link'
import { BTN_GHOST, BTN_PRIMARY, CARD, CHIP, Icon } from '@/components/point-a-v4/ui'
import { cn } from '@/lib/utils'
import { nextTrapIndex } from './popupController'
import { BADGE_CLASS, BADGE_TEXT, OPEN_LABEL, PopupReply, PopupSnooze, PopupWhy, type PopupViewProps } from './PopupCard'

const FOCUSABLE = 'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), summary, [tabindex]:not([tabindex="-1"])'

export function PopupModal({ popup, onDismiss, onSnooze, onReply, onOpen }: PopupViewProps) {
  const titleId = useId()
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    const root = rootRef.current
    // Reply field first (the message asks for an answer), else the first control.
    const first = root?.querySelector<HTMLElement>('textarea') ?? root?.querySelector<HTMLElement>(FOCUSABLE)
    first?.focus()
    return () => { previous?.focus?.() }
  }, [])

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.stopPropagation()
      void onDismiss()
      return
    }
    if (e.key !== 'Tab') return
    const items = Array.from(rootRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])
    const target = nextTrapIndex(items.length, items.indexOf(document.activeElement as HTMLElement), e.shiftKey)
    if (target !== null) {
      e.preventDefault()
      items[target]?.focus()
    }
  }

  return (
    <div data-popup-layer className="fixed inset-0 z-[55] flex items-stretch justify-center bg-black/60 sm:items-center sm:p-4">
      <div
        ref={rootRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onKeyDown={onKeyDown}
        className={cn(CARD, 'flex h-full w-full flex-col gap-4 overflow-y-auto rounded-none shadow-2xl shadow-black/50 sm:h-auto sm:max-h-[90vh] sm:max-w-lg sm:rounded-2xl')}
      >
        <div className="flex items-start justify-between gap-2">
          <span className={cn(CHIP, BADGE_CLASS(popup))}>{BADGE_TEXT(popup)}</span>
          <button type="button" onClick={() => void onDismiss()} aria-label="Закрыть" className="-mr-1 -mt-1 rounded-lg p-1 text-on-surface-variant hover:text-on-surface focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
            <Icon name="close" className="text-base" />
          </button>
        </div>
        <div className="min-h-0">
          <h2 id={titleId} className="font-headline text-lg font-bold text-on-surface">{popup.title}</h2>
          <p className="mt-2 whitespace-pre-wrap break-words text-sm text-on-surface-variant">{popup.body}</p>
        </div>
        <PopupWhy popup={popup} />
        {popup.canReply && <PopupReply onReply={onReply} />}
        <div className="mt-auto flex flex-wrap items-start gap-1.5">
          {popup.href && <Link href={popup.href} onClick={() => void (onOpen ?? onDismiss)()} className={popup.kind === 'expert_message' ? BTN_GHOST : BTN_PRIMARY}>{OPEN_LABEL(popup)}</Link>}
          <PopupSnooze onSnooze={onSnooze} />
        </div>
      </div>
    </div>
  )
}
