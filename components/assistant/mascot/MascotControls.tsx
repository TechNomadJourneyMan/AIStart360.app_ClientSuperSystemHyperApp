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

interface MascotControlsProps {
  onMinimize: () => void
  onHide: (period: HidePeriod) => void
  onClose: () => void
}

const ITEMS: Array<{ period: HidePeriod; icon: string; label: string }> = [
  { period: 'session', icon: 'visibility_off', label: 'Скрыть до конца сессии' },
  { period: '24h', icon: 'schedule', label: 'Скрыть на 24 часа' },
  { period: '7d', icon: 'date_range', label: 'Скрыть на 7 дней' },
  { period: 'forever', icon: 'block', label: 'Скрыть навсегда' },
]

export function MascotControls({ onMinimize, onHide, onClose }: MascotControlsProps) {
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
