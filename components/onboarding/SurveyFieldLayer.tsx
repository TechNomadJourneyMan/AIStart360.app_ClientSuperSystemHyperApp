'use client'

import { useEffect, useLayoutEffect, useRef, type ReactNode } from 'react'
import { opensAnswerEditor } from '@/lib/survey/answer-editor'
import { formatAttribution, type AnswerAttribution, type AttributionViewer } from '@/lib/survey/attribution-label'
import { isWritableSurveyKey } from '@/lib/survey/steps'

/**
 * Wraps a step form of the questionnaire (the 12 forms render their own
 * fields, each named by its question key: `id="s2n_goal_12m_what"`):
 *
 *  • a click on a text field (textarea, or an input marked
 *    `data-rich-editor`) opens the answer editor instead of typing inline
 *    (PO item 4.1). Keyboard users tabbing into the field still type inline;
 *    Alt+Enter in it opens the editor too;
 *  • under every answered field: the author line «Заполнил: вы · 22.10.2026»
 *    (PO item 4.2); none when the author is unknown. The line is a small element the layer keeps next to the
 *    field after every render; it never touches the forms' own markup.
 */
const LINE_ATTR = 'data-survey-attribution'
// The lines are DOM-only: no layout effect (and no React warning) while server-rendering.
const useDomEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect
const ICON: Record<string, string> = { user: 'person', expert: 'support_agent', admin: 'admin_panel_settings', ai: 'smart_toy', system: 'settings' }

export interface EditorRequest { key: string; title: string; hint: string | null }

function cssEscape(v: string): string {
  return typeof CSS !== 'undefined' && typeof CSS.escape === 'function' ? CSS.escape(v) : v.replace(/[^a-zA-Z0-9_-]/g, '\\$&')
}

/** The field's question text: its <label for>, without the «*» of required fields and the term-hint button / note. */
function labelOf(root: HTMLElement, key: string): string | null {
  const label = root.querySelector(`label[for="${cssEscape(key)}"]`)
  if (!label) return null
  const copy = label.cloneNode(true) as HTMLElement
  copy.querySelectorAll('[data-term-hint]').forEach((n) => n.remove())
  const text = copy.textContent?.replace(/\s+/g, ' ').replace(/\s*\*\s*$/, '').trim()
  return text || null
}

/** Where the line goes: the end of the field's block (the element holding its label), else right after the field. */
function placeLine(root: HTMLElement, field: HTMLElement, key: string, line: HTMLElement) {
  const label = root.querySelector(`label[for="${cssEscape(key)}"]`)
  let block: HTMLElement | null = field.parentElement
  for (let depth = 0; label && block && block !== root && depth < 3; depth += 1, block = block.parentElement) {
    if (block.contains(label)) {
      if (line.parentElement !== block || line !== block.lastElementChild) block.appendChild(line)
      return
    }
  }
  if (field.nextElementSibling !== line) field.insertAdjacentElement('afterend', line)
}

function syncLines(root: HTMLElement, attribution: Record<string, AnswerAttribution>, viewer: AttributionViewer) {
  const seen = new Set<string>()
  for (const [key, a] of Object.entries(attribution)) {
    const field = root.querySelector<HTMLElement>(`#${cssEscape(key)}`)
    const text = formatAttribution(a, viewer)
    // Unknown author (old answers): no line rather than «Автор не записан».
    if (!field || text === null) continue
    seen.add(key)
    let line = root.querySelector<HTMLElement>(`[${LINE_ATTR}="${cssEscape(key)}"]`)
    if (!line) {
      line = document.createElement('p')
      line.setAttribute(LINE_ATTR, key)
      line.className = 'mt-1.5 flex items-center gap-1 text-[11px] leading-tight text-on-surface-variant/70'
      const icon = document.createElement('span')
      icon.className = 'material-symbols-outlined text-[13px] text-on-surface-variant/50'
      icon.setAttribute('aria-hidden', 'true')
      const text = document.createElement('span')
      line.append(icon, text)
    }
    const iconName = ICON[a.updatedByRole ?? ''] ?? 'history'
    const [icon, label] = [line.children[0] as HTMLElement, line.children[1] as HTMLElement]
    if (icon.textContent !== iconName) icon.textContent = iconName
    if (label.textContent !== text) label.textContent = text // textContent: names never become markup
    placeLine(root, field, key, line)
  }
  root.querySelectorAll<HTMLElement>(`[${LINE_ATTR}]`).forEach((el) => {
    if (!seen.has(el.getAttribute(LINE_ATTR) ?? '')) el.remove()
  })
}

export default function SurveyFieldLayer({ children, attribution, viewer, onOpenEditor }: {
  children: ReactNode
  attribution: Record<string, AnswerAttribution>
  viewer: AttributionViewer
  onOpenEditor: (req: EditorRequest) => void
}) {
  const ref = useRef<HTMLDivElement>(null)

  // After every render: the step form may have mounted / moved fields.
  useDomEffect(() => {
    if (ref.current) syncLines(ref.current, attribution, viewer)
  })

  const target = (t: EventTarget | null): HTMLInputElement | HTMLTextAreaElement | null => {
    if (!(t instanceof HTMLTextAreaElement || t instanceof HTMLInputElement)) return null
    const ok = opensAnswerEditor(
      { tagName: t.tagName, id: t.id, type: t instanceof HTMLInputElement ? t.type : null, readOnly: t.readOnly, disabled: t.disabled, richEditor: t.hasAttribute('data-rich-editor') },
      isWritableSurveyKey,
    )
    return ok ? t : null
  }

  const open = (el: HTMLInputElement | HTMLTextAreaElement) => {
    const root = ref.current
    onOpenEditor({ key: el.id, title: (root && labelOf(root, el.id)) || 'Ответ', hint: el.placeholder?.trim() || null })
  }

  return (
    <div
      ref={ref}
      // A mouse press would focus the field and show the caret first; the
      // editor opens on the click instead.
      onMouseDown={(e) => { if (e.button === 0 && target(e.target)) e.preventDefault() }}
      onClick={(e) => {
        const el = target(e.target)
        if (!el) return
        e.preventDefault()
        el.blur()
        open(el)
      }}
      onKeyDown={(e) => {
        const el = e.key === 'Enter' && e.altKey ? target(e.target) : null
        if (el) { e.preventDefault(); open(el) }
      }}
    >
      {children}
    </div>
  )
}
