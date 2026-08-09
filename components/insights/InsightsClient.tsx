'use client'

/**
 * /insights — the real insights feed.
 *
 * The screen used to render `<EmptyState title="Инсайтов пока нет" />`
 * unconditionally while reading two aggregates off legacy Prisma tables that
 * are empty in production. Nothing here is precomputed any more: every number
 * and every card comes from /api/v1/point-a/insights, the same source the
 * Point A timeline reads, and the empty state only appears when that source
 * really returns nothing.
 */

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'

import { InsightCard } from './InsightCard'
import { InsightsEmptyState } from './InsightsEmptyState'
import { useInsightLinks } from './links'
import type { InsightCounts, InsightRecord, InsightsApiResponse } from './types'

const PAGE_LIMIT = 100

type View = 'all' | 'ai' | 'pending' | 'unanswered'

const VIEW_LABEL: Record<View, string> = {
  all: 'Все инсайты',
  ai: 'От ИИ',
  pending: 'Ждут подтверждения',
  unanswered: 'Без ответа',
}

const VIEW_ICON: Record<View, string> = {
  all: 'lightbulb',
  ai: 'auto_awesome',
  pending: 'pending_actions',
  unanswered: 'help',
}

function matchesView(item: InsightRecord, view: View): boolean {
  switch (view) {
    case 'ai':
      return item.type === 'ai'
    case 'pending':
      return item.status === 'pending_confirmation'
    case 'unanswered':
      return !item.answer_text || item.answer_text.trim() === ''
    default:
      return true
  }
}

/** Server-side error codes → what actually went wrong, in Russian. */
const API_ERROR_TEXT: Record<string, string> = {
  unauthorized: 'Сессия истекла — войдите заново.',
  'AI key not configured':
    'Генерация недоступна: ключ модели ИИ не настроен в этом окружении. Обратитесь к администратору.',
  'Failed to load insights': 'Источник инсайтов недоступен.',
  'Failed to persist generated insights': 'Не удалось сохранить сгенерированные инсайты.',
}

function humanizeError(raw: string | undefined, fallback: string): string {
  if (!raw) return fallback
  return API_ERROR_TEXT[raw] ?? raw
}

