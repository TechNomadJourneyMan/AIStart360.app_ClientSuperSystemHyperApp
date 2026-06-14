'use client'

/**
 * InsightsFeed — "Уточняющие вопросы" feed for /point-a.
 *
 * Replaces the old <AIInsightsCarousel /> on the orchestrator page.
 * Pure client component: pulls from `/api/v1/point-a/insights`. When there are
 * no items it shows an empty state — it never fabricates questions.
 */

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { InsightItem, type InsightFeedItem } from './InsightItem'

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

// ─── Helpers ─────────────────────────────────────────────────────────────────

function deriveCounts(items: InsightFeedItem[]): Counts {
  const counts: Counts = {
    all: items.length,
    ai: 0,
    expert: 0,
    client: 0,
    pending: 0,
    unanswered: 0,
  }
  for (const it of items) {
    if (it.type === 'ai') counts.ai++
    else if (it.type === 'expert') counts.expert++
    else if (it.type === 'client') counts.client++
    if (it.status === 'pending_confirmation') counts.pending++
    if (it.status === 'awaiting_answer' || it.status === 'pending_ai') counts.unanswered++
  }
  return counts
}

// ─── Component ───────────────────────────────────────────────────────────────

interface Props {
  /** Override mock items (mostly for the full-page route). */
  initialItems?: InsightFeedItem[]
  /** Cap the rendered list (the compact /point-a card). */
  limit?: number
  /** Hide the footer link (used on the full timeline page). */
  hideFooterLink?: boolean
  /** Show a search input above the list. */
  showSearch?: boolean
  /** Hide the header text (used on full-page sticky bar). */
  hideHeader?: boolean
}

