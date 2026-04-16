'use client'

// Client-facing read-only view of all expert comments left on their account.
// Groups by TargetGroup (Общее / Точка А / Дэшборд / GRI / Pulse / ...),
// then by target within each group, so clients see every advisory item an
// expert flagged — across all 4 commentable tabs.

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  formatCommentDate,
  getInitials,
  getAvatarGradient,
  type ExpertComment,
} from '@/lib/expert-blocks'
import {
  groupOf,
  targetLabel,
  GROUP_LABEL,
  GROUP_CHIP,
  GROUP_ICON,
  GROUP_ORDER,
  type TargetGroup,
} from '@/lib/comment-targets'

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

/** Group → Target → [Comments] */
type GroupedMap = Map<TargetGroup, Map<string, ExpertComment[]>>

function groupComments(comments: ExpertComment[]): GroupedMap {
  const out: GroupedMap = new Map()
  for (const c of comments) {
    const g = groupOf(c.blockKey)
    if (!out.has(g)) out.set(g, new Map())
    const targetMap = out.get(g)!
    // Use 'general' as the key when blockKey is null
    const targetKey = c.blockKey ?? '__general__'
    if (!targetMap.has(targetKey)) targetMap.set(targetKey, [])
    targetMap.get(targetKey)!.push(c)
  }
  return out
}

function GroupSection({
  group,
  targets,
  defaultOpen,
}: {
  group: TargetGroup
  targets: Map<string, ExpertComment[]>
  defaultOpen: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
  const totalCount = Array.from(targets.values()).reduce((sum, arr) => sum + arr.length, 0)
  if (totalCount === 0) return null

  return (
    <div className="rounded-2xl bg-white/[0.02] border border-white/[0.04] overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-white/[0.02] transition-colors"
      >
        <div className="flex items-center gap-2 min-w-0">
          <span className="material-symbols-outlined text-base text-primary/70 flex-shrink-0">
            {GROUP_ICON[group]}
          </span>
          <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full border flex-shrink-0 ${GROUP_CHIP[group]}`}>
            {GROUP_LABEL[group]}
          </span>
          <span className="text-sm font-semibold text-on-surface truncate">
            Советы экспертов — {GROUP_LABEL[group]}
          </span>
          <span className="text-[10px] font-mono text-on-surface-variant bg-white/[0.05] border border-white/[0.06] rounded-full px-2 py-0.5 flex-shrink-0">
            {totalCount}
          </span>
        </div>
        <span
          className="material-symbols-outlined text-[18px] text-on-surface-variant transition-transform flex-shrink-0"
          style={{ transform: open ? 'rotate(180deg)' : undefined }}
        >
          expand_more
        </span>
      </button>

      {open && (
        <div className="px-4 pb-4 pt-0 border-t border-white/[0.04] space-y-3">
          {Array.from(targets.entries()).map(([targetKey, list]) => {
            const isGeneral = targetKey === '__general__'
            const label = isGeneral ? 'Общее' : targetLabel(targetKey)
            return (
              <div key={targetKey} className="pt-3">
                {!isGeneral && (
                  <div className="mb-2 flex items-center gap-1.5">
                    <span className="material-symbols-outlined text-sm text-on-surface-variant/70">
                      arrow_right
                    </span>
                    <span className="text-xs font-medium text-on-surface-variant">{label}</span>
                    <span className="text-[10px] font-mono text-on-surface-variant/60">({list.length})</span>
                  </div>
                )}
                <div className="space-y-3">
                  {list.map((c) => (
                    <ReadOnlyCard key={c.id} comment={c} />
                  ))}
                </div>
              </div>
            )
          })}
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

  const grouped = useMemo(() => groupComments(comments), [comments])

  return (
    <section className="rounded-2xl bg-surface-container-low border border-white/[0.04] p-5 w-full">
      <header className="flex items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-2">
          <span className="material-symbols-outlined text-[22px] text-primary">chat</span>
          <h2 className="font-headline text-lg font-bold text-on-surface">Советы экспертов</h2>
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
          <span className={`material-symbols-outlined text-[14px] ${loading ? 'animate-spin' : ''}`}>
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
          {GROUP_ORDER.map((g) => {
            const targets = grouped.get(g)
            if (!targets || targets.size === 0) return null
            return (
              <GroupSection
                key={g}
                group={g}
                targets={targets}
                defaultOpen={g === 'general' || g === 'point-a'}
              />
            )
          })}
        </div>
      )}
    </section>
  )
}