export function InsightsClient() {
  const links = useInsightLinks()

  const [items, setItems] = useState<InsightRecord[]>([])
  const [serverCounts, setServerCounts] = useState<InsightCounts | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  const [view, setView] = useState<View>('all')
  const [query, setQuery] = useState('')

  const [generating, setGenerating] = useState(false)
  const [generateError, setGenerateError] = useState<string | null>(null)
  const [generateNote, setGenerateNote] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    try {
      const res = await fetch(`/api/v1/point-a/insights?limit=${PAGE_LIMIT}`, {
        cache: 'no-store',
      })
      const json = (await res.json().catch(() => null)) as InsightsApiResponse | null
      if (!res.ok || !json?.ok || !json.data) {
        throw new Error(humanizeError(json?.error, `Источник ответил ошибкой ${res.status}`))
      }
      setItems(json.data.items)
      setServerCounts(json.data.counts)
    } catch (e) {
      setItems([])
      setServerCounts(null)
      setLoadError(e instanceof Error ? e.message : 'Не удалось загрузить инсайты')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  // Tile counts are derived from the rows on screen so they stay truthful right
  // after a confirm/reject, instead of drifting from the server snapshot.
  const viewCounts = useMemo(() => {
    const counts: Record<View, number> = { all: items.length, ai: 0, pending: 0, unanswered: 0 }
    for (const item of items) {
      if (matchesView(item, 'ai')) counts.ai++
      if (matchesView(item, 'pending')) counts.pending++
      if (matchesView(item, 'unanswered')) counts.unanswered++
    }
    return counts
  }, [items])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return items.filter((item) => {
      if (!matchesView(item, view)) return false
      if (!q) return true
      return (
        item.question_text.toLowerCase().includes(q) ||
        item.category.toLowerCase().includes(q) ||
        (item.answer_text?.toLowerCase().includes(q) ?? false)
      )
    })
  }, [items, view, query])

  const handleUpdated = useCallback((updated: InsightRecord) => {
    setItems((prev) => prev.map((it) => (it.id === updated.id ? { ...it, ...updated } : it)))
  }, [])

  async function generate() {
    setGenerating(true)
    setGenerateError(null)
    setGenerateNote(null)
    try {
      const res = await fetch('/api/v1/point-a/insights/ai-generate', { method: 'POST' })
      const json = (await res.json().catch(() => null)) as {
        ok?: boolean
        error?: string
        data?: { generated?: number; pending_moderation?: number }
      } | null
      if (!res.ok || !json?.ok) {
        throw new Error(humanizeError(json?.error, `Генерация не удалась (${res.status})`))
      }
      const generated = json.data?.generated ?? 0
      const moderated = json.data?.pending_moderation ?? 0
      setGenerateNote(
        moderated > 0
          ? `Сгенерировано ${generated}. Из них ${moderated} ушли на проверку эксперта и появятся в ленте после публикации.`
          : `Сгенерировано инсайтов: ${generated}.`
      )
      await load()
    } catch (e) {
      setGenerateError(e instanceof Error ? e.message : 'Генерация не удалась')
    } finally {
      setGenerating(false)
    }
  }

  const truncated = serverCounts !== null && serverCounts.all > items.length

  return (
    <div className="space-y-8">
      {/* Header */}
      <section className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="mb-3 font-mono text-xs uppercase tracking-[0.2em] text-primary/70">
            Аналитические инсайты
          </p>
          <h1 className="font-headline text-3xl font-extrabold text-on-surface lg:text-4xl">
            <span className="text-gradient">Инсайты</span>
          </h1>
          <p className="mt-2 max-w-xl text-sm text-on-surface-variant">
            Вопросы и гипотезы по вашей компании: что ИИ и эксперты заметили в данных Точки А.
            Раскройте карточку — увидите обоснование и сможете подтвердить или отклонить вывод.
          </p>
        </div>

        <button
          type="button"
          onClick={generate}
          disabled={generating}
          aria-label="Сгенерировать инсайты ИИ по данным Точки А"
          className="inline-flex shrink-0 items-center gap-1.5 rounded-xl bg-primary/90 px-4 py-2 text-sm font-medium text-[#04140a] transition-colors hover:bg-primary disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
        >
          <span aria-hidden="true" className="material-symbols-outlined text-[16px]">
            auto_awesome
          </span>
          {generating ? 'Генерируем…' : 'Сгенерировать инсайты'}
        </button>
      </section>

      {generateError && (
        <p role="alert" className="rounded-xl border border-error/30 bg-error/[0.06] px-4 py-3 text-sm text-error">
          {generateError}
        </p>
      )}
      {generateNote && (
        <p role="status" className="rounded-xl border border-primary/30 bg-primary/[0.06] px-4 py-3 text-sm text-primary">
          {generateNote}
        </p>
      )}

      {/* Body */}
      {loading ? (
        <div className="space-y-4" aria-busy="true" aria-label="Загрузка инсайтов">
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-24 animate-pulse rounded-2xl bg-surface-container" />
            ))}
          </div>
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-32 animate-pulse rounded-2xl bg-surface-container" />
          ))}
        </div>
      ) : loadError ? (
        <section className="rounded-2xl border border-error/30 bg-surface-container-low p-8 text-center">
          <span aria-hidden="true" className="material-symbols-outlined text-4xl text-error/70">
            cloud_off
          </span>
          <h2 className="mt-2 font-headline text-lg font-bold text-on-surface">
            Инсайты не загрузились
          </h2>
          <p className="mx-auto mt-1 max-w-sm text-sm text-on-surface-variant">{loadError}</p>
          <button
            type="button"
            onClick={() => void load()}
            className="mt-5 inline-flex items-center gap-1.5 rounded-xl border border-white/[0.08] px-4 py-2 text-sm text-on-surface transition-colors hover:border-primary/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          >
            <span aria-hidden="true" className="material-symbols-outlined text-[16px]">
              refresh
            </span>
            Повторить
          </button>
        </section>
      ) : items.length === 0 ? (
        <InsightsEmptyState
          icon="lightbulb"
          title="Инсайтов пока нет"
          description="В вашей ленте нет ни одного вопроса от ИИ, эксперта или клиента — раскрывать пока нечего."
          missing={[
            'Анкета Точки А — источник, по которому ИИ формулирует вопросы',
            'Опубликованных инсайтов нет: либо генерация не запускалась, либо результат ещё на проверке эксперта',
          ]}
          actions={[
            {
              href: links.pointA,
              label: 'Заполнить Точку А',
              icon: 'my_location',
              hint: 'Ответы анкеты — то, из чего строится каждый инсайт',
              primary: true,
            },
            ...(links.feed
              ? [
                  {
                    href: links.feed,
                    label: 'Лента обсуждений',
                    icon: 'forum',
                    hint: 'Задать свой вопрос эксперту или ИИ',
                  },
                ]
              : []),
            {
              href: links.intelligence,
              label: 'Разведка',
              icon: 'hub',
              hint: 'Проверить, какие источники сигналов подключены',
            },
          ]}
        />
      ) : (
        <>
          {/* Real counts — each tile filters the feed below it */}
          <section
            className="grid grid-cols-2 gap-4 lg:grid-cols-4"
            aria-label="Фильтры по инсайтам"
          >
            {(Object.keys(VIEW_LABEL) as View[]).map((key) => {
              const active = view === key
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => setView(key)}
                  aria-pressed={active}
                  aria-label={`${VIEW_LABEL[key]}: ${viewCounts[key]}. Показать только их`}
                  className={`rounded-2xl border p-5 text-left transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ${
                    active
                      ? 'border-primary/40 bg-primary/[0.07]'
                      : 'border-white/[0.04] bg-surface-container-low hover:border-primary/20'
                  }`}
                >
                  <div className="mb-3 flex items-center justify-between gap-2">
                    <p className="font-mono text-[10px] uppercase tracking-widest text-on-surface-variant">
                      {VIEW_LABEL[key]}
                    </p>
                    <span
                      aria-hidden="true"
                      className={`material-symbols-outlined text-xl ${active ? 'text-primary' : 'text-primary/40'}`}
                    >
                      {VIEW_ICON[key]}
                    </span>
                  </div>
                  <p className="font-mono text-3xl font-bold text-on-surface">{viewCounts[key]}</p>
                </button>
              )
            })}
          </section>

          {/* Search */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="relative min-w-[220px] max-w-sm flex-1">
              <span
                aria-hidden="true"
                className="material-symbols-outlined pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[16px] text-on-surface-variant/60"
              >
                search
              </span>
              <label className="sr-only" htmlFor="insights-search">
                Поиск по инсайтам
              </label>
              <input
                id="insights-search"
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Найти по тексту вопроса, ответа или категории…"
                className="w-full rounded-xl border border-white/[0.06] bg-surface-container-high py-2 pl-8 pr-3 text-xs text-on-surface placeholder:text-on-surface-variant/60 focus:border-primary/40 focus:outline-none focus:ring-2 focus:ring-primary/20"
              />
            </div>
            <p className="font-mono text-[11px] text-on-surface-variant">
              Показано {filtered.length} из {items.length}
              {truncated && serverCounts ? ` · всего в ленте ${serverCounts.all}` : ''}
            </p>
          </div>

          {/* Feed */}
          {filtered.length === 0 ? (
            <section className="rounded-2xl border border-white/[0.04] bg-surface-container-low p-10 text-center">
              <span
                aria-hidden="true"
                className="material-symbols-outlined text-4xl text-on-surface-variant/40"
              >
                filter_alt_off
              </span>
              <p className="mt-2 text-sm text-on-surface-variant">
                По фильтру «{VIEW_LABEL[view]}»{query.trim() ? ' и этому запросу' : ''} ничего нет.
              </p>
              <button
                type="button"
                onClick={() => {
                  setView('all')
                  setQuery('')
                }}
                className="mt-4 inline-flex items-center gap-1.5 rounded-xl border border-white/[0.08] px-4 py-2 text-xs text-on-surface transition-colors hover:border-primary/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
              >
                <span aria-hidden="true" className="material-symbols-outlined text-[14px]">
                  restart_alt
                </span>
                Сбросить фильтр
              </button>
            </section>
          ) : (
            <section className="space-y-3" aria-label="Лента инсайтов">
              {filtered.map((item) => (
                <InsightCard key={item.id} item={item} onUpdated={handleUpdated} />
              ))}
            </section>
          )}

          {truncated && (
            <p className="text-center text-[11px] text-on-surface-variant">
              Загружены последние {items.length} инсайтов.{' '}
              {links.feed ? (
                <Link href={links.feed} className="text-primary hover:underline">
                  Вся история — в ленте обсуждений
                </Link>
              ) : (
                'Полная история доступна в ленте обсуждений Точки А.'
              )}
            </p>
          )}
        </>
      )}
    </div>
  )
}

export default InsightsClient