export function InsightsFeed({
  initialItems,
  limit = 0, // 0 = no limit; slideshow flips through all items
  hideFooterLink = false,
  showSearch = true,
  hideHeader = false,
}: Props) {
  const [items, setItems] = useState<InsightFeedItem[]>(initialItems ?? [])
  const [loading, setLoading] = useState(!initialItems)
  const [filter, setFilter] = useState<FilterKey>('all')
  const [query, setQuery] = useState('')
  const [idx, setIdx] = useState(0)

  useEffect(() => {
    if (initialItems) return
    let cancelled = false
    setLoading(true)
    ;(async () => {
      try {
        const res = await fetch('/api/v1/point-a/insights?limit=50', { cache: 'no-store' })
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
  }, [initialItems])

  const counts = useMemo(() => deriveCounts(items), [items])

  // Filter + search interplay: type-filter first, then case-insensitive
  // substring match against question_text OR category. Both gates are AND-ed.
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

  const visible = limit > 0 ? filtered.slice(0, limit) : filtered

  // ─── Slideshow: reset idx when filter/query/items change or list shrinks ───
  useEffect(() => {
    setIdx(0)
  }, [filter, query, items])

  useEffect(() => {
    if (idx > visible.length - 1) setIdx(Math.max(0, visible.length - 1))
  }, [visible.length, idx])

  const go = useCallback((n: number) => {
    if (visible.length === 0) return
    const next = ((n % visible.length) + visible.length) % visible.length // wrap-around
    setIdx(next)
  }, [visible.length])

  // Keyboard nav: ← / →
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
      if (e.key === 'ArrowRight') { e.preventDefault(); go(idx + 1) }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); go(idx - 1) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [idx, go])

  // ─── Header ───
  const Header = !hideHeader && (
    <div className="flex items-start justify-between gap-3 flex-wrap mb-4">
      <div className="flex items-start gap-3 min-w-0">
        <span className="material-symbols-outlined text-primary/80 text-2xl mt-0.5">
          forum
        </span>
        <div className="min-w-0">
          <h3 className="font-headline text-lg text-on-surface leading-tight">
            Уточняющие вопросы
          </h3>
          <p className="text-xs text-on-surface-variant mt-0.5">
            От ИИ, экспертов и клиента · ответы уточняют прогноз и стратегию роста
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        <span className="inline-flex items-center gap-1.5 rounded-xl border border-amber-400/30 bg-amber-400/10 text-amber-300 text-[11px] font-medium px-2.5 py-1">
          <span className="material-symbols-outlined text-[13px]">pending</span>
          {counts.pending} ждут подтверждения
        </span>
        <span className="inline-flex items-center gap-1.5 rounded-xl border border-white/[0.08] bg-white/[0.03] text-on-surface-variant text-[11px] font-medium px-2.5 py-1">
          <span className="material-symbols-outlined text-[13px]">help</span>
          {counts.unanswered} без ответа
        </span>
      </div>
    </div>
  )

  // ─── Pills + search ───
  const PillRow = (
    <div className="flex items-center justify-between gap-3 flex-wrap mb-4">
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
      {showSearch && (
        <div className="relative flex-1 min-w-[200px] max-w-[320px]">
          <span className="material-symbols-outlined absolute left-2.5 top-1/2 -translate-y-1/2 text-on-surface-variant/60 text-[16px] pointer-events-none">
            search
          </span>
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Найти по тексту вопроса или категории..."
            className="w-full rounded-xl bg-surface-container border border-white/[0.06] focus:border-primary/40 focus:outline-none focus:ring-2 focus:ring-primary/20 text-xs text-on-surface pl-8 pr-3 py-2 placeholder:text-on-surface-variant/60"
          />
        </div>
      )}
    </div>
  )

  // ─── Body (slideshow: one question at a time) ───
  const current = visible[Math.min(idx, Math.max(0, visible.length - 1))]
  const total = visible.length
  const safeIdx = Math.min(idx, Math.max(0, total - 1))

  const Body = (
    <div>
      {loading ? (
        <div className="rounded-2xl border border-white/[0.04] bg-surface-container-low p-5 animate-pulse">
          <div className="h-3 w-32 bg-white/[0.06] rounded mb-3" />
          <div className="h-4 w-3/4 bg-white/[0.08] rounded mb-2" />
          <div className="h-3 w-1/2 bg-white/[0.05] rounded" />
        </div>
      ) : total === 0 ? (
        <div className="rounded-2xl border border-white/[0.04] bg-surface-container-low p-8 text-center">
          <span className="material-symbols-outlined text-on-surface-variant/40 text-3xl">
            inbox
          </span>
          <p className="text-sm text-on-surface-variant mt-2">
            Нет вопросов по выбранному фильтру.
          </p>
        </div>
      ) : (
        <>
          {/* Slide stage */}
          <div className="relative">
            {current && <InsightItem key={current.id} item={current} />}
          </div>

          {/* Slideshow controls */}
          <div className="mt-4 flex items-center justify-between gap-3 flex-wrap">
            <button
              onClick={() => go(safeIdx - 1)}
              disabled={total <= 1}
              aria-label="Предыдущий вопрос"
              className="inline-flex items-center gap-1.5 rounded-xl border border-white/[0.06] bg-surface-container-low text-on-surface-variant text-xs font-medium px-3 py-1.5 hover:border-primary/40 hover:text-primary transition-colors disabled:opacity-30 disabled:hover:border-white/[0.06] disabled:hover:text-on-surface-variant focus:outline-none focus:ring-2 focus:ring-primary/40"
            >
              <span className="material-symbols-outlined text-[16px]">arrow_back</span>
              Назад
            </button>

            {/* Dots + counter */}
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-1.5 max-w-[280px] overflow-x-auto">
                {visible.map((it, i) => (
                  <button
                    key={it.id}
                    onClick={() => go(i)}
                    aria-label={`Вопрос ${i + 1}: ${it.category}`}
                    title={`${i + 1}. ${it.category}`}
                    className={`flex-shrink-0 h-2 rounded-full transition-all focus:outline-none focus:ring-2 focus:ring-primary/40 ${
                      i === safeIdx
                        ? 'w-6 bg-primary'
                        : 'w-2 bg-on-surface-variant/30 hover:bg-on-surface-variant/60'
                    }`}
                  />
                ))}
              </div>
              <span className="font-mono text-[11px] text-on-surface-variant whitespace-nowrap">
                {safeIdx + 1} / {total}
              </span>
            </div>

            <button
              onClick={() => go(safeIdx + 1)}
              disabled={total <= 1}
              aria-label="Следующий вопрос"
              className="inline-flex items-center gap-1.5 rounded-xl bg-primary/15 border border-primary/40 text-primary text-xs font-semibold px-3 py-1.5 hover:bg-primary/25 transition-colors disabled:opacity-30 disabled:hover:bg-primary/15 focus:outline-none focus:ring-2 focus:ring-primary/40"
            >
              Дальше
              <span className="material-symbols-outlined text-[16px]">arrow_forward</span>
            </button>
          </div>
        </>
      )}
    </div>
  )

  return (
    <section className="bg-surface-container rounded-2xl border border-white/[0.04] shadow-card p-5">
      {Header}
      {PillRow}
      {Body}
      {!hideFooterLink && (
        <div className="mt-4 pt-4 border-t border-white/[0.04] text-right">
          <Link
            href="/point-a/insights"
            className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:text-primary/80 transition-colors"
          >
            Открыть полную ленту обсуждений
            <span className="material-symbols-outlined text-[14px]">arrow_forward</span>
          </Link>
        </div>
      )}
    </section>
  )
}

export default InsightsFeed
