'use client'

/**
 * MarketNewsTab — лента деловых новостей раздела «Рынок».
 *
 * Источник: GET /api/market/news/recent — авторизованный same-origin прокси к
 * бэкенду Mark-analytics (конверт { data, meta, errors }). Лента обновляется
 * автоматически (poll каждые 5 минут + refetch при возврате фокуса на вкладку).
 *
 * Честные состояния: загрузка → скелетоны; ошибка → «Сервис новостей недоступен»
 * + повтор; пусто → «Новостей пока нет». Никаких заглушечных данных.
 */

import { useCallback, useEffect, useRef, useState } from 'react'

const REFRESH_MS = 5 * 60 * 1000

type NewsItem = {
  id: string
  title: string
  url: string
  source: string
  summary?: string
  publishedAt?: number // unix ms
  tags?: string[]
}

type LoadState = 'loading' | 'ready' | 'error'

// --- defensive parsing -------------------------------------------------------

function toMs(v: unknown): number | undefined {
  if (typeof v === 'number') {
    // seconds vs milliseconds heuristic
    return v < 1e12 ? v * 1000 : v
  }
  if (typeof v === 'string' && v.trim()) {
    const t = Date.parse(v)
    if (!Number.isNaN(t)) return t
    const n = Number(v)
    if (!Number.isNaN(n)) return n < 1e12 ? n * 1000 : n
  }
  return undefined
}

function parseItem(raw: unknown, idx: number): NewsItem | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const title = typeof r.title === 'string' ? r.title.trim() : ''
  const url = typeof r.url === 'string' ? r.url.trim() : ''
  if (!title || !url) return null

  const id =
    (typeof r.id === 'string' && r.id) ||
    (typeof r.id === 'number' && String(r.id)) ||
    url ||
    `news-${idx}`

  const source =
    (typeof r.source === 'string' && r.source.trim()) ||
    (typeof r.publisher === 'string' && r.publisher.trim()) ||
    'Источник'

  const summary =
    typeof r.summary === 'string'
      ? r.summary.trim()
      : typeof r.description === 'string'
        ? r.description.trim()
        : undefined

  const publishedAt = toMs(r.published_at ?? r.publishedAt ?? r.timestamp ?? r.date)

  let tags: string[] | undefined
  if (Array.isArray(r.tags)) {
    tags = r.tags.filter((t): t is string => typeof t === 'string' && t.trim().length > 0)
    if (tags.length === 0) tags = undefined
  }

  return { id: String(id), title, url, source, summary, publishedAt, tags }
}

function parseItems(payload: unknown): NewsItem[] {
  // Envelope { data: [...] }, plain array, or { items: [...] } — all tolerated.
  let arr: unknown = null
  if (Array.isArray(payload)) arr = payload
  else if (payload && typeof payload === 'object') {
    const p = payload as Record<string, unknown>
    if (Array.isArray(p.data)) arr = p.data
    else if (Array.isArray(p.items)) arr = p.items
  }
  if (!Array.isArray(arr)) return []
  return arr
    .map((it, i) => parseItem(it, i))
    .filter((it): it is NewsItem => it !== null)
}

// --- ru relative time --------------------------------------------------------

function plural(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10
  const mod100 = n % 100
  if (mod10 === 1 && mod100 !== 11) return one
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return few
  return many
}

function relativeTimeRu(ms: number | undefined, now: number): string {
  if (ms === undefined) return ''
  const diff = Math.max(0, now - ms)
  const sec = Math.floor(diff / 1000)
  if (sec < 60) return 'только что'
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min} ${plural(min, 'минуту', 'минуты', 'минут')} назад`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr} ${plural(hr, 'час', 'часа', 'часов')} назад`
  const day = Math.floor(hr / 24)
  if (day < 7) return `${day} ${plural(day, 'день', 'дня', 'дней')} назад`
  return new Date(ms).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })
}

function formatClock(ms: number): string {
  return new Date(ms).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
}

// --- component ---------------------------------------------------------------

