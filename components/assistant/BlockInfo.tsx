'use client'

/**
 * components/assistant/BlockInfo.tsx
 *
 * The per-block "?" affordance. Drop it into ANY block/card header to give the
 * user an inline explanation of what the block is and what it does — modelled on
 * the GRI "Что такое GRI?" popover (GRIAssessmentRadarWidget).
 *
 *   <BlockInfo title="Ключевые метрики">
 *     <p><b>Что это:</b> 6 главных KPI вашего бизнеса…</p>
 *     <p><b>Что делает:</b> …</p>
 *   </BlockInfo>
 *
 * Or the shorthand with a single string:
 *   <BlockInfo title="…" description="…" />
 *
 * Behaviour: a round "?" icon button toggles an anchored popover. Closes on Esc,
 * outside-click, or its own ✕. As a secondary action the popover offers "Спросить
 * ассистента" which opens the global Smart Assistant with this block as context.
 *
 * Self-contained: no parent positioning required (wrapper is `relative`).
 * Copy is Russian (matches the portal UI); pass already-localized content.
 */

import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { useAssistant } from './AssistantProvider'

interface BlockInfoProps {
  /** Block name shown as the popover heading, e.g. "Ключевые метрики". */
  title: string
  /** Shorthand body when you don't need rich markup. */
  description?: string
  /** Rich body — overrides `description` when provided. */
  children?: ReactNode
  /** Which side the popover aligns to (default 'right' → opens leftward). */
  align?: 'left' | 'right'
  /** Hide the "Спросить ассистента" footer action. */
  hideAssistant?: boolean
  className?: string
}

export function BlockInfo({
  title,
  description,
  children,
  align = 'right',
  hideAssistant = false,
  className = '',
}: BlockInfoProps) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLSpanElement | null>(null)
  const { openAssistant } = useAssistant()
  const labelId = useId()

  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    function onClick(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onClick)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('mousedown', onClick)
    }
  }, [open])

  return (
    <span ref={wrapRef} className={`relative inline-flex ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={`Что это: ${title}`}
        aria-expanded={open}
        className="w-6 h-6 rounded-full bg-surface-container-high hover:bg-primary/15 text-on-surface-variant hover:text-primary flex items-center justify-center transition-colors focus:outline-none focus:ring-2 focus:ring-primary/40"
      >
        <span className="material-symbols-outlined text-[14px]">help</span>
      </button>

      {open && (
        <div
          role="dialog"
          aria-labelledby={labelId}
          className={`absolute top-full mt-2 z-50 w-80 max-w-[calc(100vw-2rem)] bg-surface-container-high border border-white/10 rounded-2xl shadow-modal p-4 animate-in fade-in slide-in-from-top-1 duration-150 ${
            align === 'right' ? 'right-0' : 'left-0'
          }`}
        >
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Закрыть"
            className="absolute top-2 right-2 w-6 h-6 rounded-full hover:bg-white/[0.06] text-on-surface-variant hover:text-on-surface flex items-center justify-center transition-colors focus:outline-none focus:ring-2 focus:ring-primary/40"
          >
            <span className="material-symbols-outlined text-[16px]">close</span>
          </button>

          <h4
            id={labelId}
            className="font-headline text-base font-bold text-on-surface mb-2 pr-6"
          >
            {title}
          </h4>

          <div className="space-y-2.5 text-[12px] leading-relaxed text-on-surface-variant [&_b]:text-on-surface [&_strong]:text-on-surface">
            {children ?? (description ? <p>{description}</p> : null)}
          </div>

          {!hideAssistant && (
            <div className="mt-4 pt-3 border-t border-white/[0.06]">
              <button
                type="button"
                onClick={() => {
                  setOpen(false)
                  openAssistant({ topic: title })
                }}
                className="inline-flex items-center gap-1.5 text-[12px] font-mono text-primary hover:text-primary/80 transition-colors focus:outline-none focus:ring-2 focus:ring-primary/40 rounded"
              >
                <span className="material-symbols-outlined text-[14px]">assistant</span>
                Спросить ассистента
              </button>
            </div>
          )}
        </div>
      )}
    </span>
  )
}

export default BlockInfo
