'use client'

/**
 * components/assistant/mascot/MascotCoachmarks.tsx — spotlight tours (ТЗ v1.4).
 *
 * The onboarding format: a dimmed overlay with a bright cut-out around a REAL
 * interface element and the mascot's card next to it, arrow pointing at the
 * target. Steps come from lib/assistant/mascot/tours.ts; a step whose selector
 * matches nothing is skipped, so tours survive page evolution. Esc or
 * «Пропустить» ends the tour early — both mark the screen as toured.
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { MascotAvatar, type MascotColorId } from './MascotAvatar'
import type { MascotCharacterId } from '@/lib/assistant/mascot/characters'
import type { TourStep } from '@/lib/assistant/mascot/tours'
import { computeCoachmarkLayout } from '@/lib/assistant/mascot/coachmark-layout'

const PAD = 8

interface Rect {
  top: number
  left: number
  width: number
  height: number
}

function findTarget(selector: string): HTMLElement | null {
  const nodes = Array.from(document.querySelectorAll<HTMLElement>(selector))
  return nodes.find((n) => {
    const r = n.getBoundingClientRect()
    return r.width > 4 && r.height > 4
  }) ?? null
}

export function MascotCoachmarks({
  steps,
  character,
  color,
  onClose,
}: {
  steps: TourStep[]
  character: MascotCharacterId
  color: MascotColorId
  /** done=true — дошёл до конца; false — пропустил. Оба помечают экран. */
  onClose: (done: boolean) => void
}) {
  const [idx, setIdx] = useState(0)
  const [rect, setRect] = useState<Rect | null>(null)
  const [cardH, setCardH] = useState(200)
  const [waiting, setWaiting] = useState(false)
  const cardRef = useRef<HTMLDivElement | null>(null)
  const rafRef = useRef(0)

  const finish = useCallback((done: boolean) => onClose(done), [onClose])

  useEffect(() => {
    if (steps.length === 0) finish(false)
  }, [steps.length, finish])

  const step = steps[idx]

  // Wait for the current step's target: poll up to 3s, then auto-skip the step.
  useEffect(() => {
    if (!step) return
    let cancelled = false
    let tries = 0
    let timer: ReturnType<typeof setTimeout> | undefined
    setWaiting(true)
    setRect(null)
    const tryFind = () => {
      if (cancelled) return
      const el = findTarget(step.selector)
      if (el) {
        el.scrollIntoView({ block: 'center', behavior: 'smooth' })
        timer = setTimeout(() => {
          if (cancelled) return
          const r = el.getBoundingClientRect()
          setRect({ top: r.top, left: r.left, width: r.width, height: r.height })
          // Снимаем оверлей только вместе с rect — иначе карточка на 420мс
          // «мигает» в фолбэк-позиции (12,12) и прыгает к таргету.
          setWaiting(false)
        }, 420)
        return
      }
      tries += 1
      if (tries >= 12) {
        // target never appeared — skip this step (last step → finish as done)
        setWaiting(false)
        if (idx < steps.length - 1) setIdx((v) => v + 1)
        else finish(true)
        return
      }
      timer = setTimeout(tryFind, 250)
    }
    tryFind()
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idx, step?.selector])

  // Track the target rect on scroll/resize.
  useEffect(() => {
    if (!step) return
    const onMove = () => {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = requestAnimationFrame(() => {
        const el = findTarget(step.selector)
        if (!el) return
        const r = el.getBoundingClientRect()
        setRect({ top: r.top, left: r.left, width: r.width, height: r.height })
      })
    }
    window.addEventListener('resize', onMove)
    window.addEventListener('scroll', onMove, { passive: true, capture: true })
    return () => {
      cancelAnimationFrame(rafRef.current)
      window.removeEventListener('resize', onMove)
      window.removeEventListener('scroll', onMove, { capture: true })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idx, step?.selector])

  // Measure real card height (content varies per step).
  useLayoutEffect(() => {
    const h = cardRef.current?.offsetHeight
    if (h && h > 0) setCardH(h)
  }, [idx, rect])

  // Keyboard: Esc skips, arrows navigate.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') finish(false)
      if (e.key === 'ArrowRight' && idx < steps.length - 1) setIdx((v) => v + 1)
      if (e.key === 'ArrowLeft' && idx > 0) setIdx((v) => v - 1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [idx, steps.length, finish])

  if (!step || waiting) {
    // dim the page while waiting so the user sees the tour is in progress
    return step ? (
      <div className="fixed inset-0 z-[70] bg-black/50 flex items-center justify-center" aria-hidden>
        <div className="flex items-center gap-2 text-xs text-on-surface-variant">
          <span className="animate-pulse">🐾</span>
          <span>Ищу элемент… Esc — пропустить</span>
        </div>
      </div>
    ) : null
  }

  const vw = typeof window !== 'undefined' ? window.innerWidth : 1280
  const vh = typeof window !== 'undefined' ? window.innerHeight : 800
  const layout = computeCoachmarkLayout(rect, vw, vh, cardH)

  return (
    <div className="fixed inset-0 z-[70]" role="dialog" aria-modal="true" aria-label={`Обучение: ${step.title}`}>
      {/* Spotlight: the hole is the target, the shadow dims everything else. */}
      {rect ? (
        <motion.div
          aria-hidden
          initial={false}
          animate={{
            top: rect.top - PAD,
            left: rect.left - PAD,
            width: rect.width + PAD * 2,
            height: rect.height + PAD * 2,
          }}
          transition={{ type: 'spring', stiffness: 260, damping: 28 }}
          className="absolute rounded-2xl border-2 border-primary/70 pointer-events-none"
          style={{ boxShadow: '0 0 0 9999px rgba(4,6,10,0.74), 0 0 24px -4px rgba(110,255,192,0.35)' }}
        />
      ) : (
        <div aria-hidden className="absolute inset-0 bg-black/70" />
      )}

      {/* The mascot's card with an arrow to the target. */}
      <motion.div
        key={idx}
        ref={cardRef}
        initial={{ opacity: 0, y: layout.below ? 8 : -8, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.2 }}
        className="absolute rounded-2xl border border-white/[0.12] bg-[#12151c] shadow-2xl shadow-black/60 p-4"
        style={{
          width: layout.width,
          left: layout.left,
          top: layout.top,
        }}
      >
        {/* Arrow */}
        <div
          aria-hidden
          className={`absolute w-3.5 h-3.5 rotate-45 bg-[#12151c] ${
            layout.below
              ? '-top-[8px] border-t border-l border-white/[0.12]'
              : '-bottom-[8px] border-b border-r border-white/[0.12]'
          }`}
          style={{ left: layout.arrowLeft }}
        />

        <div className="flex items-start gap-3">
          <div className="shrink-0 w-11 h-11 rounded-full bg-surface-container-high flex items-center justify-center overflow-hidden">
            <MascotAvatar pose="hint" character={character} color={color} size={34} headOnly paused />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-bold text-on-surface leading-snug">{step.title}</p>
            <p className="text-xs text-on-surface-variant leading-relaxed mt-1">{step.text}</p>
          </div>
        </div>

        <div className="flex items-center justify-between mt-3.5">
          <button
            onClick={() => finish(false)}
            className="px-2.5 py-1.5 rounded-lg text-[11px] text-on-surface-variant hover:text-on-surface hover:bg-white/[0.06] transition-all"
          >
            Пропустить
          </button>
          <div className="flex items-center gap-1.5" aria-hidden>
            {steps.map((_, i) => (
              <span
                key={i}
                className={`h-1 rounded-full transition-all ${i === idx ? 'w-5 bg-primary' : 'w-1 bg-white/[0.18]'}`}
              />
            ))}
          </div>
          <div className="flex items-center gap-1.5">
            {idx > 0 && (
              <button
                onClick={() => setIdx((v) => v - 1)}
                className="px-3 py-1.5 rounded-lg text-xs text-on-surface-variant hover:text-on-surface hover:bg-white/[0.06] transition-all"
              >
                Назад
              </button>
            )}
            <button
              onClick={() => (idx === steps.length - 1 ? finish(true) : setIdx((v) => v + 1))}
              className="px-3.5 py-1.5 rounded-lg bg-primary text-[#003824] font-semibold text-xs hover:bg-primary/90 transition-colors"
            >
              {idx === steps.length - 1 ? 'Готово 🐾' : 'Дальше'}
            </button>
          </div>
        </div>
      </motion.div>
    </div>
  )
}