export default function MarketNewsTab() {
  const [state, setState] = useState<LoadState>('loading')
  const [items, setItems] = useState<NewsItem[]>([])
  const [updatedAt, setUpdatedAt] = useState<number | null>(null)
  const [now, setNow] = useState<number>(() => Date.now())
  const inFlight = useRef(false)

  const load = useCallback(async (mode: 'initial' | 'silent') => {
    if (inFlight.current) return
    inFlight.current = true
    if (mode === 'initial') setState('loading')
    try {
      const res = await fetch('/api/market/news/recent', {
        cache: 'no-store',
        signal: AbortSignal.timeout(10000),
      })
      if (!res.ok) throw new Error(`status ${res.status}`)
      const payload: unknown = await res.json().catch(() => null)
      const parsed = parseItems(payload)
      setItems(parsed)
      setUpdatedAt(Date.now())
      setNow(Date.now())
      setState('ready')
    } catch {
      // On a silent refresh failure keep the last good list; only the initial
      // load (or an empty list) surfaces the error state.
      if (mode === 'initial') setState('error')
    } finally {
      inFlight.current = false
    }
  }, [])

  // Initial load + 5-minute polling.
  useEffect(() => {
    void load('initial')
    const poll = setInterval(() => void load('silent'), REFRESH_MS)
    return () => clearInterval(poll)
  }, [load])

  // Refetch when the tab/window regains focus.
  useEffect(() => {
    const onFocus = () => void load('silent')
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [load])

  // Keep relative timestamps fresh without refetching.
  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 30000)
    return () => clearInterval(tick)
  }, [])

  return (
    <div className="space-y-4">
      {/* Шапка ленты */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-mono text-primary/70 uppercase tracking-[0.2em] mb-1">
            Деловые новости · KZ
          </p>
          <h2 className="font-headline text-xl font-extrabold text-on-surface leading-tight">
            Новости рынка
          </h2>
          <div className="flex items-center gap-2 mt-1.5">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary/60" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-primary" />
            </span>
            <span className="text-xs text-on-surface-variant">обновляется автоматически</span>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {updatedAt !== null && (
            <span className="text-xs font-mono text-on-surface-variant/70 tabular-nums">
              Обновлено {formatClock(updatedAt)}
            </span>
          )}
          <button
            type="button"
            onClick={() => void load('silent')}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-white/[0.06] text-xs font-medium text-on-surface-variant hover:text-on-surface hover:border-white/[0.12] transition-colors"
          >
            <span className="material-symbols-outlined text-base">refresh</span>
            Обновить
          </button>
        </div>
      </div>

      {/* Состояния */}
      {state === 'loading' && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="bg-surface-container-low rounded-2xl border border-white/[0.04] p-4 animate-pulse"
            >
              <div className="h-3 w-24 rounded bg-white/[0.06] mb-3" />
              <div className="h-4 w-full rounded bg-white/[0.06] mb-2" />
              <div className="h-4 w-4/5 rounded bg-white/[0.06] mb-4" />
              <div className="h-3 w-full rounded bg-white/[0.04] mb-1.5" />
              <div className="h-3 w-2/3 rounded bg-white/[0.04]" />
            </div>
          ))}
        </div>
      )}

      {state === 'error' && (
        <div className="bg-surface-container-low rounded-2xl border border-white/[0.04] p-10 text-center">
          <span className="material-symbols-outlined text-3xl text-on-surface-variant/60 block mb-3">
            cloud_off
          </span>
          <p className="text-sm font-bold text-on-surface">Сервис новостей недоступен</p>
          <p className="text-xs text-on-surface-variant mt-2 max-w-md mx-auto leading-relaxed">
            Не удалось загрузить ленту деловых новостей. Попробуйте обновить через минуту.
          </p>
          <button
            onClick={() => void load('initial')}
            className="mt-4 text-xs font-mono uppercase tracking-widest text-primary hover:brightness-110 transition-colors"
          >
            Повторить
          </button>
        </div>
      )}

      {state === 'ready' && items.length === 0 && (
        <div className="bg-surface-container-low rounded-2xl border border-white/[0.04] p-10 text-center">
          <span className="material-symbols-outlined text-3xl text-on-surface-variant/60 block mb-3">
            feed
          </span>
          <p className="text-sm font-bold text-on-surface">Новостей пока нет</p>
          <p className="text-xs text-on-surface-variant mt-2">
            Лента обновится автоматически, как только появятся свежие материалы.
          </p>
        </div>
      )}

      {state === 'ready' && items.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {items.map((it) => {
            const rel = relativeTimeRu(it.publishedAt, now)
            return (
              <article
                key={it.id}
                className="bg-surface-container-low rounded-2xl border border-white/[0.04] p-4 flex flex-col hover:border-white/[0.10] transition-colors"
              >
                <div className="flex items-center justify-between gap-2 mb-2">
                  <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-primary/10 border border-primary/20 text-[11px] font-mono uppercase tracking-wide text-primary truncate max-w-[60%]">
                    {it.source}
                  </span>
                  {rel && (
                    <span className="text-[11px] text-on-surface-variant/70 shrink-0">{rel}</span>
                  )}
                </div>

                <a
                  href={it.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-semibold text-sm text-on-surface leading-snug hover:text-primary transition-colors"
                >
                  {it.title}
                </a>

                {it.summary && (
                  <p
                    className="text-xs text-on-surface-variant mt-2 leading-relaxed overflow-hidden"
                    style={{
                      display: '-webkit-box',
                      WebkitLineClamp: 3,
                      WebkitBoxOrient: 'vertical',
                    }}
                  >
                    {it.summary}
                  </p>
                )}

                {it.tags && it.tags.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mt-3 pt-3 border-t border-white/[0.04]">
                    {it.tags.slice(0, 4).map((tag) => (
                      <span
                        key={tag}
                        className="inline-flex items-center px-2 py-0.5 rounded-md bg-white/[0.04] text-[11px] text-on-surface-variant"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                )}
              </article>
            )
          })}
        </div>
      )}

      {/* Подпись об источниках */}
      <p className="text-[11px] text-on-surface-variant/60 leading-relaxed pt-1">
        Источники: Forbes KZ, Курсив, Капитал, InBusiness (RSS) · Лента обновляется автоматически;
        история сохраняется в базе еженедельно и старше.
      </p>
    </div>
  )
}
