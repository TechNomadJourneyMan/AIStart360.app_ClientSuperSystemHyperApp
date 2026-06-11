'use client'

/**
 * /point-a/insights — full timeline of clarifying questions.
 *
 * Social-feed style: sticky filter bar, "Создать вопрос" composer, per-item
 * comments thread with mock replies, "Загрузить ещё" pagination.
 *
 * Wires to `/api/v1/point-a/insights`. When the API has no items the feed shows
 * an explicit empty state — never fabricated AI/expert/client questions.
 * The composer adds locally-created client questions to the in-memory list.
 */

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import {
  InsightItem,
  type InsightFeedItem,
  type InsightComment,
} from '@/components/point-a/v2/InsightItem'

type FilterKey = 'all' | 'ai' | 'expert' | 'client'

interface Counts {
  all: number
  ai: number
  expert: number
  client: number
  pending: number
  unanswered: number
}

interface ApiResponse {
  ok: boolean
  data?: { items: InsightFeedItem[]; counts: Counts }
}

// ─── Page ────────────────────────────────────────────────────────────────────

const PAGE_SIZE = 5

export default function InsightsPage() {
  const [items, setItems] = useState<InsightFeedItem[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<FilterKey>('all')
  const [query, setQuery] = useState('')
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE)
  const [expandedComments, setExpandedComments] = useState<Set<string>>(new Set())

  const [composerOpen, setComposerOpen] = useState(false)
  const [composerText, setComposerText] = useState('')
  const [composerCategory, setComposerCategory] = useState('СТРАТЕГИЯ')

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    ;(async () => {
      try {
        const res = await fetch('/api/v1/point-a/insights?limit=100', { cache: 'no-store' })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const json = (await res.json()) as ApiResponse
        if (cancelled) return
        if (json?.ok && json.data?.items?.length) {
          setItems(json.data.items)
        } else {
          setItems([])
        }
      } catch {
        if (!cancelled) setItems([])
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const counts = useMemo(() => {
    const c: Counts = { all: items.length, ai: 0, expert: 0, client: 0, pending: 0, unanswered: 0 }
    for (const it of items) {
      if (it.type === 'ai') c.ai++
      else if (it.type === 'expert') c.expert++
      else if (it.type === 'client') c.client++
      if (it.status === 'pending_confirmation') c.pending++
      if (it.status === 'awaiting_answer' || it.status === 'pending_ai') c.unanswered++
    }
    return c
  }, [items])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return items.filter((it) => {
      if (filter !== 'all' && it.type !== filter) return false
      if (!q) return true
      return (
        it.question_text.toLowerCase().includes(q) ||
        it.category.toLowerCase().includes(q) ||
        (it.answer_text?.toLowerCase().includes(q) ?? false)
      )
    })
  }, [items, filter, query])

  const visible = filtered.slice(0, visibleCount)
  const hasMore = filtered.length > visibleCount

  function submitComposer() {
    if (!composerText.trim()) return
    const newItem: InsightFeedItem = {
      id: `local-${Date.now()}`,
      type: 'client',
      category: composerCategory,
      question_text: composerText.trim(),
      author_name: 'Вы',
      status: 'pending_ai',
      created_at: new Date().toISOString(),
    }
    setItems((prev) => [newItem, ...prev])
    setComposerText('')
    setComposerOpen(false)
  }

  function toggleComments(id: string) {
    setExpandedComments((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <div className="min-h-screen pb-12">
      {/* Sticky top bar */}
      <div className="sticky top-0 z-30 -mx-4 px-4 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8 backdrop-blur-xl bg-surface-container/85 border-b border-white/[0.06]">
        <div className="max-w-4xl mx-auto py-4">
          <div className="flex items-start justify-between gap-3 flex-wrap mb-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-xs text-on-surface-variant mb-1">
                <Link href="/point-a" className="hover:text-primary transition-colors">
                  Точка А
                </Link>
                <span className="material-symbols-outlined text-[14px]">chevron_right</span>
                <span>Лента обсуждений</span>
              </div>
              <h1 className="font-headline text-2xl text-on-surface leading-tight">
                Лента уточняющих вопросов
              </h1>
              <p className="text-xs text-on-surface-variant mt-1">
                Вопросы от ИИ, экспертов и клиента · {counts.all} обсуждений
              </p>
            </div>
            <button
              onClick={() => setComposerOpen((v) => !v)}
              className="inline-flex items-center gap-1.5 rounded-xl bg-primary/90 hover:bg-primary text-[#04140a] text-sm font-medium px-4 py-2 transition-colors focus:outline-none focus:ring-2 focus:ring-primary/40"
            >
              <span className="material-symbols-outlined text-[16px]">add</span>
              Создать вопрос
            </button>
          </div>

          {/* Filter pills + search */}
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-1.5 flex-wrap">
              {([
                ['all', `Все · ${counts.all}`],
                ['ai', `ИИ · ${counts.ai}`],
                ['expert', `Эксперт · ${counts.expert}`],
                ['client', `Клиент · ${counts.client}`],
              ] as [FilterKey, string][]).map(([key, label]) => {
                const active = filter === key
                return (
                  <button
                    key={key}
                    onClick={() => setFilter(key)}
                    className={`text-[11px] font-medium rounded-xl border px-3 py-1.5 transition-colors focus:outline-none focus:ring-2 focus:ring-primary/40 ${
                      active
                        ? 'bg-primary/15 border-primary/40 text-primary'
                        : 'bg-transparent border-white/[0.06] text-on-surface-variant hover:border-white/20 hover:text-on-surface'
                    }`}
                  >
                    {label}
                  </button>
                )
              })}
            </div>
            <div className="relative flex-1 min-w-[200px] max-w-[320px]">
              <span className="material-symbols-outlined absolute left-2.5 top-1/2 -translate-y-1/2 text-on-surface-variant/60 text-[16px] pointer-events-none">
                search
              </span>
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Найти по тексту вопроса или категории..."
                className="w-full rounded-xl bg-surface-container-high border border-white/[0.06] focus:border-primary/40 focus:outline-none focus:ring-2 focus:ring-primary/20 text-xs text-on-surface pl-8 pr-3 py-2 placeholder:text-on-surface-variant/60"
              />
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-4xl mx-auto pt-6">
        {/* Composer */}
        {composerOpen && (
          <div className="rounded-2xl border border-primary/30 bg-surface-container-low p-5 mb-4">
            <div className="flex items-center gap-2 mb-3">
              <span className="material-symbols-outlined text-primary text-[18px]">edit_note</span>
              <h3 className="text-sm font-medium text-on-surface">Новый вопрос</h3>
            </div>
            <div className="flex items-center gap-2 mb-3 flex-wrap">
              <label className="text-[10px] font-mono text-on-surface-variant uppercase tracking-wider">
                Категория
              </label>
              <select
                value={composerCategory}
                onChange={(e) => setComposerCategory(e.target.value)}
                className="rounded-lg bg-surface-container border border-white/[0.08] text-xs text-on-surface px-2 py-1 focus:outline-none focus:ring-2 focus:ring-primary/30"
              >
                {['ВЫРУЧКА', 'СТРАТЕГИЯ', 'ВОРОНКА', 'КЛИЕНТЫ', 'ОРГСТРУКТУРА', 'КОНКУРЕНТЫ'].map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
            <textarea
              value={composerText}
              onChange={(e) => setComposerText(e.target.value)}
              rows={3}
              placeholder="Сформулируйте вопрос, который поможет уточнить прогноз или стратегию..."
              className="w-full rounded-xl bg-surface-container border border-white/[0.06] focus:border-primary/40 focus:outline-none focus:ring-2 focus:ring-primary/20 text-sm text-on-surface px-3 py-2.5 placeholder:text-on-surface-variant/60 resize-none"
            />
            <div className="flex items-center justify-end gap-2 mt-3">
              <button
                onClick={() => {
                  setComposerOpen(false)
                  setComposerText('')
                }}
                className="text-xs font-medium text-on-surface-variant hover:text-on-surface px-3 py-1.5 rounded-xl transition-colors"
              >
                Отмена
              </button>
              <button
                onClick={submitComposer}
                disabled={!composerText.trim()}
                className="inline-flex items-center gap-1.5 rounded-xl bg-primary/90 hover:bg-primary disabled:bg-white/[0.06] disabled:text-on-surface-variant/50 text-[#04140a] text-xs font-medium px-3 py-1.5 transition-colors"
              >
                <span className="material-symbols-outlined text-[14px]">send</span>
                Опубликовать
              </button>
            </div>
          </div>
        )}

        {/* Feed body */}
        {loading ? (
          <div className="space-y-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div
                key={i}
                className="rounded-2xl border border-white/[0.04] bg-surface-container-low p-5 animate-pulse"
              >
                <div className="h-3 w-32 bg-white/[0.06] rounded mb-3" />
                <div className="h-4 w-3/4 bg-white/[0.08] rounded mb-2" />
                <div className="h-3 w-1/2 bg-white/[0.05] rounded" />
              </div>
            ))}
          </div>
        ) : visible.length === 0 ? (
          <div className="rounded-2xl border border-white/[0.04] bg-surface-container-low p-10 text-center">
            <span className="material-symbols-outlined text-on-surface-variant/40 text-4xl">
              forum
            </span>
            <p className="text-sm text-on-surface-variant mt-2">
              По выбранным фильтрам нет обсуждений.
            </p>
          </div>
        ) : (
          <>
            {visible.map((it) => {
              const comments: InsightComment[] = []
              const expanded = expandedComments.has(it.id)
              const previewComments = expanded ? comments : comments.slice(0, 2)
              const hiddenComments = comments.length - previewComments.length
              return (
                <div key={it.id}>
                  <InsightItem
                    item={it}
                    comments={previewComments}
                    showCommentInput
                  />
                  {hiddenComments > 0 && (
                    <button
                      onClick={() => toggleComments(it.id)}
                      className="text-[11px] text-primary hover:text-primary/80 transition-colors ml-5 -mt-2 mb-3"
                    >
                      + {hiddenComments} комментариев
                    </button>
                  )}
                </div>
              )
            })}
            {hasMore && (
              <div className="text-center mt-4">
                <button
                  onClick={() => setVisibleCount((c) => c + PAGE_SIZE)}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-white/[0.08] hover:border-primary/40 bg-surface-container-low text-on-surface-variant hover:text-primary text-xs font-medium px-4 py-2 transition-colors"
                >
                  <span className="material-symbols-outlined text-[14px]">expand_more</span>
                  Загрузить ещё ({filtered.length - visibleCount})
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
