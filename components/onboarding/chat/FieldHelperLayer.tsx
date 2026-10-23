'use client'

/**
 * Adds a «Помощник» button to the label of every chat-able question of a step
 * form (spec §8.10) without touching the 12 forms: like the author line of
 * SurveyFieldLayer, the button is a small DOM element kept next to
 * `label[for=<question key>]` after every render. A click opens
 * FieldHelperPanel; «Записать» there calls `onApply(key, value)` — the page
 * puts the value into its form state (origin 'chat' → path «helper»).
 *
 * The button carries `data-term-hint` so the answer editor's label reader
 * (SurveyFieldLayer.labelOf) ignores it like the term hints.
 */
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { SURVEY_QUESTIONS } from '@/lib/survey/questions'
import { FieldHelperPanel } from './FieldHelperPanel'
import type { ChatTransport } from './useSurveyChat'

const ATTR = 'data-survey-helper'
const useDomEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect

/** Keys the helper is offered for: questions the chat asks (not tables, files, contacts, auto years). */
export function helperKeyAllowed(key: string): boolean {
  return SURVEY_QUESTIONS[key]?.chat === 'ask'
}

function syncButtons(root: HTMLElement) {
  root.querySelectorAll<HTMLLabelElement>('label[for]').forEach((label) => {
    const key = label.htmlFor
    if (!helperKeyAllowed(key) || label.querySelector(`[${ATTR}]`)) return
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.setAttribute(ATTR, key)
    btn.setAttribute('data-term-hint', '')
    btn.setAttribute('aria-label', 'Помощник: объяснить вопрос и помочь ответить')
    btn.title = 'Помощник: объяснит вопрос, подскажет, где взять цифру, поможет ответить'
    btn.className = 'ml-2 inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 align-middle text-[10px] normal-case tracking-normal text-primary/80 hover:bg-primary/10 hover:text-primary'
    const icon = document.createElement('span')
    icon.className = 'material-symbols-outlined text-[14px]'
    icon.setAttribute('aria-hidden', 'true')
    icon.textContent = 'forum'
    const text = document.createElement('span')
    text.className = 'hidden sm:inline'
    text.textContent = 'Помощник'
    btn.append(icon, text)
    label.appendChild(btn)
  })
}

export function FieldHelperLayer({ children, onApply, enabled = true, transport }: {
  children: ReactNode
  onApply: (key: string, value: unknown) => void
  enabled?: boolean
  transport?: ChatTransport
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState<string | null>(null)

  useDomEffect(() => {
    if (enabled && ref.current) syncButtons(ref.current)
  })

  return (
    <div
      ref={ref}
      onClickCapture={(e) => {
        const btn = (e.target as HTMLElement | null)?.closest?.(`[${ATTR}]`)
        if (!btn) return
        // A click in a <label> would focus the field (and open the answer editor).
        e.preventDefault()
        e.stopPropagation()
        setOpen(btn.getAttribute(ATTR))
      }}
    >
      {children}
      {open && (
        <FieldHelperPanel
          fieldKey={open}
          transport={transport}
          onApply={(k, v) => { onApply(k, v); setOpen(null) }}
          onClose={() => setOpen(null)}
        />
      )}
    </div>
  )
}
