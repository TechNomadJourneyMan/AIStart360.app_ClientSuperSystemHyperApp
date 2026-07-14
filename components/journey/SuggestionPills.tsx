'use client'

import { motion, useReducedMotion } from 'framer-motion'
import { Check, EyeOff, ThumbsDown } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { JourneySuggestionView } from './model'

interface SuggestionPillsProps {
  suggestions: JourneySuggestionView[]
  onAccept: (suggestion: JourneySuggestionView) => void
  onReject: (id: string) => void
  onHide: (id: string) => void
  className?: string
}

export function SuggestionPills({
  suggestions,
  onAccept,
  onReject,
  onHide,
  className,
}: SuggestionPillsProps) {
  const reduceMotion = useReducedMotion()
  const active = suggestions.filter((suggestion) => suggestion.status === 'active').slice(0, 3)
  if (!active.length) return null

  return (
    <div className={cn('flex max-w-sm flex-wrap gap-2', className)} aria-label="Контекстные подсказки AI">
      {active.map((suggestion, index) => (
        <motion.div
          key={suggestion.id}
          initial={reduceMotion ? false : { opacity: 0, y: 5 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: reduceMotion ? 0 : 0.16, delay: reduceMotion ? 0 : index * 0.03, ease: 'easeOut' }}
          className="flex items-center rounded-full border border-white/10 bg-surface-container-lowest shadow-card"
        >
          <button
            type="button"
            aria-label={`Принять подсказку: ${suggestion.label}`}
            onClick={() => onAccept(suggestion)}
            className="flex min-h-9 items-center gap-1.5 rounded-l-full py-1.5 pl-3 pr-2 text-xs text-on-surface hover:text-primary"
          >
            <Check className="size-3.5 text-primary" aria-hidden />
            <span className="max-w-44 truncate">{suggestion.label}</span>
          </button>
          <button
            type="button"
            aria-label={`Отклонить подсказку: ${suggestion.label}`}
            title="Не подходит"
            onClick={() => onReject(suggestion.id)}
            className="flex size-9 items-center justify-center text-on-surface-variant hover:bg-white/5 hover:text-on-surface"
          >
            <ThumbsDown className="size-3.5" aria-hidden />
          </button>
          <button
            type="button"
            aria-label={`Скрыть подсказку: ${suggestion.label}`}
            title="Скрыть"
            onClick={() => onHide(suggestion.id)}
            className="mr-0.5 flex size-9 items-center justify-center rounded-r-full text-on-surface-variant hover:bg-white/5 hover:text-on-surface"
          >
            <EyeOff className="size-3.5" aria-hidden />
          </button>
        </motion.div>
      ))}
    </div>
  )
}
