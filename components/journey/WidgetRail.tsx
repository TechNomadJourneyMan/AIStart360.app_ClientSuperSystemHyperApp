'use client'

// Right rail. AI spawns widgets here as it learns things. Expanded ones
// stack vertically. Collapsed ones sit as chips at the top so they don't
// take space but stay one click away.

import { AnimatePresence, motion } from 'framer-motion'
import type { Widget } from '@/lib/journey/state'
import { WidgetRenderer } from './widgets/WidgetRenderer'

interface Props {
  widgets: Widget[]
  onToggle: (id: string) => void
  onDismiss: (id: string) => void
  /** Question-option clicks etc. flow back to the chat as a user message */
  onAnswer?: (text: string) => void
}

export function WidgetRail({ widgets, onToggle, onDismiss, onAnswer }: Props) {
  const expanded  = widgets.filter((w) => !w.collapsed).sort((a, b) => b.priority - a.priority)
  const collapsed = widgets.filter((w) =>  w.collapsed).sort((a, b) => b.priority - a.priority)

  return (
    <aside className="flex flex-col rounded-2xl bg-surface-container-low/40 border border-white/[0.05] overflow-hidden min-h-0">

      {/* Header */}
      <div className="px-4 py-3 border-b border-white/[0.04] flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="material-symbols-outlined text-primary text-base">auto_awesome</span>
          <p className="text-xs font-semibold uppercase tracking-wider text-on-surface-variant">
            AI подсказки
          </p>
        </div>
        <span className="text-[10px] font-mono text-on-surface-variant/60">
          {expanded.length} активных
        </span>
      </div>

      {/* Collapsed chips */}
      {collapsed.length > 0 && (
        <div className="px-4 py-2.5 border-b border-white/[0.04] flex flex-wrap gap-1.5 bg-surface-container-lowest/40">
          <AnimatePresence>
            {collapsed.map((w) => (
              <motion.button
                key={w.id}
                layout
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9 }}
                onClick={() => onToggle(w.id)}
                className="inline-flex items-center gap-1.5 text-[10px] px-2 py-1 rounded-md bg-surface-container border border-white/[0.06] text-on-surface-variant hover:text-primary hover:border-primary/30 transition-colors"
              >
                <span className="material-symbols-outlined text-xs">{iconFor(w.kind)}</span>
                <span className="truncate max-w-[140px]">{w.title}</span>
              </motion.button>
            ))}
          </AnimatePresence>
        </div>
      )}

      {/* Expanded stack */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        <AnimatePresence initial={false}>
          {expanded.map((w) => (
            <motion.div
              key={w.id}
              layout
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, height: 0, marginBottom: 0 }}
              transition={{ duration: 0.2 }}
            >
              <WidgetCard w={w} onToggle={onToggle} onDismiss={onDismiss} onAnswer={onAnswer} />
            </motion.div>
          ))}
        </AnimatePresence>

        {expanded.length === 0 && collapsed.length === 0 && (
          <div className="h-full flex flex-col items-center justify-center text-center text-on-surface-variant/50 py-16">
            <span className="material-symbols-outlined text-4xl mb-3">bubble_chart</span>
            <p className="text-xs">Виджеты появятся здесь<br />по ходу разговора</p>
          </div>
        )}
      </div>
    </aside>
  )
}

function WidgetCard({
  w,
  onToggle,
  onDismiss,
  onAnswer,
}: {
  w: Widget
  onToggle: (id: string) => void
  onDismiss: (id: string) => void
  onAnswer?: (text: string) => void
}) {
  return (
    <div className="bg-surface-container border border-white/[0.06] rounded-xl overflow-hidden">
      <div className="flex items-center justify-between px-3.5 py-2.5 border-b border-white/[0.04]">
        <div className="flex items-center gap-2 min-w-0">
          <span className="material-symbols-outlined text-primary text-sm">{iconFor(w.kind)}</span>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-on-surface truncate">
            {w.title}
          </p>
        </div>
        <div className="flex items-center gap-0.5 flex-shrink-0">
          <button
            onClick={() => onToggle(w.id)}
            className="p-1 rounded text-on-surface-variant/60 hover:text-on-surface hover:bg-white/[0.04]"
            title="Свернуть"
          >
            <span className="material-symbols-outlined text-sm">minimize</span>
          </button>
          <button
            onClick={() => onDismiss(w.id)}
            className="p-1 rounded text-on-surface-variant/60 hover:text-error hover:bg-white/[0.04]"
            title="Убрать"
          >
            <span className="material-symbols-outlined text-sm">close</span>
          </button>
        </div>
      </div>
      <div className="p-3.5">
        <WidgetRenderer w={w} onAnswer={onAnswer} />
      </div>
    </div>
  )
}

function iconFor(kind: Widget['kind']): string {
  switch (kind) {
    case 'question':        return 'help'
    case 'upload_prompt':   return 'upload_file'
    case 'insight_card':    return 'lightbulb'
    case 'crm_check':       return 'contacts'
    case 'stack_audit':     return 'construction'
    case 'video_rec':       return 'play_circle'
    case 'news_digest':     return 'newspaper'
    case 'reminders_rail':  return 'checklist'
    case 'metric_peek':     return 'monitoring'
    case 'benchmark_strip': return 'align_horizontal_center'
    case 'risk_alert':      return 'warning'
    case 'quick_win':       return 'bolt'
    case 'custom_module':   return 'widgets'
    default:                return 'circle'
  }
}
