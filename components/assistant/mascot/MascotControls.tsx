'use client'

/**
 * components/assistant/mascot/MascotControls.tsx — the «⋯» management menu.
 *
 * Small popover above the mascot (ТЗ §5/§7 scenario 8): minimize, timed hides,
 * hide forever and a link to Settings › Ассистент. Esc/outside-click closes;
 * items are plain buttons (keyboard-reachable).
 */

import { useEffect, useRef } from 'react'
import Link from 'next/link'
import { motion } from 'framer-motion'
import type { HidePeriod } from '@/lib/assistant/mascot/types'

/** Раздел «Обучение»: быстрый тур другого раздела (переход + запуск тура). */
export interface SectionTour {
  label: string
  /** Нормализованный экран (ключ TOURS). */
  screen: string
  /** Куда вести router.push. */
  href: string
}

interface MascotControlsProps {
  /** Имя выбранного персонажа для пункта «Инсайт от …». */
  characterName?: string
  onMinimize: () => void
  onHide: (period: HidePeriod) => void
  /** Present only when AI insights are enabled in settings. */
  onInsight?: () => void
  /** «Тур по этой странице» — present only when the current screen has a tour. */
  onPageTour?: () => void
  /** «Экскурсия по порталу» — (пере)запуск онбординг-экскурсии. */
  onStartTourGuide?: () => void
  /** Ключевые разделы текущей роли с турами (без текущего экрана). */
  sectionTours?: SectionTour[]
  onSectionTour?: (screen: string, href: string) => void
  onClose: () => void
}

const ITEMS: Array<{ period: HidePeriod; icon: string; label: string }> = [
  { period: 'session', icon: 'visibility_off', label: 'Скрыть до конца сессии' },
  { period: '24h', icon: 'schedule', label: 'Скрыть на 24 часа' },
  { period: '7d', icon: 'date_range', label: 'Скрыть на 7 дней' },
  { period: 'forever', icon: 'block', label: 'Скрыть навсегда' },
]

export function MascotControls({
  characterName = 'Гри',
  onMinimize,
  onHide,
  onInsight,
  onPageTour,
  onStartTourGuide,
  sectionTours,
  onSectionTour,
  onClose,
}: MascotControlsProps) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('pointerdown', onDown)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('pointerdown', onDown)
    }
  }, [onClose])

  const item =
    'w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-left text-xs text-on-surface hover:bg-white/[0.06] transition-colors'

  const hasLearning =
    !!onStartTourGuide || !!onPageTour || (!!sectionTours && sectionTours.length > 0)

  return (
    <motion.div
      ref={ref}
      role="menu"
      aria-label="Управление ассистентом"
      initial={{ opacity: 0, scale: 0.95, y: 4 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.97, y: 3 }}
      transition={{ duration: 0.14 }}
      className="w-56 rounded-2xl border border-white/[0.1] bg-[#12151c]/95 backdrop-blur-sm shadow-xl shadow-black/40 p-1.5"
    >
      {onInsight && (
        <button role="menuitem" className={item} onClick={onInsight}>
          <span className="material-symbols-outlined text-base text-primary">tips_and_updates</span>
          Инсайт от {characterName}
        </button>
      )}

      {hasLearning && (
        <>
          {onInsight && <div className="my-1 border-t border-white/[0.06]" />}
          <p className="px-3 pt-1 pb-1 text-[10px] font-mono uppercase tracking-[0.18em] text-on-surface-variant/60">
            Обучение
          </p>
          {onStartTourGuide && (
            <button role="menuitem" className={item} onClick={onStartTourGuide}>
              <span className="material-symbols-outlined text-base text-primary">tour</span>
              Экскурсия по порталу
            </button>
          )}
          {onPageTour && (
            <button role="menuitem" className={item} onClick={onPageTour}>
              <span className="material-symbols-outlined text-base text-on-surface-variant">school</span>
              Тур по этой странице
            </button>
          )}
          {sectionTours?.map((t) => (
            <button
              key={t.screen}
              role="menuitem"
              className={item}
              onClick={() => onSectionTour?.(t.screen, t.href)}
            >
              <span className="material-symbols-outlined text-base text-on-surface-variant/70">
                chevron_right
              </span>
              {t.label}
            </button>
          ))}
        </>
      )}

      <div className="my-1 border-t border-white/[0.06]" />
      <button role="menuitem" className={item} onClick={onMinimize}>
        <span className="material-symbols-outlined text-base text-on-surface-variant">minimize</span>
        Свернуть
      </button>
      <div className="my-1 border-t border-white/[0.06]" />
      {ITEMS.map((i) => (
        <button key={i.period} role="menuitem" className={item} onClick={() => onHide(i.period)}>
          <span className="material-symbols-outlined text-base text-on-surface-variant">{i.icon}</span>
          {i.label}
        </button>
      ))}
      <div className="my-1 border-t border-white/[0.06]" />
      <Link role="menuitem" href="/settings" onClick={onClose} className={item}>
        <span className="material-symbols-outlined text-base text-on-surface-variant">settings</span>
        Настройки ассистента
      </Link>
    </motion.div>
  )
}
