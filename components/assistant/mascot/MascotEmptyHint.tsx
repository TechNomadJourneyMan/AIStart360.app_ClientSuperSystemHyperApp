'use client'

/**
 * components/assistant/mascot/MascotEmptyHint.tsx — единый empty-state «от Гри».
 *
 * Маленькая карточка: аватар маскота + короткая реплика + одна рабочая CTA
 * (внутренняя ссылка href ИЛИ onClick-обработчик). Пустое состояние перестаёт
 * быть тупиком — Гри объясняет, что это значит, и ведёт к следующему шагу.
 *
 * Презентационный: НЕ трогает стор и логику страниц. character/color по
 * умолчанию «кот Гри / рыжий» (продуктовый дефолт); аватар статичен (paused).
 */

import Link from 'next/link'
import type { MascotCharacterId } from '@/lib/assistant/mascot/characters'
import type { MascotState } from '@/lib/assistant/mascot/types'
import { MascotAvatar, type MascotColorId } from './MascotAvatar'

interface MascotEmptyHintCta {
  label: string
  /** Внутренняя навигация (next/link). */
  href?: string
  /** Либо обработчик (скролл к форме, фокус, открытие модалки). */
  onClick?: () => void
}

interface MascotEmptyHintProps {
  text: string
  title?: string
  cta?: MascotEmptyHintCta
  character?: MascotCharacterId
  color?: MascotColorId
  /** Поза аватара (по умолчанию 'question' — «подскажу»). */
  pose?: MascotState
  size?: number
  className?: string
}

const CTA_CLASS =
  'inline-flex items-center justify-center gap-1.5 mt-4 px-4 py-2.5 rounded-xl ' +
  'bg-primary/15 border border-primary/30 text-sm font-medium text-primary ' +
  'hover:bg-primary/25 transition-colors focus:outline-none focus:ring-2 focus:ring-primary/40'

export function MascotEmptyHint({
  text,
  title,
  cta,
  character = 'cat',
  color = 'ginger',
  pose = 'question',
  size = 76,
  className = '',
}: MascotEmptyHintProps) {
  return (
    <div
      className={`flex flex-col items-center rounded-2xl border border-white/[0.08] bg-white/[0.02] p-8 text-center ${className}`}
    >
      <MascotAvatar pose={pose} character={character} color={color} size={size} paused />
      {title && <p className="mt-2 font-semibold text-on-surface">{title}</p>}
      <p className="mt-1.5 max-w-md text-sm leading-relaxed text-on-surface-variant">{text}</p>
      {cta &&
        (cta.href ? (
          <Link href={cta.href} className={CTA_CLASS}>
            {cta.label}
          </Link>
        ) : (
          <button type="button" onClick={cta.onClick} className={CTA_CLASS}>
            {cta.label}
          </button>
        ))}
    </div>
  )
}
