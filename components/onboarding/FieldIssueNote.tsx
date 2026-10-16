'use client'

/**
 * Ошибка сервера рядом с конкретным вопросом анкеты (например, «Уберите
 * нецензурные слова…»). Шаги анкеты рисуют поля с id = ключ вопроса, поэтому
 * подсказка находит поле по ключу, подсвечивает его, прокручивает к нему и
 * показывает текст прямо под ним — без правок в каждой из 12 форм.
 * Подсказка рисуется порталом в body (React-дерево формы не трогаем).
 */

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'

function cssEscape(s: string): string {
  return typeof CSS !== 'undefined' && typeof CSS.escape === 'function' ? CSS.escape(s) : s.replace(/["\\]/g, '\\$&')
}

/** Поле вопроса на странице: id = ключ, иначе name = ключ. */
export function findQuestionField(key: string): HTMLElement | null {
  if (typeof document === 'undefined' || !key) return null
  return document.getElementById(key) ?? document.querySelector<HTMLElement>(`[name="${cssEscape(key)}"]`)
}

/** Подпись вопроса (текст <label for=key>), если есть. */
export function questionLabel(key: string): string | null {
  if (typeof document === 'undefined' || !key) return null
  const text = document.querySelector(`label[for="${cssEscape(key)}"]`)?.textContent?.replace(/\s*\*\s*$/, '').trim()
  return text || null
}

interface Pos { top: number; left: number; width: number }

export default function FieldIssueNote({ fieldKey, message }: { fieldKey: string; message: string }) {
  const [pos, setPos] = useState<Pos | null>(null)

  useEffect(() => {
    const el = findQuestionField(fieldKey)
    if (!el) {
      setPos(null)
      return
    }
    const prevOutline = el.style.outline
    const prevOffset = el.style.outlineOffset
    el.setAttribute('aria-invalid', 'true')
    el.style.outline = '1px solid #f87171'
    el.style.outlineOffset = '1px'
    el.scrollIntoView({ block: 'center', behavior: 'smooth' })

    const place = () => {
      const r = el.getBoundingClientRect()
      setPos({ top: r.bottom + window.scrollY + 6, left: r.left + window.scrollX, width: r.width })
    }
    place()
    window.addEventListener('scroll', place, true)
    window.addEventListener('resize', place)
    return () => {
      window.removeEventListener('scroll', place, true)
      window.removeEventListener('resize', place)
      el.removeAttribute('aria-invalid')
      el.style.outline = prevOutline
      el.style.outlineOffset = prevOffset
    }
  }, [fieldKey])

  if (!pos || typeof document === 'undefined') return null
  return createPortal(
    <p
      role="alert"
      style={{ position: 'absolute', top: pos.top, left: pos.left, maxWidth: Math.max(pos.width, 220) }}
      className="z-50 rounded-lg border border-error/40 bg-surface-container-high px-3 py-1.5 text-xs text-error shadow-lg"
    >
      {message}
    </p>,
    document.body,
  )
}
