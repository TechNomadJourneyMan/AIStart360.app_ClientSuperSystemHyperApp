'use client'

/**
 * InsightsFeed — "Уточняющие вопросы" feed for /point-a.
 *
 * Replaces the old <AIInsightsCarousel /> on the orchestrator page.
 * Pure client component: pulls from `/api/v1/point-a/insights`, falls back to
 * a hardcoded list of 6 mock items if the endpoint is missing.
 */

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
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

// ─── Mock fallback (one per category) ────────────────────────────────────────

const MOCK_ITEMS: InsightFeedItem[] = [
  {
    id: 'mock-1',
    type: 'ai',
    category: 'ВЫРУЧКА',
    question_text:
      'В апреле выручка выросла на 18% при том же ARPU. Это разовый эффект сезонности или новый базовый уровень — стоит зашить в прогноз?',
    status: 'pending_confirmation',
    created_at: new Date(Date.now() - 1000 * 60 * 30).toISOString(),
  },
  {
    id: 'mock-2',
    type: 'expert',
    category: 'СТРАТЕГИЯ',
    question_text:
      'Вы планируете запуск второго направления через 4 месяца — есть ли у команды свободный продуктовый ресурс или придётся переключать текущих людей?',
    author_name: 'Эксперт · Наталья К.',
    status: 'awaiting_answer',
    created_at: new Date(Date.now() - 1000 * 60 * 60 * 5).toISOString(),
  },
  {
    id: 'mock-3',
    type: 'ai',
    category: 'ВОРОНКА',
    question_text:
      'Конверсия из заявки в платёж упала с 22% до 16% за последние 6 недель. Это связано с новой формой регистрации или с изменением источников трафика?',
    answer_text:
      'Изменили форму 3 недели назад — добавили шаг с подтверждением телефона. Похоже, это и есть причина.',
    answer_author_name: 'Иван Петров',
    answer_author_role: 'client',
    answered_at: new Date(Date.now() - 1000 * 60 * 60 * 8).toISOString(),
    status: 'confirmed',
    created_at: new Date(Date.now() - 1000 * 60 * 60 * 18).toISOString(),
  },
  {
    id: 'mock-4',
    type: 'client',
    category: 'КЛИЕНТЫ',
    question_text:
      'Какие сегменты клиентов сейчас приносят больше всего LTV и стоит ли увеличить бюджет именно на них?',
    author_name: 'Иван Петров',
    status: 'pending_ai',
    created_at: new Date(Date.now() - 1000 * 60 * 60 * 26).toISOString(),
  },
  {
    id: 'mock-5',
    type: 'expert',
    category: 'ОРГСТРУКТУРА',
    question_text:
      'Кто отвечает за P&L по направлению B2B и есть ли у этого человека прямой доступ к маркетинговому бюджету?',
    author_name: 'Эксперт · Дмитрий В.',
    status: 'awaiting_answer',
    created_at: new Date(Date.now() - 1000 * 60 * 60 * 30).toISOString(),
  },
  {
    id: 'mock-6',
    type: 'ai',
    category: 'КОНКУРЕНТЫ',
    question_text:
      'Два прямых конкурента в апреле снизили цены на 15%. Стоит ли реагировать ценой или удержать позиционирование за счёт ценности?',
    status: 'pending_confirmation',
    created_at: new Date(Date.now() - 1000 * 60 * 60 * 40).toISOString(),
  },
]

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
  limit = 4,
  hideFooterLink = false,
  showSearch = true,
  hideHeader = false,
}: Props) {
  const [items, setItems] = useState<InsightFeedItem[]>(initialItems ?? [])
  const [loading, setLoading] = useState(!initialItems)
  const [filter, setFilter] = useState<FilterKey>('all')
  const [query, setQuery] = useState('')

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
          setItems(MOCK_ITEMS)
        }
      } catch {
        if (!cancelled) setItems(MOCK_ITEMS)
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

  // ─── Body ───
  const Body = (
    <div>
      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
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
        <div className="rounded-2xl border border-white/[0.04] bg-surface-container-low p-8 text-center">
          <span className="material-symbols-outlined text-on-surface-variant/40 text-3xl">
            inbox
          </span>
          <p className="text-sm text-on-surface-variant mt-2">
            Нет вопросов по выбранному фильтру.
          </p>
        </div>
      ) : (
        visible.map((it) => <InsightItem key={it.id} item={it} />)
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
