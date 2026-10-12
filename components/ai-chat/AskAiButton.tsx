'use client'

import { openAiChat, type OpenChatDetail } from './open'

/** «Спросить AI» — opens the unified chat for this screen. */
export function AskAiButton({ surface, label = 'Спросить AI', className }: { surface: NonNullable<OpenChatDetail['surface']>; label?: string; className?: string }) {
  return (
    <button
      type="button"
      onClick={() => openAiChat({ surface })}
      className={className ?? 'inline-flex items-center gap-1.5 rounded-xl border border-primary/30 px-3 py-2 text-xs font-medium text-primary hover:bg-primary/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40'}
    >
      <span className="material-symbols-outlined text-[16px]" aria-hidden="true">auto_awesome</span>
      {label}
    </button>
  )
}
