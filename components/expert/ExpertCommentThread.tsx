'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuthStore } from '@/stores/auth.store'
import {
  BLOCK_ORDER,
  BLOCK_LABELS,
  blockLabel,
  blockChipClass,
  formatCommentDate,
  getInitials,
  getAvatarGradient,
  type BlockKey,
  type ExpertComment,
} from '@/lib/expert-blocks'
import { CommentComposer } from './CommentComposer'

interface Props {
  clientId: string
}

type FilterKey = 'all' | 'general' | BlockKey

const FILTERS: Array<{ key: FilterKey; label: string }> = [
  { key: 'all', label: 'Все' },
  { key: 'general', label: 'Общее' },
  ...BLOCK_ORDER.map((k) => ({ key: k, label: BLOCK_LABELS[k] })),
]

interface AuthorChipProps {
  name: string | null
  title: string | null
  role: string | null
  avatarUrl: string | null
  userId: string | null
}

function AuthorAvatar({ name, avatarUrl, userId }: Pick<AuthorChipProps, 'name' | 'avatarUrl' | 'userId'>) {
  if (avatarUrl) {
    return (
      <img
        src={avatarUrl}
        alt={name ?? 'Автор'}
        className="w-9 h-9 rounded-xl border border-white/[0.08] object-cover flex-shrink-0"
      />
    )
  }
  const initials = getInitials(name)
  const gradient = getAvatarGradient(userId ?? name)
  return (
    <div
      className={`w-9 h-9 rounded-xl border border-white/[0.08] bg-gradient-to-br ${gradient} flex items-center justify-center text-xs font-bold text-on-surface flex-shrink-0`}
    >
      {initials}
    </div>
  )
}

interface CommentCardProps {
  comment: ExpertComment
  isOwn: boolean
  onDelete: (id: string) => void
  onUpdate: (id: string, newText: string) => Promise<void>
}

function CommentCard({ comment, isOwn, onDelete, onUpdate }: CommentCardProps) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(comment.text)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const roleLabel =
    comment.authorTitle ??
    (comment.authorRole === 'expert'
      ? 'Эксперт'
      : comment.authorRole === 'admin'
      ? 'Администратор'
      : comment.authorRole === 'super_admin'
      ? 'Супер-админ'
      : null)

  const save = async () => {
    const trimmed = draft.trim()
    if (!trimmed) {
      setError('Комментарий не может быть пустым')
      return
    }
    setSaving(true)
    setError(null)
    try {
      await onUpdate(comment.id, trimmed)
      setEditing(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось сохранить')
    } finally {
      setSaving(false)
    }
  }

  const cancel = () => {
    setDraft(comment.text)
    setError(null)
    setEditing(false)
  }

  return (
    <article className="rounded-2xl bg-surface-container-low border border-white/[0.04] p-4">
      <div className="flex items-start gap-3">
        <AuthorAvatar
          name={comment.authorName}
          avatarUrl={comment.authorAvatarUrl}
          userId={comment.authorId}
        />

        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-2 flex-wrap min-w-0">
              <span className="text-sm font-semibold text-on-surface truncate">
                {comment.authorName ?? 'Эксперт'}
              </span>
              {roleLabel && (
                <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20">
                  {roleLabel}
                </span>
              )}
              <span
                className={`text-[10px] font-medium px-2 py-0.5 rounded-full border ${blockChipClass(comment.blockKey)}`}
              >
                {blockLabel(comment.blockKey)}
              </span>
            </div>

            <div className="flex items-center gap-1 flex-shrink-0">
              <span className="text-[10px] text-on-surface-variant/70">
                {formatCommentDate(comment.createdAt)}
              </span>
              {isOwn && !editing && (
                <div className="flex items-center ml-1">
                  <button
                    onClick={() => setEditing(true)}
                    className="p-1 rounded hover:bg-white/[0.05] text-on-surface-variant hover:text-primary transition-colors"
                    aria-label="Редактировать"
                  >
                    <span className="material-symbols-outlined text-[14px]">edit</span>
                  </button>
                  <button
                    onClick={() => onDelete(comment.id)}
                    className="p-1 rounded hover:bg-error/10 text-on-surface-variant hover:text-error transition-colors"
                    aria-label="Удалить"
                  >
                    <span className="material-symbols-outlined text-[14px]">delete</span>
                  </button>
                </div>
              )}
            </div>
          </div>

          {editing ? (
            <div className="mt-2 space-y-2">
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                disabled={saving}
                rows={3}
                maxLength={5000}
                className="w-full rounded-xl bg-surface-container border border-white/[0.08] text-sm text-on-surface px-3 py-2 focus:outline-none focus:border-primary/40 transition-all resize-none"
              />
              {error && (
                <p className="text-xs text-error">{error}</p>
              )}
              <div className="flex items-center gap-2">
                <button
                  onClick={save}
                  disabled={saving}
                  className="inline-flex items-center gap-1 rounded-lg bg-primary/15 border border-primary/30 text-primary text-xs px-3 py-1.5 hover:bg-primary/25 transition-all disabled:opacity-50"
                >
                  <span className="material-symbols-outlined text-[13px]">
                    {saving ? 'progress_activity' : 'check'}
                  </span>
                  Сохранить
                </button>
                <button
                  onClick={cancel}
                  disabled={saving}
                  className="inline-flex items-center gap-1 rounded-lg bg-white/[0.04] border border-white/[0.06] text-on-surface-variant text-xs px-3 py-1.5 hover:bg-white/[0.08] transition-all"
                >
                  Отмена
                </button>
              </div>
            </div>
          ) : (
            <p className="mt-2 text-sm text-on-surface whitespace-pre-wrap break-words leading-relaxed">
              {comment.text}
            </p>
          )}

          {!editing && comment.updatedAt && comment.updatedAt !== comment.createdAt && (
            <p className="text-[10px] text-on-surface-variant/50 mt-1.5">
              отредактировано {formatCommentDate(comment.updatedAt)}
            </p>
          )}
        </div>
      </div>
    </article>
  )
}

