'use client'

// ─────────────────────────────────────────────────────────────────────────────
// Right-sliding drawer showing all comments for a single target id
// + an inline composer. Used by <Commentable>.
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useState } from 'react'
import { useAuthStore } from '@/stores/auth.store'
import {
  formatCommentDate,
  getInitials,
  getAvatarGradient,
  type ExpertComment,
} from '@/lib/expert-blocks'
import { getTarget, targetLabel, GROUP_CHIP, GROUP_LABEL } from '@/lib/comment-targets'
import { useExpertComments } from './ExpertCommentsContext'

interface Props {
  open: boolean
  onClose: () => void
  /** null → general feed */
  targetId: string | null
}

export function CommentSidePanel({ open, onClose, targetId }: Props) {
  const { user } = useAuthStore()
  const { listFor, create, update, remove } = useExpertComments()
  const [draft, setDraft] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Reset draft when switching target
  useEffect(() => {
    setDraft('')
    setError(null)
  }, [targetId])

  // Close on ESC
  useEffect(() => {
    if (!open) return
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [open, onClose])

  const target = targetId ? getTarget(targetId) : null
  const headerLabel = targetId ? targetLabel(targetId) : 'Общий комментарий'
  const groupKey = target?.group ?? 'general'
  const comments = listFor(targetId)

  const handleSubmit = async () => {
    const trimmed = draft.trim()
    if (!trimmed) return
    setSubmitting(true)
    setError(null)
    try {
      const created = await create({ targetId, text: trimmed })
      if (created) {
        setDraft('')
      } else {
        setError('Не удалось отправить. Попробуйте снова.')
      }
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <>
      {/* Backdrop */}
      <div
        className={`fixed inset-0 z-40 bg-black/40 backdrop-blur-sm transition-opacity ${
          open ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
        onClick={onClose}
      />

      {/* Drawer */}
      <aside
        className={`fixed right-0 top-0 bottom-0 z-50 w-full max-w-md bg-surface-container-low border-l border-white/[0.06] shadow-2xl flex flex-col transition-transform duration-200 ${
          open ? 'translate-x-0' : 'translate-x-full'
        }`}
        role="dialog"
        aria-label={`Комментарии: ${headerLabel}`}
      >
        {/* Header */}
        <header className="flex items-start justify-between gap-3 p-5 border-b border-white/[0.06]">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-1">
              <span className={`text-[10px] font-mono uppercase tracking-widest px-2 py-0.5 rounded-full border ${GROUP_CHIP[groupKey]}`}>
                {GROUP_LABEL[groupKey]}
              </span>
              <span className="text-[10px] text-on-surface-variant/70">{comments.length} комм.</span>
            </div>
            <h2 className="font-headline text-lg font-bold text-on-surface leading-tight truncate">
              {headerLabel}
            </h2>
            {target?.section && (
              <p className="text-[11px] text-on-surface-variant mt-0.5 truncate">{target.section}</p>
            )}
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-white/[0.05] text-on-surface-variant hover:text-on-surface transition-colors flex-shrink-0"
            aria-label="Закрыть"
          >
            <span className="material-symbols-outlined text-xl">close</span>
          </button>
        </header>

        {/* Comment list */}
        <div className="flex-1 overflow-y-auto p-5 space-y-3">
          {comments.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <span className="material-symbols-outlined text-4xl text-on-surface-variant/40 mb-2">
                forum
              </span>
              <p className="text-sm text-on-surface-variant">
                Нет комментариев к этому пункту
              </p>
              <p className="text-xs text-on-surface-variant/60 mt-1">
                Оставьте первый совет ниже
              </p>
            </div>
          ) : (
            comments.map((c) => (
              <CommentCard
                key={c.id}
                comment={c}
                isOwn={user?.id === c.authorId}
                onUpdate={(id, text) => update(id, text)}
                onDelete={async (id) => {
                  if (window.confirm('Удалить комментарий?')) await remove(id)
                }}
              />
            ))
          )}
        </div>

        {/* Composer */}
        <footer className="border-t border-white/[0.06] p-4 space-y-2">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            disabled={submitting}
            placeholder={`Комментарий к «${headerLabel}»…`}
            rows={3}
            maxLength={5000}
            className="w-full rounded-xl bg-surface-container border border-white/[0.08] text-sm text-on-surface px-3 py-2 focus:outline-none focus:border-primary/40 resize-none"
          />
          {error && <p className="text-xs text-error">{error}</p>}
          <div className="flex items-center justify-between">
            <p className="text-[10px] text-on-surface-variant/60 font-mono">
              {draft.length}/5000
            </p>
            <button
              onClick={handleSubmit}
              disabled={submitting || !draft.trim()}
              className="inline-flex items-center gap-1.5 rounded-lg bg-primary text-on-primary text-sm font-medium px-4 py-2 hover:bg-primary/90 transition-all disabled:opacity-50"
            >
              <span className="material-symbols-outlined text-base">
                {submitting ? 'progress_activity' : 'send'}
              </span>
              Отправить
            </button>
          </div>
        </footer>
      </aside>
    </>
  )
}

// ── Card ─────────────────────────────────────────────────────────────────────

interface CardProps {
  comment: ExpertComment
  isOwn: boolean
  onUpdate: (id: string, text: string) => Promise<unknown>
  onDelete: (id: string) => Promise<void> | void
}

function CommentCard({ comment, isOwn, onUpdate, onDelete }: CardProps) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(comment.text)
  const [saving, setSaving] = useState(false)

  const save = async () => {
    const trimmed = draft.trim()
    if (!trimmed) return
    setSaving(true)
    try {
      await onUpdate(comment.id, trimmed)
      setEditing(false)
    } finally {
      setSaving(false)
    }
  }

  const roleLabel =
    comment.authorTitle ??
    (comment.authorRole === 'expert'
      ? 'Эксперт'
      : comment.authorRole === 'admin'
      ? 'Администратор'
      : comment.authorRole === 'super_admin'
      ? 'Супер-админ'
      : null)

  return (
    <article className="rounded-xl bg-surface-container border border-white/[0.04] p-3">
      <div className="flex items-start gap-3">
        {comment.authorAvatarUrl ? (
          <img
            src={comment.authorAvatarUrl}
            alt={comment.authorName ?? ''}
            className="w-8 h-8 rounded-lg border border-white/[0.08] object-cover flex-shrink-0"
          />
        ) : (
          <div
            className={`w-8 h-8 rounded-lg border border-white/[0.08] bg-gradient-to-br ${getAvatarGradient(
              comment.authorId,
            )} flex items-center justify-center text-[10px] font-bold text-on-surface flex-shrink-0`}
          >
            {getInitials(comment.authorName)}
          </div>
        )}

        <div className="flex-1 min-w-0">
          <div className="flex items-baseline justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-1.5 min-w-0">
              <span className="text-sm font-medium text-on-surface truncate">
                {comment.authorName ?? 'Эксперт'}
              </span>
              {roleLabel && (
                <span className="text-[9px] font-medium px-1.5 py-0.5 rounded bg-primary/10 text-primary border border-primary/20 flex-shrink-0">
                  {roleLabel}
                </span>
              )}
            </div>
            <span className="text-[10px] text-on-surface-variant/70 flex-shrink-0">
              {formatCommentDate(comment.createdAt)}
            </span>
          </div>

          {editing ? (
            <div className="mt-2 space-y-2">
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                disabled={saving}
                rows={3}
                maxLength={5000}
                className="w-full rounded-lg bg-surface-container-low border border-white/[0.08] text-sm text-on-surface px-2.5 py-1.5 focus:outline-none focus:border-primary/40 resize-none"
              />
              <div className="flex gap-2">
                <button
                  onClick={save}
                  disabled={saving}
                  className="rounded-md bg-primary/15 border border-primary/30 text-primary text-xs px-2.5 py-1 hover:bg-primary/25 disabled:opacity-50"
                >
                  Сохранить
                </button>
                <button
                  onClick={() => {
                    setDraft(comment.text)
                    setEditing(false)
                  }}
                  disabled={saving}
                  className="rounded-md bg-white/[0.04] text-on-surface-variant text-xs px-2.5 py-1 hover:bg-white/[0.08]"
                >
                  Отмена
                </button>
              </div>
            </div>
          ) : (
            <p className="mt-1.5 text-sm text-on-surface whitespace-pre-wrap break-words leading-relaxed">
              {comment.text}
            </p>
          )}

          {isOwn && !editing && (
            <div className="mt-1.5 flex items-center gap-0.5">
              <button
                onClick={() => setEditing(true)}
                className="p-0.5 rounded hover:bg-white/[0.05] text-on-surface-variant/70 hover:text-primary"
                aria-label="Редактировать"
              >
                <span className="material-symbols-outlined text-[13px]">edit</span>
              </button>
              <button
                onClick={() => onDelete(comment.id)}
                className="p-0.5 rounded hover:bg-error/10 text-on-surface-variant/70 hover:text-error"
                aria-label="Удалить"
              >
                <span className="material-symbols-outlined text-[13px]">delete</span>
              </button>
            </div>
          )}
        </div>
      </div>
    </article>
  )
}
