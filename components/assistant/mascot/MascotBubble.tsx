'use client'

/**
 * components/assistant/mascot/MascotBubble.tsx — the comic speech bubble.
 *
 * Renders the active scripted hint next to the mascot (ТЗ §4.4/§5/§6): short
 * text, up to two action buttons, a «×» close and — for mutable hint types —
 * a «Не показывать такие советы» opt-out. Screen-reader friendly via
 * role="status" + aria-live="polite"; never steals focus.
 */

import { motion } from 'framer-motion'
import type { HintAction, ResolvedHint } from '@/lib/assistant/mascot/hints'

interface MascotBubbleProps {
  hint: ResolvedHint
  compact?: boolean
  onAction: (action: HintAction) => void
  onClose: () => void
  onMuteType: () => void
}

export function MascotBubble({ hint, compact = false, onAction, onClose, onMuteType }: MascotBubbleProps) {
  return (
    <motion.div
      role="status"
      aria-live="polite"
      initial={{ opacity: 0, scale: 0.92, y: 6 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95, y: 4 }}
      transition={{ duration: 0.18, ease: 'easeOut' }}
      className={`relative rounded-2xl border border-white/[0.1] bg-[#12151c]/95 backdrop-blur-sm shadow-xl shadow-black/40 p-3.5 ${
        compact ? 'max-w-[calc(100vw-96px)]' : 'max-w-[320px]'
      }`}
    >
      {/* Comic tail pointing to the cat (bottom-right). */}
      <div
        aria-hidden
        className="absolute -bottom-[7px] right-7 w-3.5 h-3.5 rotate-45 bg-[#12151c]/95 border-b border-r border-white/[0.1]"
      />

      <button
        onClick={onClose}
        aria-label="Закрыть подсказку"
        className="absolute top-1.5 right-1.5 w-6 h-6 rounded-lg flex items-center justify-center text-on-surface-variant hover:text-on-surface hover:bg-white/[0.06] transition-all"
      >
        <span className="material-symbols-outlined text-sm">close</span>
      </button>

      <p className={`pr-6 text-on-surface leading-snug ${compact ? 'text-xs' : 'text-[13px]'}`}>
        {hint.text}
      </p>

      {hint.actions.length > 0 && (
        <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
          {hint.actions.map((a) => (
            <button
              key={a.label}
              onClick={() => onAction(a)}
              className={
                a.kind === 'later'
                  ? 'px-3 py-1.5 rounded-lg text-xs text-on-surface-variant hover:text-on-surface hover:bg-white/[0.05] transition-all'
                  : 'px-3 py-1.5 rounded-lg bg-primary text-[#003824] font-semibold text-xs hover:bg-primary/90 transition-colors focus:outline-none focus:ring-2 focus:ring-primary/40'
              }
            >
              {a.label}
            </button>
          ))}
        </div>
      )}

      {hint.mutable && (
        <button
          onClick={onMuteType}
          className="mt-2 text-[10px] text-on-surface-variant/70 hover:text-on-surface-variant underline underline-offset-2 transition-colors"
        >
          Не показывать такие советы
        </button>
      )}
    </motion.div>
  )
}
