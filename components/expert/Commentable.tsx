'use client'

// ─────────────────────────────────────────────────────────────────────────────
// Wraps any element and overlays a floating 💬 button in the top-right corner.
// Click → opens CommentSidePanel for this targetId.
//
// Must be used inside <ExpertCommentsProvider>.
// If not inside the provider, the wrapper renders children with no button.
// ─────────────────────────────────────────────────────────────────────────────

import { useState, type ReactNode } from 'react'
import { CommentSidePanel } from './CommentSidePanel'
import { useExpertCommentsMaybe } from './ExpertCommentsContext'

interface Props {
  /** Stable id from lib/comment-targets.ts (or any ≤200-char string). null = general feed */
  targetId: string | null
  /** Wrapped content */
  children: ReactNode
  /** Override visual placement of the button (default: top-right) */
  position?: 'top-right' | 'top-left' | 'bottom-right'
  /** If true, hides the button entirely (e.g. when rendering for non-experts) */
  disabled?: boolean
  /** Extra class on the outer wrapper */
  className?: string
}

const POSITION_CLASS: Record<NonNullable<Props['position']>, string> = {
  'top-right':    'top-2 right-2',
  'top-left':     'top-2 left-2',
  'bottom-right': 'bottom-2 right-2',
}

export function Commentable({
  targetId,
  children,
  position = 'top-right',
  disabled = false,
  className = '',
}: Props) {
  const ctx = useExpertCommentsMaybe()
  const [open, setOpen] = useState(false)

  // If no context (non-expert page) or explicitly disabled → render pass-through
  if (!ctx || disabled) {
    return <>{children}</>
  }

  const count = ctx.countFor(targetId)
  const hasComments = count > 0

  return (
    <>
      <div className={`relative group ${className}`}>
        {children}
        <button
          type="button"
          onClick={() => setOpen(true)}
          className={`absolute ${POSITION_CLASS[position]} z-10 inline-flex items-center gap-1 rounded-full border backdrop-blur-sm transition-all ${
            hasComments
              ? 'bg-primary/20 border-primary/40 text-primary hover:bg-primary/30 px-2 py-1'
              : 'bg-surface-container-high/80 border-white/[0.08] text-on-surface-variant hover:bg-primary/10 hover:text-primary hover:border-primary/30 opacity-0 group-hover:opacity-100 p-1.5'
          }`}
          aria-label={hasComments ? `${count} комментариев` : 'Добавить комментарий'}
          title={hasComments ? `${count} комм. — открыть` : 'Комментарий эксперта'}
        >
          <span className="material-symbols-outlined text-[14px]">
            {hasComments ? 'forum' : 'add_comment'}
          </span>
          {hasComments && <span className="text-[11px] font-mono font-semibold">{count}</span>}
        </button>
      </div>

      <CommentSidePanel open={open} onClose={() => setOpen(false)} targetId={targetId} />
    </>
  )
}
