'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  GROUP_ORDER,
  blockLabel,
  blockChipClass,
  formatCommentDate,
  getInitials,
  getAvatarGradient,
  type ExpertComment,
  type BlockKey,
} from '@/lib/expert-blocks'

interface AvatarProps {
  name: string | null
  avatarUrl: string | null
  seed: string | null
}

function AuthorAvatar({ name, avatarUrl, seed }: AvatarProps) {
  if (avatarUrl) {
    return (
      <img
        src={avatarUrl}
        alt={name ?? 'Эксперт'}
        className="w-9 h-9 rounded-xl border border-white/[0.08] object-cover flex-shrink-0"
      />
    )
  }
  const initials = getInitials(name)
  const gradient = getAvatarGradient(seed ?? name)
  return (
    <div
      className={`w-9 h-9 rounded-xl border border-white/[0.08] bg-gradient-to-br ${gradient} flex items-center justify-center text-xs font-bold text-on-surface flex-shrink-0`}
    >
      {initials}
    </div>
  )
}

function ReadOnlyCard({ comment }: { comment: ExpertComment }) {
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
    <article className="rounded-2xl bg-surface-container-low border border-white/[0.04] p-4">
      <div className="flex items-start gap-3">
        <AuthorAvatar
          name={comment.authorName}
          avatarUrl={comment.authorAvatarUrl}
          seed={comment.authorId}
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
            <span className="text-[10px] text-on-surface-variant/70 flex-shrink-0">
              {formatCommentDate(comment.createdAt)}
            </span>
          </div>
          <p className="mt-2 text-sm text-on-surface whitespace-pre-wrap break-words leading-relaxed">
            {comment.text}
          </p>
          {comment.updatedAt && comment.updatedAt !== comment.createdAt && (
            <p className="text-[10px] text-on-surface-variant/50 mt-1.5">
              отредактировано {formatCommentDate(comment.updatedAt)}
            </p>
          )}
        </div>
      </div>
    </article>
  )
}

interface GroupSectionProps {
  groupKey: BlockKey | null
  comments: ExpertComment[]
  defaultOpen: boolean
}

function GroupSection({ groupKey, comments, defaultOpen }: GroupSectionProps) {
  const [open, setOpen] = useState(defaultOpen)
  if (comments.length === 0) return null

  const label = blockLabel(groupKey)
  return (
    <div className="rounded-2xl bg-white/[0.02] border border-white/[0.04] overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-white/[0.02] transition-colors"
      >
        <div className="flex items-center gap-2">
          <span
            className={`text-[11px] font-medium px-2 py-0.5 rounded-full border ${blockChipClass(groupKey)}`}
          >
            {label}
          </span>
          <span className="text-sm font-semibold text-on-surface">
            Комментарии экспертов — {label}
          </span>
          <span className="text-[10px] font-mono text-on-surface-variant bg-white/[0.05] border border-white/[0.06] rounded-full px-2 py-0.5">
            {comments.length}
          </span>
        </div>
        <span
          className="material-symbols-outlined text-[18px] text-on-surface-variant transition-transform"
          style={{ transform: open ? 'rotate(180deg)' : undefined }}
        >
          expand_more
        </span>
      </button>

      {open && (
        <div className="px-4 pb-4 pt-0 space-y-3 border-t border-white/[0.04]">
          <div className="pt-3 space-y-3">
            {comments.map((c) => (
              <ReadOnlyCard key={c.id} comment={c} />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

export function ExpertCommentsSection() {
  const [comments, setComments] = useState<ExpertComment[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/expert/comments?clientId=self')
      if (!res.ok) throw new Error('Не удалось загрузить комментарии')
      const json = (await res.json()) as { data?: ExpertComment[] }
      setComments(json.data ?? [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Неизвестная ошибка')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const grouped = useMemo(() => {
    const map = new Map<BlockKey | 'general', ExpertComment[]>()
    for (const c of comments) {
      const key = (c.blockKey ?? 'general') as BlockKey | 'general'
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(c)
    }
    return map
  }, [comments])

  return (
    <section className="rounded-2xl bg-surface-container-low border border-white/[0.04] p-5 w-full">
      <header className="flex items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-2">
          <span className="material-symbols-outlined text-[22px] text-primary">
            chat
          </span>
          <h2 className="font-headline text-lg font-bold text-on-surface">
            Советы экспертов
          </h2>
          {!loading && !error && comments.length > 0 && (
            <span className="text-[10px] font-mono text-on-surface-variant bg-white/[0.05] border border-white/[0.06] rounded-full px-2 py-0.5">
              {comments.length}
            </span>
          )}
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="text-[11px] text-on-surface-variant hover:text-primary transition-colors flex items-center gap-1 disabled:opacity-50"
          aria-label="Обновить"
        >
          <span
            className={`material-symbols-outlined text-[14px] ${loading ? 'animate-spin' : ''}`}
          >
            refresh
          </span>
          Обновить
        </button>
      </header>

      {loading ? (
        <div className="py-10 flex items-center justify-center gap-2 text-on-surface-variant text-sm">
          <span className="material-symbols-outlined text-[18px] animate-spin">
            progress_activity
          </span>
          Загрузка...
        </div>
      ) : error ? (
        <div className="py-6 rounded-xl bg-error/5 border border-error/20 text-sm text-error text-center">
          {error}
        </div>
      ) : comments.length === 0 ? (
        <div className="rounded-2xl border border-white/[0.04] border-dashed py-10 text-center text-sm text-on-surface-variant">
          Пока нет комментариев. Эксперты скоро поделятся рекомендациями.
        </div>
      ) : (
        <div className="space-y-3">
          {GROUP_ORDER.map((key) => {
            const mapKey = (key ?? 'general') as BlockKey | 'general'
            const list = grouped.get(mapKey) ?? []
            if (list.length === 0) return null
            return (
              <GroupSection
                key={mapKey}
                groupKey={key}
                comments={list}
                defaultOpen={key === null || list.length > 0}
              />
            )
          })}
        </div>
      )}
    </section>
  )
}
