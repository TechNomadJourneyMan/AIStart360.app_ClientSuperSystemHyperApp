'use client'

/**
 * components/assistant/HelpButton.tsx
 *
 * The "?" help affordance. Drop it anywhere — page headers, section titles, next
 * to a confusing control — and it opens the global Smart Assistant panel (via the
 * AssistantProvider context). Pass `topic` to give the assistant a contextual
 * label for the section the user asked about.
 *
 * Two visual variants:
 *   • variant="icon"  (default) — a round "?" icon button for tight spots.
 *   • variant="chip"            — an icon + short label ("Помощь") for headers.
 *
 * The button is intentionally always visible so users notice it and can ask when
 * they are unsure. Copy follows the portal locale (cookie → default Russian).
 */

import { useEffect, useState } from 'react'
import { useAssistant } from './AssistantProvider'
import { getClientLocale, type Locale } from '@/lib/i18n/locale'

const T: Record<Locale, { help: string; ask: (topic?: string) => string }> = {
  ru: {
    help: 'Помощь',
    ask: (topic) =>
      topic
        ? `Не знаете, что здесь делать? Спросите ассистента про «${topic}»`
        : 'Не знаете, что делать? Спросите ассистента',
  },
  en: {
    help: 'Help',
    ask: (topic) =>
      topic
        ? `Not sure what to do here? Ask the assistant about “${topic}”`
        : 'Not sure what to do? Ask the assistant',
  },
}

interface HelpButtonProps {
  /** Contextual section label passed to the assistant (e.g. "Анализ рынка"). */
  topic?: string
  /** Visual style. */
  variant?: 'icon' | 'chip'
  /** Size of the icon variant. */
  size?: 'sm' | 'md'
  className?: string
}

export function HelpButton({
  topic,
  variant = 'icon',
  size = 'md',
  className = '',
}: HelpButtonProps) {
  const { openAssistant } = useAssistant()
  const [locale, setLocale] = useState<Locale>('ru')
  const t = T[locale]

  useEffect(() => {
    setLocale(getClientLocale())
  }, [])

  const tooltip = t.ask(topic)

  if (variant === 'chip') {
    return (
      <button
        type="button"
        onClick={() => openAssistant({ topic })}
        title={tooltip}
        aria-label={tooltip}
        className={`inline-flex items-center gap-1.5 rounded-lg border border-primary/25 bg-primary/[0.06] px-2.5 py-2 min-h-[36px] text-xs font-semibold text-primary hover:bg-primary/[0.12] hover:border-primary/40 transition-colors ${className}`}
      >
        <span className="material-symbols-outlined text-base">help</span>
        <span className="hidden md:inline">{t.help}</span>
      </button>
    )
  }

  const dim = size === 'sm' ? 'w-6 h-6 text-[13px]' : 'w-8 h-8 text-base'
  return (
    <button
      type="button"
      onClick={() => openAssistant({ topic })}
      title={tooltip}
      aria-label={tooltip}
      className={`inline-flex items-center justify-center rounded-full border border-primary/30 bg-primary/[0.06] text-primary hover:bg-primary/[0.14] hover:border-primary/50 transition-colors ${dim} ${className}`}
    >
      <span className="material-symbols-outlined" style={{ fontSize: size === 'sm' ? 15 : 18 }}>
        help
      </span>
    </button>
  )
}

export default HelpButton
