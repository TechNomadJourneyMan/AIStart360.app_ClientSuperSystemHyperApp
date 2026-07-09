'use client'

/**
 * components/assistant/mascot/MascotWelcome.tsx — welcome-модалка первого входа.
 *
 * Один раз для нового пользователя (settings.greeted=false и
 * tourGuide.status='pending'): центрированная тёмная карточка от Гри с выбором —
 * «Провести экскурсию» или «Разберусь сам». Заменяет прежний пер-страничный
 * автозапуск туров (он ощущался как «туры постоянно»). Показ гейтит
 * MascotAssistant; сам движок экскурсии — Батч B.
 *
 * a11y: role="dialog" aria-modal, Esc = «Разберусь сам», клик по подложке =
 * отказ, Tab зациклен внутри диалога (минимальный focus-trap), после закрытия
 * фокус возвращается на кнопку-аватар маскота. Анимации уважают
 * prefers-reduced-motion.
 */

import { useEffect, useRef } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import type { MascotCharacterId } from '@/lib/assistant/mascot/characters'
import { MascotAvatar, type MascotColorId } from './MascotAvatar'

interface MascotWelcomeProps {
  characterName: string
  character: MascotCharacterId
  color: MascotColorId
  /** «Провести экскурсию» — primary. */
  onStartTour: () => void
  /** «Разберусь сам» / Esc / клик по подложке. */
  onDismiss: () => void
}

export function MascotWelcome({
  characterName,
  character,
  color,
  onStartTour,
  onDismiss,
}: MascotWelcomeProps) {
  const reduced = useReducedMotion()
  const dialogRef = useRef<HTMLDivElement>(null)

  // Esc = «Разберусь сам» + минимальный focus-trap: Tab/Shift+Tab зациклены на
  // фокусируемых элементах диалога. Захватываем на capture, чтобы отработать
  // раньше прочих слушателей маскота (пузырь/меню сейчас всё равно закрыты).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onDismiss()
        return
      }
      if (e.key !== 'Tab') return
      const root = dialogRef.current
      if (!root) return
      const focusables = Array.from(
        root.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        ),
      )
      const first = focusables[0]
      const last = focusables[focusables.length - 1]
      if (!first || !last) return
      const active = document.activeElement
      const inside = active instanceof Node && root.contains(active)
      if (e.shiftKey) {
        if (!inside || active === first) {
          e.preventDefault()
          last.focus()
        }
      } else if (!inside || active === last) {
        e.preventDefault()
        first.focus()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onDismiss])

  // После закрытия возвращаем фокус на кнопку-аватар маскота (постоянный якорь;
  // элемент, с которого открылась модалка, к этому моменту может исчезнуть).
  useEffect(
    () => () => {
      document
        .querySelector<HTMLElement>('button[aria-label*="открыть чат с ассистентом"]')
        ?.focus()
    },
    [],
  )

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <motion.div
        aria-hidden
        onClick={onDismiss}
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        initial={reduced ? false : { opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.2 }}
      />
      <motion.div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="mascot-welcome-title"
        aria-describedby="mascot-welcome-body"
        initial={reduced ? false : { opacity: 0, scale: 0.94, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.97, y: 6 }}
        transition={{ duration: 0.22, ease: [0.2, 0.7, 0.3, 1] }}
        className="relative w-full max-w-sm rounded-3xl border border-white/[0.1] bg-[#12151c]/98 p-6 text-center shadow-2xl shadow-black/50"
      >
        <div className="mb-4 flex justify-center">
          <MascotAvatar pose="greeting" character={character} color={color} size={112} paused />
        </div>
        <h2
          id="mascot-welcome-title"
          className="font-headline text-xl font-extrabold text-on-surface"
        >
          Привет! Я {characterName} 🐾
        </h2>
        <p
          id="mascot-welcome-body"
          className="mx-auto mt-2.5 max-w-xs text-sm leading-relaxed text-on-surface-variant"
        >
          Помогу разобраться в портале: проведу по главным разделам и покажу, с чего начать. Это
          займёт ~2 минуты.
        </p>
        <div className="mt-6 flex flex-col gap-2">
          <button
            autoFocus
            onClick={onStartTour}
            className="w-full rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-on-primary transition-colors hover:bg-primary/90 focus:outline-none focus:ring-2 focus:ring-primary/50 focus:ring-offset-2 focus:ring-offset-[#12151c]"
          >
            Провести экскурсию
          </button>
          <button
            onClick={onDismiss}
            className="w-full rounded-xl px-4 py-2.5 text-sm font-medium text-on-surface-variant transition-colors hover:bg-white/[0.06] focus:outline-none focus:ring-2 focus:ring-white/20"
          >
            Разберусь сам
          </button>
        </div>
      </motion.div>
    </div>
  )
}