export function ExpertCommentThread({ clientId }: Props) {
  const { user } = useAuthStore()
  const [comments, setComments] = useState<ExpertComment[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<FilterKey>('all')

  const fetchComments = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/expert/comments?clientId=${encodeURIComponent(clientId)}`)
      if (!res.ok) throw new Error('Не удалось загрузить комментарии')
      const json = (await res.json()) as { data?: ExpertComment[] }
      setComments(json.data ?? [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Неизвестная ошибка')
    } finally {
      setLoading(false)
    }
  }, [clientId])

  useEffect(() => {
    fetchComments()
  }, [fetchComments])

  const handleUpdate = useCallback(async (id: string, newText: string) => {
    const res = await fetch(`/api/expert/comments/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: newText }),
    })
    if (!res.ok) {
      const json = (await res.json().catch(() => ({}))) as { error?: string }
      throw new Error(json.error ?? 'Не удалось обновить комментарий')
    }
    const json = (await res.json()) as { data: ExpertComment }
    setComments((prev) => prev.map((c) => (c.id === id ? json.data : c)))
  }, [])

  const handleDelete = useCallback(async (id: string) => {
    if (!window.confirm('Удалить комментарий? Действие нельзя отменить.')) return
    try {
      const res = await fetch(`/api/expert/comments/${id}`, { method: 'DELETE' })
      if (!res.ok) {
        const json = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(json.error ?? 'Не удалось удалить комментарий')
      }
      setComments((prev) => prev.filter((c) => c.id !== id))
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Неизвестная ошибка')
    }
  }, [])

  const filtered = useMemo(() => {
    if (filter === 'all') return comments
    if (filter === 'general') return comments.filter((c) => !c.blockKey)
    return comments.filter((c) => c.blockKey === filter)
  }, [comments, filter])

  return (
    <section className="space-y-4">
      <CommentComposer clientId={clientId} onPosted={fetchComments} />

      <div className="flex flex-wrap items-center gap-1.5">
        {FILTERS.map((f) => {
          const active = filter === f.key
          const count =
            f.key === 'all'
              ? comments.length
              : f.key === 'general'
              ? comments.filter((c) => !c.blockKey).length
              : comments.filter((c) => c.blockKey === f.key).length
          return (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium border transition-all ${
                active
                  ? 'bg-primary/15 text-primary border-primary/30'
                  : 'bg-white/[0.03] text-on-surface-variant border-white/[0.06] hover:text-on-surface hover:bg-white/[0.06]'
              }`}
            >
              {f.label}
              <span
                className={`text-[10px] px-1.5 rounded-full ${
                  active ? 'bg-primary/20 text-primary' : 'bg-white/[0.06] text-on-surface-variant/70'
                }`}
              >
                {count}
              </span>
            </button>
          )
        })}
      </div>

      {loading ? (
        <div className="rounded-2xl bg-surface-container-low border border-white/[0.04] py-10 flex items-center justify-center gap-2 text-on-surface-variant text-sm">
          <span className="material-symbols-outlined text-[18px] animate-spin">progress_activity</span>
          Загрузка комментариев...
        </div>
      ) : error ? (
        <div className="rounded-2xl bg-error/5 border border-error/20 p-4 text-sm text-error">
          {error}
          <button
            onClick={fetchComments}
            className="block mt-2 text-xs text-primary hover:underline"
          >
            Попробовать снова
          </button>
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-2xl bg-surface-container-low border border-white/[0.04] border-dashed py-10 text-center text-sm text-on-surface-variant">
          {comments.length === 0
            ? 'Комментариев пока нет — оставьте первый совет.'
            : 'В этом разделе пока нет комментариев.'}
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((c) => (
            <CommentCard
              key={c.id}
              comment={c}
              isOwn={!!user && user.id === c.authorId}
              onUpdate={handleUpdate}
              onDelete={handleDelete}
            />
          ))}
        </div>
      )}
    </section>
  )
}
